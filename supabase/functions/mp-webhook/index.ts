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
  const { data: order } = await db.from("orders").select("id, total, status, user_id").eq("id", orderId).single();
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

  // 4) Verificación automática de identidad (sin IA): documento de la cuenta vs. pagador y titular de la tarjeta
  await checkIdentity(orderId, order.user_id, pay).catch(() => {});

  // 5) Email automático de confirmación
  await db.functions.invoke("send-email", { body: { template: "order_paid", order_id: orderId } });

  return new Response("ok", { status: 200 });
});

// Compara el documento cargado en la cuenta con los que informa Mercado Pago. No frena el pago:
// deja el pedido marcado para que se revise antes de despachar si algo no coincide.
async function checkIdentity(orderId: number, userId: string | null, pay: any) {
  const { data: prof } = userId
    ? await db.from("profiles").select("full_name, doc_number").eq("id", userId).maybeSingle()
    : { data: null };
  const cuenta = prof?.doc_number ? await nucleo(prof.doc_number) : null;
  const pagos = [pay?.payer?.identification?.number, pay?.card?.cardholder?.identification?.number]
    .filter(Boolean).map(String);
  const nucleos = (await Promise.all(pagos.map(nucleo))).filter(Boolean);

  let res: "coincide" | "no_coincide" | "sin_datos";
  if (!cuenta || !nucleos.length) res = "sin_datos";
  else res = nucleos.includes(cuenta) ? "coincide" : "no_coincide";

  const partes = [
    `Cuenta: ${prof?.doc_number || "sin documento"}`,
    `Mercado Pago: ${pagos.join(" / ") || "sin documento"}`,
  ];
  const titular = String(pay?.card?.cardholder?.name || "").trim();
  if (titular) {
    const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
    const a = new Set(norm(prof?.full_name || "")), comun = norm(titular).some((w) => a.has(w));
    partes.push(`Titular de la tarjeta: ${titular} (${comun ? "el nombre coincide" : "el nombre NO coincide"})`);
  }
  await db.from("orders").update({ id_check: res, id_check_detail: partes.join(" · ") }).eq("id", orderId);
}

async function nucleo(t: string): Promise<string | null> {
  const { data } = await db.rpc("doc_nucleo", { t });
  return data || null;
}
