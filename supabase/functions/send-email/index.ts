// Emails automáticos a usuarios (vía Resend, plan gratis: 3.000 emails/mes).
// Se invoca desde otras funciones o desde un Database Webhook de Supabase.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (ej: "EXE <ventas@exe.com.ar>"), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: supabase functions deploy send-email
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const money = (n: number) => "$" + Number(n).toLocaleString("es-AR");

const templates: Record<string, (o: any) => { subject: string; html: string }> = {
  order_created: (o) => ({
    subject: `Recibimos tu pedido #${o.id}`,
    html: `<h2>¡Gracias, ${o.name}!</h2><p>Recibimos tu pedido #${o.id} por ${money(o.total)}.</p>${o.itemsHtml}<p>Te avisamos cuando se acredite el pago.</p>`,
  }),
  order_paid: (o) => ({
    subject: `Pago confirmado — pedido #${o.id}`,
    html: `<h2>¡Pago acreditado!</h2><p>Tu pedido #${o.id} ya está confirmado y lo estamos preparando.</p>${o.itemsHtml}`,
  }),
  order_shipped: (o) => ({
    subject: `Tu pedido #${o.id} está en camino`,
    html: `<h2>¡Salió tu pedido!</h2><p>Tu pedido #${o.id} fue despachado.</p>`,
  }),
};

Deno.serve(async (req) => {
  // Solo llamadas internas (service role)
  if (req.headers.get("Authorization") !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return new Response("forbidden", { status: 403 });
  }
  const { template, order_id } = await req.json();
  const tpl = templates[template];
  if (!tpl) return new Response("unknown template", { status: 400 });

  const { data: o } = await db
    .from("orders")
    .select("id, total, profiles(email, full_name), order_items(qty, unit_price, products(name))")
    .eq("id", order_id).single();
  if (!o) return new Response("order not found", { status: 404 });

  const itemsHtml = "<ul>" + o.order_items
    .map((i: any) => `<li>${i.qty} x ${i.products.name} — ${money(i.qty * i.unit_price)}</li>`).join("") + "</ul>";
  const { subject, html } = tpl({ id: o.id, total: o.total, name: o.profiles.full_name ?? "", itemsHtml });

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: o.profiles.email, subject, html }),
  });
  return new Response(await r.text(), { status: r.status });
});
