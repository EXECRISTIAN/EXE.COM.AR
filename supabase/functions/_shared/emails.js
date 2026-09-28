// Plantillas de email de EXE (una sola fuente para la tienda y para Supabase Auth).
// JavaScript puro: lo usan la Edge Function send-email (Deno) y scripts/build-emails.mjs (Node).
// Diseño: tabla + estilos en línea (compatible con Gmail, Outlook, Apple Mail), colores reales de Astra.

export const BRAND = {
  name: "EXE",
  site: "https://execristian.github.io/EXE.COM.AR/",   // cambiar a https://www.exe.com.ar/ al migrar
  logo: "https://execristian.github.io/EXE.COM.AR/assets/img/logo-oscuro.png",
  whatsapp: "5491130095254",
  phone: "+54 9 11 3009 5254",
  email: "ventas@exe.com.ar",
  accent: "#0084d6",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const cap = (s) => String(s ?? "").replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
const F = "Lato, 'Segoe UI', Arial, Helvetica, sans-serif";

export function button(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="border-radius:15px;background:${BRAND.accent}">
  <a href="${href}" style="display:inline-block;padding:13px 26px;font:700 15px ${F};color:#ffffff;text-decoration:none;border-radius:15px">${esc(label)}</a></td></tr></table>`;
}

// Estructura común: franja negra con el logo blanco (igual que el header del sitio en modo oscuro/original),
// tarjeta blanca, pie con contacto. `why` explica por qué recibe el email (buena práctica anti-spam).
export function layout({ preheader, title, body, why }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f7f9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f9"><tr><td align="center" style="padding:24px 12px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td align="center" style="background:#000000;border-radius:14px 14px 0 0;padding:22px">
   <a href="${BRAND.site}"><img src="${BRAND.logo}" width="106" height="55" alt="EXE" style="display:block;border:0"></a></td></tr>
  <tr><td style="background:#ffffff;padding:32px 30px;font:16px/1.6 ${F};color:#333333">
   <h1 style="margin:0 0 14px;font:700 22px/1.3 ${F};color:#000000">${esc(title)}</h1>
   ${body}
  </td></tr>
  <tr><td style="background:#ffffff;border-top:1px solid #e2e2e2;border-radius:0 0 14px 14px;padding:20px 30px;font:13px/1.6 ${F};color:#6b7280">
   ¿Dudas? Escribinos por <a href="https://wa.me/${BRAND.whatsapp}" style="color:${BRAND.accent}">WhatsApp ${BRAND.phone}</a>
   o respondé este email.<br>
   <a href="${BRAND.site}" style="color:${BRAND.accent}">exe.com.ar</a> · Hardware y componentes para armar tu PC
  </td></tr>
  <tr><td style="padding:14px 30px;font:12px/1.5 ${F};color:#9aa0a8;text-align:center">${esc(why)}</td></tr>
 </table>
</td></tr></table></body></html>`;
}

// Tabla de productos del pedido.
export function itemsTable(items = [], total, shipping) {
  const rows = items.map((i) => `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #eeeeee">${esc(i.qty)} × ${esc(i.name)}${i.variant ? ` <span style="color:#6b7280">(${esc(i.variant)})</span>` : ""}</td>
    <td align="right" style="padding:10px 0;border-bottom:1px solid #eeeeee;white-space:nowrap">${money(i.qty * i.unit_price)}</td></tr>`).join("");
  const ship = shipping ? `<tr><td style="padding:10px 0;color:#6b7280">Envío${shipping.label ? ` (${esc(shipping.label)})` : ""}</td><td align="right" style="padding:10px 0;color:#6b7280">${money(shipping.cost)}</td></tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;font:15px ${F};color:#333333">${rows}${ship}
   <tr><td style="padding:12px 0 0;font-weight:700;color:#000">Total</td><td align="right" style="padding:12px 0 0;font-weight:700;color:#000">${money(total)}</td></tr></table>`;
}

const hello = (name) => `<p style="margin:0 0 12px">Hola${name ? ` ${esc(String(name).split(" ")[0])}` : ""},</p>`;
const WHY_ORDER = "Recibís este email porque hiciste un pedido en EXE. Es un aviso sobre tu compra, no publicidad.";

// ---------- Emails de la tienda (los envía la Edge Function send-email) ----------
// o = { id, name, total, items:[{qty,name,variant,unit_price}], shipping?, carrier?, tracking?, trackUrl?, reason?, email?, phone?, note? }
export const orderTemplates = {
  order_created: (o) => ({
    subject: `Recibimos tu pedido #${o.id}`,
    html: layout({
      preheader: `Pedido #${o.id} por ${money(o.total)}. Te contamos los próximos pasos.`,
      title: "¡Gracias por tu pedido!",
      why: WHY_ORDER,
      body: `${hello(o.name)}<p style="margin:0">Recibimos tu pedido <b>#${o.id}</b> y ya lo estamos revisando. Este es el resumen:</p>
        ${itemsTable(o.items, o.total, o.shipping)}
        <p style="margin:0 0 6px"><b>¿Qué sigue?</b></p>
        <ol style="margin:0 0 6px;padding-left:20px"><li>Confirmamos stock y precio final.</li><li>Te enviamos cómo pagar (o confirmamos tu pago si ya lo hiciste).</li><li>Preparamos y despachamos tu pedido.</li></ol>
        ${button("Ver mi pedido", BRAND.site + "cuenta.html")}`,
    }),
  }),
  order_paid: (o) => ({
    subject: `Pago confirmado — pedido #${o.id}`,
    html: layout({
      preheader: `Acreditamos tu pago de ${money(o.total)}. Ya estamos preparando tu pedido.`,
      title: "¡Pago confirmado!",
      why: WHY_ORDER,
      body: `${hello(o.name)}<p style="margin:0">Acreditamos el pago de tu pedido <b>#${o.id}</b>. Ya lo estamos preparando y te avisamos apenas salga.</p>
        ${itemsTable(o.items, o.total, o.shipping)}${button("Ver mi pedido", BRAND.site + "cuenta.html")}`,
    }),
  }),
  order_shipped: (o) => ({
    subject: `Tu pedido #${o.id} está en camino`,
    html: layout({
      preheader: o.tracking ? `Seguimiento: ${o.tracking}` : "Tu pedido salió hacia tu domicilio.",
      title: "¡Tu pedido está en camino!",
      why: WHY_ORDER,
      body: `${hello(o.name)}<p style="margin:0 0 12px">Despachamos tu pedido <b>#${o.id}</b>${o.carrier ? ` con <b>${esc(cap(o.carrier))}</b>` : ""}.</p>
        ${o.tracking ? `<p style="margin:0">Número de seguimiento: <b style="font-size:17px;color:#000">${esc(o.tracking)}</b></p>` : ""}
        ${o.trackUrl ? button("Seguir mi envío", o.trackUrl) : button("Ver mi pedido", BRAND.site + "cuenta.html")}
        <p style="margin:0;color:#6b7280;font-size:14px">El seguimiento puede tardar unas horas en mostrar movimientos.</p>`,
    }),
  }),
  order_delivered: (o) => ({
    subject: `Pedido #${o.id} entregado`,
    html: layout({
      preheader: "Tu pedido fue entregado. ¡Que lo disfrutes!",
      title: "¡Pedido entregado!",
      why: WHY_ORDER,
      body: `${hello(o.name)}<p style="margin:0 0 12px">Tu pedido <b>#${o.id}</b> figura como entregado. ¡Esperamos que lo disfrutes!</p>
        <p style="margin:0">Si algo no llegó bien o necesitás ayuda con la instalación o la garantía, escribinos y lo resolvemos.</p>
        ${button("Hablar por WhatsApp", `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(`Hola EXE, consulta por mi pedido #${o.id}`)}`)}`,
    }),
  }),
  order_cancelled: (o) => ({
    subject: `Pedido #${o.id} cancelado`,
    html: layout({
      preheader: "Cancelamos tu pedido. Si fue un error, escribinos.",
      title: "Tu pedido fue cancelado",
      why: WHY_ORDER,
      body: `${hello(o.name)}<p style="margin:0 0 12px">Cancelamos tu pedido <b>#${o.id}</b>${o.reason ? `: ${esc(o.reason)}` : "."}</p>
        <p style="margin:0">Si ya habías pagado, te devolvemos el dinero por el mismo medio. Si fue un error o querés rehacerlo, escribinos.</p>
        ${button("Hablar por WhatsApp", `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(`Hola EXE, consulta por el pedido cancelado #${o.id}`)}`)}`,
    }),
  }),
  // Aviso interno al equipo (va a ventas@).
  admin_new_order: (o) => ({
    subject: `🛒 Nuevo pedido #${o.id} — ${money(o.total)}`,
    html: layout({
      preheader: `${o.name || "Cliente"} · ${money(o.total)}`,
      title: `Nuevo pedido #${o.id}`,
      why: "Aviso interno del sistema de pedidos de EXE.",
      body: `<p style="margin:0 0 6px"><b>Cliente:</b> ${esc(o.name || "—")}</p>
        <p style="margin:0 0 6px"><b>Email:</b> ${esc(o.email || "—")} · <b>Tel:</b> ${esc(o.phone || "—")}</p>
        ${o.note ? `<p style="margin:0 0 6px"><b>Nota:</b> ${esc(o.note)}</p>` : ""}
        ${itemsTable(o.items, o.total, o.shipping)}${button("Abrir en el panel", BRAND.site + "admin/#pedidos")}`,
    }),
  }),
};

// ---------- Emails de cuenta (los manda Supabase Auth; se pegan en Authentication → Email Templates) ----------
// Usan las variables de Supabase: {{ .ConfirmationURL }}, {{ .Email }}, {{ .NewEmail }}.
const WHY_ACCOUNT = "Recibís este email porque se usó esta dirección en exe.com.ar. Si no fuiste vos, ignoralo: no se hará ningún cambio.";
export const authTemplates = {
  confirmation: {
    subject: "Confirmá tu cuenta en EXE",
    html: layout({
      preheader: "Un clic para activar tu cuenta.",
      title: "Confirmá tu cuenta",
      why: WHY_ACCOUNT,
      body: `<p style="margin:0">¡Bienvenido/a a EXE! Para activar tu cuenta y verificar que este email es tuyo, tocá el botón:</p>
        ${button("Confirmar mi cuenta", "{{ .ConfirmationURL }}")}
        <p style="margin:0;color:#6b7280;font-size:14px">Con tu cuenta vas a poder ver tus pedidos y su seguimiento. El enlace vence en 24 horas.</p>`,
    }),
  },
  recovery: {
    subject: "Restablecé tu contraseña de EXE",
    html: layout({
      preheader: "Elegí una contraseña nueva para tu cuenta.",
      title: "Restablecer contraseña",
      why: WHY_ACCOUNT,
      body: `<p style="margin:0">Pediste restablecer la contraseña de <b>{{ .Email }}</b>. Tocá el botón para elegir una nueva:</p>
        ${button("Elegir contraseña nueva", "{{ .ConfirmationURL }}")}
        <p style="margin:0;color:#6b7280;font-size:14px">Si no lo pediste vos, ignorá este email: tu contraseña actual sigue funcionando. El enlace vence en 1 hora.</p>`,
    }),
  },
  email_change: {
    subject: "Confirmá tu nuevo email en EXE",
    html: layout({
      preheader: "Confirmá el cambio de email de tu cuenta.",
      title: "Confirmá tu nuevo email",
      why: WHY_ACCOUNT,
      body: `<p style="margin:0">Pediste cambiar el email de tu cuenta de <b>{{ .Email }}</b> a <b>{{ .NewEmail }}</b>. Para confirmarlo, tocá el botón:</p>
        ${button("Confirmar nuevo email", "{{ .ConfirmationURL }}")}`,
    }),
  },
};

// ---------- Plantillas editables desde el panel (tabla email_templates) ----------
// El texto se escribe plano: línea en blanco = párrafo nuevo; "1. …" = lista; {{variable}} se reemplaza (con escape).
// {{resumen}} en una línea sola inserta la tabla del pedido. Nunca se interpreta HTML escrito en el panel.
export const TEMPLATE_VARS = {
  nombre: "Nombre del cliente", pedido: "Número de pedido", total: "Total del pedido", email: "Email del cliente",
  telefono: "Teléfono del cliente", nota: "Nota del pedido", transportista: "Empresa de envío", seguimiento: "Número de seguimiento",
  motivo: "Motivo de cancelación", resumen: "Tabla con los productos (en una línea sola)", link_cuenta: "Link a Mi cuenta",
  link_seguimiento: "Link de seguimiento del envío", link_whatsapp: "Link a WhatsApp", link_panel: "Link al panel",
};
export const SAMPLE_ORDER = {
  id: 1042, name: "Juan Pérez", email: "juan@mail.com", phone: "+54 9 11 5555-5555", total: 452000, note: "Entregar por la tarde",
  items: [{ qty: 1, name: "Procesador AMD Ryzen 5 8500G", unit_price: 359100 }, { qty: 2, name: "Memoria Team DDR4 8GB 3600MHz", variant: "Negra", unit_price: 46450 }],
  shipping: { cost: 0, label: "Andreani · Estándar" }, carrier: "andreani", tracking: "360000012345670",
  trackUrl: "https://envia.com/es-AR/rastreo?label=360000012345670", reason: "Sin stock del producto",
};
function templateValues(o) {
  const first = o.name ? String(o.name).split(" ")[0] : "";
  return {
    nombre: first, pedido: o.id ?? "", total: money(o.total), email: o.email || "", telefono: o.phone || "", nota: o.note || "—",
    transportista: o.carrier ? cap(o.carrier) : "nuestro correo", seguimiento: o.tracking || "(te lo enviamos apenas esté)",
    motivo: o.reason || "", link_cuenta: BRAND.site + "cuenta.html", link_seguimiento: o.trackUrl || BRAND.site + "cuenta.html",
    link_whatsapp: `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(`Hola EXE, consulta por mi pedido #${o.id ?? ""}`)}`,
    link_panel: BRAND.site + "admin/#pedidos",
  };
}
const fill = (text, v) => String(text ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in v ? String(v[k]) : m));
export function renderTemplate(t, o = SAMPLE_ORDER) {
  const v = templateValues(o);
  const blocks = String(t.body || "").replace(/\r/g, "").replace(/\{\{\s*resumen\s*\}\}/g, "\n\n{{resumen}}\n\n").split(/\n\s*\n/).filter((b) => b.trim());
  const html = blocks.map((b) => {
    if (/^\s*\{\{\s*resumen\s*\}\}\s*$/.test(b)) return itemsTable(o.items, o.total, o.shipping);
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
      return `<ol style="margin:0 0 14px;padding-left:20px">${lines.map((l) => `<li>${esc(fill(l.replace(/^\s*\d+[.)]\s+/, ""), v))}</li>`).join("")}</ol>`;
    return `<p style="margin:0 0 14px">${lines.map((l) => esc(fill(l, v))).join("<br>")}</p>`;
  }).join("");
  const url = fill(t.button_url, v);
  const btn = t.button_label && /^https?:\/\//.test(url) ? button(fill(t.button_label, v), esc(url)) : "";
  const items = t.show_items && !/\{\{\s*resumen\s*\}\}/.test(t.body || "") ? itemsTable(o.items, o.total, o.shipping) : "";
  return {
    subject: fill(t.subject, v),
    html: layout({ preheader: fill(t.preheader || "", v), title: fill(t.title, v), why: fill(t.why || "", v), body: html + items + btn }),
  };
}
