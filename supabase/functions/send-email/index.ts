// Emails automáticos de pedidos (vía Resend). Las plantillas están en ../_shared/emails.js.
// Se invoca desde otras funciones o desde un Database Webhook de Supabase:
//   POST { template: "order_created" | "order_paid" | "order_shipped" | "order_delivered" | "order_cancelled", order_id, reason? }
// "order_created" además avisa al equipo (ADMIN_EMAIL) con la plantilla admin_new_order.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM ("EXE <ventas@exe.com.ar>"), ADMIN_EMAIL (ej. ventas@exe.com.ar),
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: supabase functions deploy send-email
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { orderTemplates } from "../_shared/emails.js";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

async function send(to: string, subject: string, html: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM"), reply_to: env("ADMIN_EMAIL") || undefined, to, subject, html }),
  });
  return { status: r.status, body: await r.text() };
}

Deno.serve(async (req) => {
  // Solo llamadas internas (service role)
  if (req.headers.get("Authorization") !== `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return new Response("forbidden", { status: 403 });
  }
  const { template, order_id, reason } = await req.json();
  const tpl = (orderTemplates as any)[template];
  if (!tpl || template === "admin_new_order") return new Response("unknown template", { status: 400 });

  const { data: o } = await db
    .from("orders")
    .select("id, total, note, shipping, shipping_cost, carrier, tracking_number, profiles(email, full_name, phone, email_verified_at), order_items(qty, variant, unit_price, products(name))")
    .eq("id", order_id).single();
  if (!o) return new Response("order not found", { status: 404 });
  const p: any = o.profiles || {};

  // Solo se escribe a cuentas con el email confirmado (evita mandar correo a direcciones falsas).
  if (!p.email_verified_at) return new Response("email no verificado", { status: 409 });

  const s: any = o.shipping || {};
  const data = {
    id: o.id, total: o.total, name: p.full_name, email: p.email, phone: p.phone, note: o.note, reason,
    items: (o.order_items || []).map((i: any) => ({ qty: i.qty, variant: i.variant, unit_price: i.unit_price, name: i.products?.name })),
    shipping: o.shipping_cost ? { cost: o.shipping_cost, label: [o.carrier, s.service].filter(Boolean).join(" · ") } : null,
    carrier: o.carrier, tracking: o.tracking_number,
    trackUrl: o.tracking_number ? `https://envia.com/es-AR/rastreo?label=${encodeURIComponent(o.tracking_number)}` : null,
  };

  const { subject, html } = tpl(data);
  const res = await send(p.email, subject, html);
  if (template === "order_created" && env("ADMIN_EMAIL")) {
    const a = orderTemplates.admin_new_order(data);
    await send(env("ADMIN_EMAIL"), a.subject, a.html);
  }
  return new Response(res.body, { status: res.status });
});
