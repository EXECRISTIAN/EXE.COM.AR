// Envío de reportes por email (vía Resend). Los datos los arma la base (public._report_data / report_generate).
//   POST { action: "send_pending" }   ← tarea automática de la base (header x-cron-key = clave reports_cron_key de Vault)
//   POST { action: "send", id }        ← panel (usuario con finance.manage; la base lo valida con RLS)
// Secrets: RESEND_API_KEY, EMAIL_FROM, ADMIN_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const money = (n: number) => "$" + Math.round(Number(n || 0)).toLocaleString("es-AR");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fdate = (d: string) => d.split("-").reverse().join("/");
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function render(r: any) {
  const d = r.data || {}, period = `${fdate(r.period_from)} al ${fdate(r.period_to)}`;
  const row = (k: string, v: string, bold = false) => `<tr><td style="padding:6px 0;color:#555">${k}</td><td style="padding:6px 0;text-align:right${bold ? ";font-weight:700" : ""}">${v}</td></tr>`;
  let title: string, body: string;
  if (r.kind === "resumen") {
    const gross = d.income - d.cogs, net = gross - d.expenses;
    title = `Resumen de EXE — ${period}`;
    body = `<table style="width:100%;border-collapse:collapse">${row("Ventas (pedidos pagados)", money(d.income))}${row("Pedidos", String(d.orders))}
      ${row("Costo de lo vendido", money(d.cogs))}${row("Ganancia bruta", money(gross))}${row("Gastos cargados", money(d.expenses))}${row("Resultado", money(net), true)}
      ${row("Visitas / personas", `${d.visits} / ${d.people}`)}</table>
      ${d.no_cost_units ? `<p style="color:#b45309">⚠️ ${d.no_cost_units} unidades vendidas sin costo cargado.</p>` : ""}
      ${(d.top || []).length ? `<h3>Lo más vendido</h3><ul>${d.top.map((t: any) => `<li>${esc(t.name)} — ${t.qty} u. · ${money(t.sale)}</li>`).join("")}</ul>` : ""}
      ${(d.low_stock || []).length ? `<h3>Stock bajo</h3><ul>${d.low_stock.map((p: any) => `<li>${esc(p.name)} — ${p.stock > 0 ? `quedan ${p.stock}` : "sin stock"}</li>`).join("")}</ul>` : ""}`;
  } else {
    title = `Ventas para ARCA — ${period}`;
    const mono = d.regime === "monotributo";
    body = `<table style="width:100%;border-collapse:collapse">${row("Total cobrado", money(d.income), true)}${row("Operaciones", String(d.orders))}
      ${row("Por Mercado Pago", money(d.mp))}${row("Transferencia / efectivo", money(d.manual))}
      ${mono ? row("Últimos 12 meses", money(d.last12)) + (d.limit ? row("Tope de tu categoría", `${money(d.limit)} (usado ${Math.round((d.last12 / d.limit) * 100)}%)`) : "")
        : row("Neto gravado (estimado, IVA 21%)", money(d.income / 1.21)) + row("IVA débito (estimado)", money(d.income - d.income / 1.21))}</table>
      ${(d.by_month || []).length > 1 ? `<h3>Por mes</h3><ul>${d.by_month.map((m: any) => `<li>${MES[Number(m.m.slice(5)) - 1]} ${m.m.slice(0, 4)}: ${money(m.t)} (${m.n} op.)</li>`).join("")}</ul>` : ""}
      ${mono && d.limit && d.last12 / d.limit >= 0.8 ? `<p style="color:#b45309">⚠️ Estás cerca del tope de tu categoría: revisá la recategorización con tu contador.</p>` : ""}
      <p style="color:#777;font-size:12px">Ayuda para tu contador: no reemplaza facturas ni declaraciones juradas. El detalle por día está en el panel → Reportes (Descargar Excel).</p>`;
  }
  return { subject: title, html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111"><h2 style="margin:0 0 12px">${esc(title)}</h2>${body}
    <p style="color:#777;font-size:12px;margin-top:24px">Reporte ${r.auto ? "automático" : "enviado desde el panel"} de exe.com.ar. Se configura en Panel → Reportes.</p></div>` };
}

async function deliver(r: any) {
  const { data: s } = await admin.from("report_settings").select("recipients").eq("kind", r.kind).single();
  const to = (s?.recipients?.length ? s.recipients : [env("ADMIN_EMAIL")]).filter(Boolean);
  let error: string | null = null;
  if (!env("RESEND_API_KEY") || !env("EMAIL_FROM")) error = "Falta configurar el envío de emails (clave de Resend)";
  else if (!to.length) error = "No hay destinatarios";
  else {
    const { subject, html } = render(r);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("EMAIL_FROM"), to, subject, html }),
    });
    if (!res.ok) error = `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
  }
  await admin.from("reports").update(error ? { email_error: error } : { emailed_at: new Date().toISOString(), email_error: null }).eq("id", r.id);
  return error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  if (body.action === "send_pending") {
    // La clave vive en Vault (la genera la base); se compara allá, nunca sale de la base.
    const { data: ok } = await admin.rpc("_reports_cron_key_ok", { k: req.headers.get("x-cron-key") ?? "" });
    if (ok !== true) return json({ error: "forbidden" }, 403);
    const { data } = await admin.from("reports").select("*").eq("auto", true).is("emailed_at", null).is("email_error", null).limit(20);
    const out = [];
    for (const r of data || []) out.push({ id: r.id, error: await deliver(r) });
    return json({ sent: out });
  }
  if (body.action === "send") {
    // Con la sesión del usuario: si no tiene finance.manage (y verificación en dos pasos), RLS no le devuelve el reporte.
    const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: r } = await user.from("reports").select("*").eq("id", Number(body.id)).maybeSingle();
    if (!r) return json({ error: "Sin permiso o el reporte no existe" }, 403);
    const error = await deliver(r);
    return error ? json({ error }, 502) : json({ ok: true });
  }
  return json({ error: "acción desconocida" }, 400);
});
