// Pago online con Mercado Pago (Checkout Pro).
// La tienda manda solo { items:[{id, qty, variant}] } con la sesión del cliente. Precios y stock los pone la base
// (web_create_order); acá se crea la "preferencia" de pago y se devuelve el link de Mercado Pago.
// El pedido queda "pendiente" y SIN descontar stock: lo marca pagado mp-webhook cuando Mercado Pago acredita el pago.
//
// Interruptor: Panel → Integraciones → Mercado Pago. Apagado = responde 503 y la tienda no muestra el botón.
// Secrets: MP_ACCESS_TOKEN (y para el aviso de pago, MP_WEBHOOK_SECRET en mp-webhook).
// Deploy: supabase functions deploy pagos --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { sessionOf } from "../_shared/sesion.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const SITE = /^https:\/\/([a-z0-9-]+\.)*(exe\.com\.ar|github\.io)$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { data: on } = await db.rpc("integration_on", { p_key: "mercadopago" });
    if (on !== true || !env("MP_ACCESS_TOKEN")) return json({ error: "El pago online no está disponible" }, 503);

    const ses = await sessionOf(req, db);
    if (!ses) return json({ error: "Ingresá a tu cuenta para pagar online" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action !== "checkout") return json({ error: "Acción desconocida" }, 400);
    const items = Array.isArray(body.items) ? body.items.slice(0, 50).map((i: any) => ({
      id: String(i?.id ?? "").slice(0, 120), qty: Math.floor(Number(i?.qty) || 0), variant: String(i?.variant ?? "").slice(0, 80),
    })) : [];

    const { data: o, error } = await db.rpc("web_create_order", { p_uid: ses.uid, p_items: items, p_name: String(body.name ?? "").slice(0, 120) });
    if (error) return json({ error: error.message }, 400);

    const origin = req.headers.get("origin") ?? "";
    const back = SITE.test(origin) ? origin : "https://exe.com.ar";
    const { data: cfg } = await db.from("integrations").select("config").eq("key", "mercadopago").maybeSingle();
    const hours = Math.max(1, Number(cfg?.config?.pending_hours) || 72);
    const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("MP_ACCESS_TOKEN")}`, "Content-Type": "application/json", "X-Idempotency-Key": `exe-order-${o.order_id}` },
      body: JSON.stringify({
        items: o.items.map((i: any) => ({ id: i.id, title: i.title, quantity: i.quantity, unit_price: Number(i.unit_price), currency_id: "ARS" })),
        external_reference: String(o.order_id),
        statement_descriptor: "EXE",
        notification_url: `${env("SUPABASE_URL")}/functions/v1/mp-webhook`,
        back_urls: { success: `${back}/cuenta.html#pedidos`, pending: `${back}/cuenta.html#pedidos`, failure: `${back}/#carrito` },
        auto_return: "approved",
        expires: true,
        expiration_date_to: new Date(Date.now() + hours * 3600e3).toISOString(),
      }),
    });
    const p = await pref.json().catch(() => ({}));
    if (!pref.ok || !p.init_point) {
      await db.from("orders").update({ status: "cancelled" }).eq("id", o.order_id);
      return json({ error: "Mercado Pago no respondió. Probá de nuevo o pedí por WhatsApp" }, 502);
    }
    await db.from("orders").update({ payment_url: p.init_point }).eq("id", o.order_id);
    return json({ order_id: o.order_id, url: p.init_point });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
