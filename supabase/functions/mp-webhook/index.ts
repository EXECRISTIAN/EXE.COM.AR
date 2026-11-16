// Webhook de Mercado Pago -> marca pedidos como pagados.
// Es la ÚNICA vía automática para pasar un pedido a "paid": no confía en lo que diga el aviso,
// vuelve a consultar el pago directamente a la API de Mercado Pago con el token secreto.
//
// Interruptor: Panel → Integraciones → Mercado Pago. Apagado = ignora todo (responde 200 para que MP no reintente).
// Secrets (Supabase > Edge Functions > Secrets):
//   MP_ACCESS_TOKEN     token de producción o de prueba (Mercado Pago → Tus integraciones → Credenciales)
//   MP_WEBHOOK_SECRET   "clave secreta" de la sección Webhooks de la misma aplicación (valida la firma x-signature)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (los pone Supabase)
// Deploy: supabase functions deploy mp-webhook --no-verify-jwt
// URL a cargar en Mercado Pago → Webhooks (evento "Pagos"): https://<proyecto>.supabase.co/functions/v1/mp-webhook
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const say = (t: string, status = 200) => new Response(t, { status });

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Firma de Mercado Pago: x-signature = "ts=...,v1=..."; manifest "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
async function signatureOk(req: Request, dataId: string) {
  const secret = env("MP_WEBHOOK_SECRET");
  if (!secret) return false;
  const parts = Object.fromEntries((req.headers.get("x-signature") ?? "").split(",").map((p) => p.trim().split("=", 2)));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${req.headers.get("x-request-id") ?? ""};ts:${parts.ts};`;
  const expected = await hmacHex(secret, manifest);
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const { data: on } = await db.rpc("integration_on", { p_key: "mercadopago" });
  if (on !== true || !env("MP_ACCESS_TOKEN")) return say("disabled");

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const type = body?.type ?? url.searchParams.get("type");
  const paymentId = String(body?.data?.id ?? url.searchParams.get("data.id") ?? "");
  if (type !== "payment" || !/^\d{1,30}$/.test(paymentId)) return say("ignored");
  if (!(await signatureOk(req, url.searchParams.get("data.id") ?? paymentId))) return say("bad signature", 401);

  // 1) Verificar el pago contra Mercado Pago (nunca confiar en el aviso recibido)
  const mp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env("MP_ACCESS_TOKEN")}` },
  });
  if (!mp.ok) return say("mp error", 502);
  const pay = await mp.json();
  if (pay.status !== "approved") return say("not approved");

  // 2) El pedido se identifica por external_reference (se fija al crear el pago en la función "pagos")
  const orderId = Number(pay.external_reference);
  if (!Number.isSafeInteger(orderId)) return say("no reference");
  const { data: order } = await db.from("orders").select("id, total, status").eq("id", orderId).maybeSingle();
  if (!order) return say("order not found", 404);

  // 3) Moneda y monto tienen que coincidir con lo calculado por la base
  if (pay.currency_id !== "ARS") return say("currency mismatch", 409);
  if (Number(pay.transaction_amount) + 0.01 < Number(order.total)) return say("amount mismatch", 409);

  // 4) Marca pagado y descuenta el stock (una sola vez: si ya estaba pagado devuelve false)
  const { data: changed, error } = await db.rpc("web_order_paid", { p_order: orderId, p_ref: paymentId });
  if (error) return say("db error", 500);
  if (!changed) return say("already processed");

  // 5) Email de confirmación y factura automática (si no están configurados, no frenan nada)
  await db.functions.invoke("send-email", { body: { template: "order_paid", order_id: orderId } }).catch(() => {});
  await db.functions.invoke("arca", { body: { action: "auto", order_id: orderId } }).catch(() => {});
  return say("ok");
});
