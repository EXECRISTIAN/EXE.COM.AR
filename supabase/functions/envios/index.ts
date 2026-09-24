// Envíos con Envia.com (https://docs.envia.com): cotiza varios transportistas a la vez (Andreani, Correo Argentino, OCA…),
// genera la guía con etiqueta y hace el seguimiento. El token vive solo acá (secret de Supabase), nunca en el navegador.
//
// Secrets:
//   ENVIA_TOKEN       token de API de Envia (Configuración → Desarrolladores → Tokens de acceso)
//   ENVIA_ENV         "test" (sandbox, por defecto) o "prod"
//   ENVIA_CARRIERS    transportistas a cotizar, separados por coma. Ej: "andreani,correo-argentino,oca"
//   ENVIA_ORIGEN      JSON con la dirección de despacho y datos del remitente, ej:
//     {"name":"EXE","company":"EXE","email":"ventas@exe.com.ar","phone":"1130095254","street":"Av. Rivadavia",
//      "number":"1234","district":"Flores","city":"Ciudad Autónoma de Buenos Aires","state":"C","country":"AR","postalCode":"1406"}
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (los pone Supabase)
// Deploy: supabase functions deploy envios --no-verify-jwt
//
// Acciones (POST JSON { action, ... }):
//   quote   { cp, items:[{id, qty}] }   público          → opciones [{carrier, service, descripcion, precio, dias}]
//   track   { numero, carrier? }        público          → estado e historial
//   create  { order_id }                shipping.manage  → genera la guía y la guarda en el pedido
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const PROD = env("ENVIA_ENV") === "prod";
const API = PROD ? "https://api.envia.com" : "https://api-test.envia.com";
const GEO = "https://geocodes.envia.com";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function envia(path: string, body: unknown) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("ENVIA_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.meta === "error") throw new Error(data?.error?.message || `Envia ${path}: ${r.status}`);
  return data;
}

// Provincia y localidad a partir del código postal (servicio público de Envia).
async function zip(cp: string) {
  const r = await fetch(`${GEO}/zipcode/AR/${cp}`);
  const z = (await r.json().catch(() => []))?.[0];
  return { city: z?.locality ?? z?.city ?? "", state: z?.state?.code?.["2digit"] ?? z?.state?.code ?? "" };
}

// Paquete a partir de los productos (precio y peso salen de la base, no del navegador).
async function packageFor(items: { id: string; qty: number }[]) {
  const { data, error } = await db.from("products")
    .select("id, name, price, weight_kg, length_cm, width_cm, height_cm").in("id", items.map((i) => String(i.id)));
  if (error) throw error;
  let weight = 0, value = 0, vol = 0, maxSide = 10;
  const names: string[] = [];
  for (const it of items) {
    const p = data!.find((d) => d.id === it.id);
    if (!p) continue;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 1)));
    weight += Number(p.weight_kg) * qty;
    value += Number(p.price) * qty;
    names.push(p.name);
    if (p.length_cm && p.width_cm && p.height_cm) {
      vol += p.length_cm * p.width_cm * p.height_cm * qty;
      maxSide = Math.max(maxSide, p.length_cm, p.width_cm, p.height_cm);
    }
  }
  if (!weight) throw new Error("Carrito vacío o productos inexistentes");
  // Caja aproximada: si no hay medidas cargadas, 30x20x15 cm.
  const side = vol ? Math.max(maxSide, Math.ceil(Math.cbrt(vol))) : 0;
  return {
    content: names.join(", ").slice(0, 100) || "Hardware",
    amount: 1, type: "box",
    weight: Math.round(weight * 100) / 100, weightUnit: "KG", lengthUnit: "CM",
    insurance: 0, declaredValue: Math.max(1, Math.round(value)),
    dimensions: side ? { length: side, width: side, height: side } : { length: 30, width: 20, height: 15 },
  };
}

const origin = () => JSON.parse(env("ENVIA_ORIGEN") || "{}");
const carriers = () => env("ENVIA_CARRIERS").split(",").map((s) => s.trim()).filter(Boolean);
const cpOk = (cp: unknown) => /^\d{4}$/.test(String(cp ?? ""));

async function requirePerm(req: Request, perm: string) {
  const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data } = await user.rpc("has_perm", { p: perm });
  if (data !== true) throw Object.assign(new Error("Sin permiso"), { status: 403 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    switch (body.action) {
      case "quote": {
        if (!cpOk(body.cp)) return json({ error: "Código postal inválido" }, 400);
        const [pkg, z] = await Promise.all([packageFor(body.items || []), zip(body.cp)]);
        const destination = { name: "Cliente", street: "A confirmar", number: "0", city: z.city, state: z.state, country: "AR", postalCode: body.cp };
        // Envia cotiza un transportista por llamada: se piden todos en paralelo.
        const results = await Promise.all(carriers().map((carrier) =>
          envia("/ship/rate/", { origin: origin(), destination, packages: [pkg], shipment: { carrier, type: 1 }, settings: { currency: "ARS" } })
            .then((r) => r.data || []).catch(() => [])));
        const options = results.flat().map((o: any) => ({
          carrier: o.carrier, service: o.service,
          descripcion: o.serviceDescription || o.service,
          precio: Number(o.totalPrice), dias: o.deliveryEstimate || null,
        })).filter((o) => o.precio > 0).sort((a, b) => a.precio - b.precio);
        return json({ options });
      }
      case "track": {
        const n = String(body.numero ?? "");
        if (!/^[A-Za-z0-9-]{6,40}$/.test(n)) return json({ error: "Número inválido" }, 400);
        const r = await envia("/ship/generaltrack/", { trackingNumbers: [n] });
        const t = r.data?.[0] || {};
        return json({ estado: t.status, carrier: t.carrier, eventos: t.eventHistory || [] });
      }
      case "create": {
        await requirePerm(req, "shipping.manage");
        const { data: o } = await db.from("orders")
          .select("id, status, shipping, tracking_number, profiles(full_name, email, phone), order_items(product_id, qty)")
          .eq("id", body.order_id).single();
        if (!o) return json({ error: "Pedido inexistente" }, 404);
        if (o.tracking_number) return json({ numero: o.tracking_number });
        if (!["paid", "preparing"].includes(o.status)) return json({ error: "El pedido tiene que estar pagado" }, 409);
        const s = o.shipping || {};
        if (!s.carrier || !s.cp) return json({ error: "El pedido no tiene datos de envío" }, 409);
        const p: any = o.profiles || {};
        const pkg = await packageFor(o.order_items.map((i: any) => ({ id: i.product_id, qty: i.qty })));
        const r = await envia("/ship/generate/", {
          origin: origin(),
          destination: {
            name: s.nombre || p.full_name, email: p.email, phone: s.telefono || p.phone,
            street: s.calle, number: s.numero, district: s.barrio || "", city: s.localidad, state: s.provincia,
            country: "AR", postalCode: s.cp, reference: [s.piso, s.depto].filter(Boolean).join(" "),
          },
          packages: [pkg],
          shipment: { carrier: s.carrier, service: s.service, type: 1 },
          settings: { printFormat: "PDF", printSize: "STOCK_4X6", currency: "ARS", comments: `Pedido EXE #${o.id}` },
        });
        const g = r.data?.[0];
        if (!g?.trackingNumber) return json({ error: "Envia no devolvió número de seguimiento" }, 502);
        await db.from("orders").update({
          carrier: g.carrier, tracking_number: g.trackingNumber, label_url: g.label, shipping_cost: g.totalPrice,
        }).eq("id", o.id);
        await db.from("order_events").insert({ order_id: o.id, from_status: o.status, to_status: o.status, actor: `envia:${g.carrier}:${g.trackingNumber}` });
        return json({ numero: g.trackingNumber, etiqueta: g.label, seguimiento: g.trackUrl });
      }
      default:
        return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, (e as any).status || 500);
  }
});
