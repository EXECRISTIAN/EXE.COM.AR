// Integración con la API de Andreani (https://developers.andreani.com).
// Las credenciales viven solo acá (secrets de Supabase), nunca en el navegador.
//
// Secrets:
//   ANDREANI_ENV          "qa" (sandbox, por defecto) o "prod"
//   ANDREANI_USER, ANDREANI_PASS, ANDREANI_CLIENTE
//   ANDREANI_CONTRATO_DOMICILIO, ANDREANI_CONTRATO_SUCURSAL
//   ANDREANI_ORIGEN       JSON con la dirección y datos del remitente, ej:
//     {"codigoPostal":"1406","calle":"Av. Rivadavia","numero":"1234","localidad":"CABA","region":"AR-C",
//      "nombreCompleto":"EXE","email":"ventas@exe.com.ar","documentoTipo":"CUIT","documentoNumero":"20123456789","telefono":"1130095254"}
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (los pone Supabase)
// Deploy: supabase functions deploy andreani --no-verify-jwt
//
// Acciones (POST JSON { action, ... }):
//   quote      { cp, items:[{id, qty}] }      público   → costo a domicilio y a sucursal (precios y pesos salen de la base)
//   branches   { cp }                         público   → sucursales cercanas
//   track      { numero }                     público   → estado e historial del envío
//   create     { order_id }                   shipping.manage → crea el envío en Andreani y lo guarda en el pedido
//   label      { order_id }                   shipping.manage → etiqueta PDF (base64)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const BASE = env("ANDREANI_ENV") === "prod" ? "https://apis.andreani.com" : "https://apisqa.andreani.com";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---------- Token (dura 24 h; se renueva cada 12 h) ----------
let token = "", tokenAt = 0;
async function auth(): Promise<string> {
  if (token && Date.now() - tokenAt < 12 * 3600e3) return token;
  const r = await fetch(`${BASE}/login`, {
    headers: { Authorization: "Basic " + btoa(`${env("ANDREANI_USER")}:${env("ANDREANI_PASS")}`) },
  });
  const t = r.headers.get("x-authorization-token");
  if (!r.ok || !t) throw new Error(`Login Andreani falló (${r.status})`);
  token = t; tokenAt = Date.now();
  return t;
}
async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { "x-authorization-token": await auth(), "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Andreani ${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  return r;
}

// ---------- Bulto a partir de los productos (datos de la base, no del navegador) ----------
async function packageFor(items: { id: string; qty: number }[]) {
  const ids = items.map((i) => String(i.id));
  const { data, error } = await db.from("products").select("id, price, weight_kg, length_cm, width_cm, height_cm").in("id", ids);
  if (error) throw error;
  let kilos = 0, volumen = 0, valor = 0;
  for (const it of items) {
    const p = data!.find((d) => d.id === it.id);
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 1)));
    if (!p) continue;
    kilos += Number(p.weight_kg) * qty;
    if (p.length_cm && p.width_cm && p.height_cm) volumen += p.length_cm * p.width_cm * p.height_cm * qty;
    valor += Number(p.price) * qty;
  }
  if (!kilos) throw new Error("Carrito vacío o productos inexistentes");
  return { kilos: Math.round(kilos * 1000) / 1000, volumen: Math.round(volumen), valorDeclarado: Math.max(1, Math.round(valor)) };
}

async function quote(cp: string, contrato: string, b: Awaited<ReturnType<typeof packageFor>>) {
  const q = new URLSearchParams({
    cpDestino: cp, contrato, cliente: env("ANDREANI_CLIENTE"),
    "bultos[0][kilos]": String(b.kilos), "bultos[0][valorDeclarado]": String(b.valorDeclarado),
  });
  if (b.volumen) q.set("bultos[0][volumen]", String(b.volumen));
  const t = await (await api(`/v1/tarifas?${q}`)).json();
  return Number(t?.tarifaConIva?.total ?? t?.tarifaConIva?.totalConIva ?? NaN);
}

async function requirePerm(req: Request, perm: string) {
  const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data } = await user.rpc("has_perm", { p: perm });
  if (data !== true) throw Object.assign(new Error("Sin permiso"), { status: 403 });
}

const cpOk = (cp: unknown) => /^\d{4}$/.test(String(cp ?? ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    switch (body.action) {
      case "quote": {
        if (!cpOk(body.cp)) return json({ error: "Código postal inválido" }, 400);
        const b = await packageFor(body.items || []);
        const [domicilio, sucursal] = await Promise.all([
          quote(body.cp, env("ANDREANI_CONTRATO_DOMICILIO"), b).catch(() => NaN),
          quote(body.cp, env("ANDREANI_CONTRATO_SUCURSAL"), b).catch(() => NaN),
        ]);
        return json({ domicilio: isNaN(domicilio) ? null : domicilio, sucursal: isNaN(sucursal) ? null : sucursal, kilos: b.kilos });
      }
      case "branches": {
        if (!cpOk(body.cp)) return json({ error: "Código postal inválido" }, 400);
        const list = await (await api(`/v2/sucursales?codigoPostal=${body.cp}&canal=B2C&seHaceAtencionAlCliente=true`)).json();
        return json((list || []).map((s: any) => ({
          id: s.id, nombre: s.descripcion,
          direccion: [s.direccion?.calle, s.direccion?.numero, s.direccion?.localidad].filter(Boolean).join(" "),
          horario: s.horarioDeAtencion,
        })));
      }
      case "track": {
        const n = String(body.numero ?? "");
        if (!/^[A-Za-z0-9]{6,30}$/.test(n)) return json({ error: "Número inválido" }, 400);
        const [envio, trazas] = await Promise.all([
          api(`/v2/envios/${n}`).then((r) => r.json()),
          api(`/v2/envios/${n}/trazas`).then((r) => r.json()).catch(() => ({ eventos: [] })),
        ]);
        return json({
          estado: envio.estado, fechaEstimada: envio.fechaEstimadaDeEntrega,
          eventos: (trazas.eventos || []).map((e: any) => ({ fecha: e.Fecha ?? e.fecha, estado: e.Estado ?? e.estado, sucursal: e.Sucursal ?? e.sucursal })),
        });
      }
      case "create": {
        await requirePerm(req, "shipping.manage");
        const { data: o } = await db.from("orders")
          .select("id, status, shipping, andreani_number, profiles(full_name, email, phone), order_items(product_id, qty)")
          .eq("id", body.order_id).single();
        if (!o) return json({ error: "Pedido inexistente" }, 404);
        if (o.andreani_number) return json({ numero: o.andreani_number });
        if (!["paid", "preparing"].includes(o.status)) return json({ error: "El pedido tiene que estar pagado" }, 409);
        const s = o.shipping || {};
        if (!["domicilio", "sucursal"].includes(s.method)) return json({ error: "El pedido no tiene envío por Andreani" }, 409);
        const b = await packageFor(o.order_items.map((i: any) => ({ id: i.product_id, qty: i.qty })));
        const origen = JSON.parse(env("ANDREANI_ORIGEN") || "{}");
        const p: any = o.profiles || {};
        const orden = {
          contrato: env(s.method === "sucursal" ? "ANDREANI_CONTRATO_SUCURSAL" : "ANDREANI_CONTRATO_DOMICILIO"),
          idPedido: `EXE-${o.id}`,
          origen: { postal: { codigoPostal: origen.codigoPostal, calle: origen.calle, numero: origen.numero, localidad: origen.localidad, region: origen.region, pais: "Argentina" } },
          destino: s.method === "sucursal"
            ? { sucursal: { id: String(s.sucursal_id) } }
            : { postal: { codigoPostal: s.cp, calle: s.calle, numero: s.numero, piso: s.piso, departamento: s.depto, localidad: s.localidad, region: s.provincia, pais: "Argentina" } },
          remitente: {
            nombreCompleto: origen.nombreCompleto, email: origen.email,
            documentoTipo: origen.documentoTipo, documentoNumero: origen.documentoNumero,
            telefonos: [{ tipo: 1, numero: origen.telefono }],
          },
          destinatario: [{
            nombreCompleto: s.nombre || p.full_name, email: p.email,
            documentoTipo: "DNI", documentoNumero: s.dni,
            telefonos: [{ tipo: 1, numero: s.telefono || p.phone }],
          }],
          bultos: [{ kilos: b.kilos, volumenCm: b.volumen || undefined, valorDeclaradoConImpuestos: b.valorDeclarado }],
        };
        const r = await (await api("/v2/ordenes-de-envio", { method: "POST", body: JSON.stringify(orden) })).json();
        const numero = r?.bultos?.[0]?.numeroDeEnvio;
        if (!numero) return json({ error: "Andreani no devolvió número de envío", detalle: r }, 502);
        await db.from("orders").update({ andreani_number: numero, andreani_group: r.agrupadorDeBultos ?? null }).eq("id", o.id);
        await db.from("order_events").insert({ order_id: o.id, from_status: o.status, to_status: o.status, actor: `andreani:${numero}` });
        return json({ numero });
      }
      case "label": {
        await requirePerm(req, "shipping.manage");
        const { data: o } = await db.from("orders").select("andreani_number").eq("id", body.order_id).single();
        if (!o?.andreani_number) return json({ error: "El pedido no tiene envío creado" }, 409);
        const r = await api(`/v2/ordenes-de-envio/${o.andreani_number}/etiquetas`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = ""; for (const x of bytes) bin += String.fromCharCode(x);
        return json({ numero: o.andreani_number, pdf: btoa(bin) });
      }
      default:
        return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, (e as any).status || 500);
  }
});
