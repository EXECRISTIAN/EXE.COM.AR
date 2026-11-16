// ARCA (ex AFIP): consulta del padrón (CUIT/DNI) y factura electrónica (monotributo: Factura C) con CAE.
//
// Interruptor: Panel → Integraciones → ARCA. Apagado (o sin certificado) = no hace nada.
// Configuración NO secreta (Panel → Integraciones): cuit, punto_venta, cbte_tipo (11 = Factura C), env ("homo"/"prod"),
//   auto_invoice (facturar solo al acreditarse un pago de Mercado Pago).
// Secrets (Supabase → Edge Functions → Secrets):
//   ARCA_CERT   certificado .crt en formato PEM (texto completo, con BEGIN/END)
//   ARCA_KEY    clave privada .key en formato PEM (la que generaste para pedir el certificado)
// Servicios que hay que asociar al certificado en ARCA (Administrador de Relaciones): "wsfe" y "ws_sr_padron_a13".
// Deploy: supabase functions deploy arca --no-verify-jwt
//
// Acciones (POST JSON { action, ... }):
//   status                       integrations.manage   → prueba el acceso (pide ticket) y devuelve el último comprobante
//   padron   { doc }             orders.create         → datos de un CUIT o DNI
//   invoice  { order_id, doc? }  orders.mark_paid      → emite la factura de un pedido pagado y la guarda en el pedido
//   auto     { order_id }        solo interno           → igual que invoice, si auto_invoice está prendido
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import forge from "https://esm.sh/node-forge@1.3.1";
import { requirePermFor } from "../_shared/sesion.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

type Cfg = { cuit: string; punto_venta: number; cbte_tipo: number; env: string; auto_invoice: boolean };
const URLS = (prod: boolean) => ({
  wsaa: prod ? "https://wsaa.afip.gov.ar/ws/services/LoginCms" : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  wsfe: prod ? "https://servicios1.afip.gov.ar/wsfev1/service.asmx" : "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  padron: prod ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13" : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13",
});

const xesc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1] ?? "";
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map((m) => m[1]);

async function soap(url: string, action: string, body: string) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action },
    body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`,
  });
  const text = await r.text();
  const fault = tag(text, "faultstring");
  if (fault) throw fail(`ARCA: ${unesc(fault)}`, 502);
  if (!r.ok) throw fail(`ARCA respondió ${r.status}`, 502);
  return text;
}

async function loadCfg(): Promise<Cfg> {
  const { data } = await db.from("integrations").select("enabled, config").eq("key", "arca").maybeSingle();
  if (!data?.enabled) throw fail("ARCA está desactivado", 503);
  if (!env("ARCA_CERT") || !env("ARCA_KEY")) throw fail("Falta cargar el certificado de ARCA (ARCA_CERT y ARCA_KEY)", 503);
  const c = data.config || {};
  const cuit = String(c.cuit || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) throw fail("Falta el CUIT en Panel → Integraciones → ARCA", 503);
  return { cuit, punto_venta: Number(c.punto_venta) || 1, cbte_tipo: Number(c.cbte_tipo) || 11, env: c.env === "prod" ? "prod" : "homo", auto_invoice: !!c.auto_invoice };
}

// Ticket de acceso (WSAA): dura 12 h y ARCA rechaza pedir otro mientras el anterior sigue vigente → se guarda en caché.
async function ticket(cfg: Cfg, service: string) {
  const key = `arca:${cfg.env}:${cfg.cuit}:${service}`;
  const { data: hit } = await db.from("integration_cache").select("value, expires").eq("key", key).maybeSingle();
  if (hit && new Date(hit.expires).getTime() > Date.now() + 5 * 60e3) return hit.value as { token: string; sign: string };

  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now / 1000)}</uniqueId>` +
    `<generationTime>${iso(now - 10 * 60e3)}</generationTime><expirationTime>${iso(now + 10 * 60e3)}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  const cert = forge.pki.certificateFromPem(env("ARCA_CERT"));
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(env("ARCA_KEY")), certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();
  const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  const res = await soap(URLS(cfg.env === "prod").wsaa, "",
    `<wsaa:loginCms xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>`);
  const ta = unesc(tag(res, "loginCmsReturn"));
  const value = { token: tag(ta, "token"), sign: tag(ta, "sign") };
  if (!value.token) throw fail("ARCA no devolvió el ticket de acceso", 502);
  await db.from("integration_cache").upsert({ key, value, expires: tag(ta, "expirationTime") || new Date(now + 11 * 3600e3).toISOString() });
  return value;
}

// ---------- Padrón A13 ----------
async function padron(cfg: Cfg, doc: string) {
  const t = await ticket(cfg, "ws_sr_padron_a13");
  const url = URLS(cfg.env === "prod").padron;
  const auth = `<token>${t.token}</token><sign>${t.sign}</sign><cuitRepresentada>${cfg.cuit}</cuitRepresentada>`;
  let ids = [doc];
  if (doc.length <= 8) {   // DNI → CUIT/CUIL asociados
    const r = await soap(url, "", `<a13:getIdPersonaListByDocumento xmlns:a13="http://a13.soap.ws.server.puc.sr/">${auth}<documento>${doc}</documento></a13:getIdPersonaListByDocumento>`);
    ids = tags(r, "idPersona");
    if (!ids.length) return { encontrado: false };
  }
  const r = await soap(url, "", `<a13:getPersona xmlns:a13="http://a13.soap.ws.server.puc.sr/">${auth}<idPersona>${ids[0]}</idPersona></a13:getPersona>`);
  const p = tag(r, "persona");
  if (!p) return { encontrado: false };
  const dom = tags(p, "domicilio").find((d) => tag(d, "tipoDomicilio") === "FISCAL") ?? tag(p, "domicilio");
  return {
    encontrado: true,
    cuit: tag(p, "idPersona"),
    nombre: unesc(tag(p, "razonSocial") || [tag(p, "apellido"), tag(p, "nombre")].filter(Boolean).join(" ")),
    tipo: tag(p, "tipoPersona"),
    estado: tag(p, "estadoClave"),
    domicilio: dom ? unesc([tag(dom, "direccion"), tag(dom, "localidad"), tag(dom, "descripcionProvincia"), tag(dom, "codigoPostal")].filter(Boolean).join(", ")) : "",
    otros_cuit: ids.slice(1),
  };
}

// ---------- Factura electrónica (WSFEv1) ----------
async function invoice(cfg: Cfg, orderId: number, docIn?: string) {
  const { data: o } = await db.from("orders").select("id, status, total, invoice_cae, invoice_doc").eq("id", orderId).maybeSingle();
  if (!o) throw fail("Pedido inexistente", 404);
  if (o.invoice_cae) return { ya_facturado: true, cae: o.invoice_cae };
  if (!["paid", "preparing", "shipped", "delivered"].includes(o.status)) throw fail("Solo se facturan pedidos pagados", 409);
  const total = Math.round(Number(o.total) * 100) / 100;
  if (!(total > 0)) throw fail("El pedido no tiene total", 409);

  const doc = String(docIn ?? o.invoice_doc ?? "").replace(/\D/g, "");
  const docTipo = doc.length === 11 ? 80 : doc.length >= 7 && doc.length <= 8 ? 96 : 99;   // CUIT / DNI / consumidor final
  const t = await ticket(cfg, "wsfe");
  const url = URLS(cfg.env === "prod").wsfe;
  const auth = `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cfg.cuit}</ar:Cuit></ar:Auth>`;
  const ns = `xmlns:ar="http://ar.gov.afip.dif.FEV1/"`;

  const last = await soap(url, "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
    `<ar:FECompUltimoAutorizado ${ns}>${auth}<ar:PtoVta>${cfg.punto_venta}</ar:PtoVta><ar:CbteTipo>${cfg.cbte_tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`);
  const n = Number(tag(last, "CbteNro") || 0) + 1;
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");   // fecha de Argentina

  const res = await soap(url, "http://ar.gov.afip.dif.FEV1/FECAESolicitar", `<ar:FECAESolicitar ${ns}>${auth}<ar:FeCAEReq>
    <ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${cfg.punto_venta}</ar:PtoVta><ar:CbteTipo>${cfg.cbte_tipo}</ar:CbteTipo></ar:FeCabReq>
    <ar:FeDetReq><ar:FECAEDetRequest>
      <ar:Concepto>1</ar:Concepto><ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docTipo === 99 ? 0 : doc}</ar:DocNro>
      <ar:CbteDesde>${n}</ar:CbteDesde><ar:CbteHasta>${n}</ar:CbteHasta><ar:CbteFch>${hoy}</ar:CbteFch>
      <ar:ImpTotal>${total.toFixed(2)}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${total.toFixed(2)}</ar:ImpNeto>
      <ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA>
      <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>
      <ar:CondicionIVAReceptorId>${docTipo === 80 ? 6 : 5}</ar:CondicionIVAReceptorId>
    </ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`);

  const cae = tag(res, "CAE");
  if (tag(res, "Resultado") !== "A" || !cae) {
    const msgs = [...tags(res, "Obs"), ...tags(res, "Err")].map((x) => unesc(tag(x, "Msg"))).filter(Boolean);
    throw fail(`ARCA rechazó la factura: ${msgs.join(" · ") || "sin detalle"}`, 409);
  }
  const vto = tag(res, "CAEFchVto");
  await db.from("orders").update({
    invoice_type: cfg.cbte_tipo, invoice_pos: cfg.punto_venta, invoice_number: n, invoice_cae: cae,
    invoice_cae_due: vto ? `${vto.slice(0, 4)}-${vto.slice(4, 6)}-${vto.slice(6, 8)}` : null,
    invoice_at: new Date().toISOString(), invoice_doc: docTipo === 99 ? null : doc,
  }).eq("id", orderId);
  await db.from("order_events").insert({ order_id: orderId, from_status: o.status, to_status: o.status, actor: `arca:factura:${cfg.punto_venta}-${n}` });
  return { numero: `${String(cfg.punto_venta).padStart(5, "0")}-${String(n).padStart(8, "0")}`, cae, vencimiento_cae: vto };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const internal = req.headers.get("Authorization") === `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`;
    const cfg = await loadCfg();
    switch (body.action) {
      case "status": {
        await requirePermFor(req, db, "integrations.manage");
        const t = await ticket(cfg, "wsfe");
        const last = await soap(URLS(cfg.env === "prod").wsfe, "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
          `<ar:FECompUltimoAutorizado xmlns:ar="http://ar.gov.afip.dif.FEV1/"><ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cfg.cuit}</ar:Cuit></ar:Auth><ar:PtoVta>${cfg.punto_venta}</ar:PtoVta><ar:CbteTipo>${cfg.cbte_tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`);
        return json({ ok: true, ambiente: cfg.env, ultimo_comprobante: Number(tag(last, "CbteNro") || 0) });
      }
      case "padron": {
        await requirePermFor(req, db, "orders.create");
        const doc = String(body.doc ?? "").replace(/\D/g, "");
        if (!/^\d{7,8}$|^\d{11}$/.test(doc)) return json({ error: "Escribí un DNI (7-8 números) o un CUIT (11 números)" }, 400);
        return json(await padron(cfg, doc));
      }
      case "invoice": {
        await requirePermFor(req, db, "orders.mark_paid");
        return json(await invoice(cfg, Number(body.order_id), body.doc));
      }
      case "auto": {
        if (!internal) return json({ error: "forbidden" }, 403);
        if (!cfg.auto_invoice) return json({ skipped: true });
        return json(await invoice(cfg, Number(body.order_id)));
      }
      default:
        return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, (e as any).status || 500);
  }
});
