// Webhook de Mercado Pago -> marca pedidos como pagados.
// Es la ÚNICA vía automática para pasar un pedido a "paid": no confía en lo que diga el navegador,
// sino que vuelve a consultar el pago directamente a la API de Mercado Pago con el token secreto.
//
// Secrets necesarios (Supabase > Edge Functions > Secrets):
//   MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: supabase functions deploy mp-webhook --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const paymentId = body?.data?.id;
  if (body?.type !== "payment" || !paymentId) return new Response("ignored", { status: 200 });

  // 1) Verificar el pago contra Mercado Pago (nunca confiar en el payload recibido)
  const mp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}` },
  });
  if (!mp.ok) return new Response("mp error", { status: 502 });
  const pay = await mp.json();
  if (pay.status !== "approved") return new Response("not approved", { status: 200 });

  // 2) El pedido se identifica por external_reference, que se fija al crear la preferencia de pago
  const orderId = Number(pay.external_reference);
  const { data: order } = await db.from("orders").select("id, total, status").eq("id", orderId).single();
  if (!order) return new Response("order not found", { status: 404 });

  // 3) El monto pagado tiene que coincidir con el total calculado por la base
  if (Number(pay.transaction_amount) < Number(order.total)) {
    return new Response("amount mismatch", { status: 409 });
  }
  if (order.status !== "pending") return new Response("already processed", { status: 200 });

  await db.from("orders").update({
    status: "paid", paid_at: new Date().toISOString(), paid_by: "mercadopago", payment_ref: String(paymentId),
  }).eq("id", orderId);
  await db.from("order_events").insert({ order_id: orderId, from_status: "pending", to_status: "paid", actor: "mercadopago" });

  // 4) Email automático de confirmación
  await db.functions.invoke("send-email", { body: { template: "order_paid", order_id: orderId } });

  return new Response("ok", { status: 200 });
});
