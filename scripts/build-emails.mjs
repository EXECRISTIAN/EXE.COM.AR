// Genera docs/emails/*.html: vistas previas de todas las plantillas y el HTML listo para pegar
// en Supabase → Authentication → Email Templates.  Uso: node scripts/build-emails.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { orderTemplates, authTemplates } from "../supabase/functions/_shared/emails.js";

const out = new URL("../docs/emails/", import.meta.url);
mkdirSync(out, { recursive: true });
const sample = {
  id: 1024, name: "Juan Pérez", email: "cliente@ejemplo.com", phone: "11 5555-5555", note: "Retiro por la tarde",
  total: 721319, reason: "sin stock del producto",
  items: [
    { qty: 1, name: "Procesador Intel Core i5 13400 4.6GHz Turbo Socket 1700", unit_price: 418500 },
    { qty: 1, name: "Mother ASUS PRIME A620M-A - AM5 - CSM", unit_price: 253000 },
    { qty: 1, name: "Memoria Team DDR4 8GB 3600MHz T-Force Delta RGB", variant: "Black", unit_price: 52380 },
  ],
  carrier: "andreani", tracking: "360000012345670",
  trackUrl: "https://envia.com/es-AR/rastreo?label=360000012345670",
};
sample.total = sample.items.reduce((n, i) => n + i.qty * i.unit_price, 0);

const index = [];
for (const [k, fn] of Object.entries(orderTemplates)) {
  const { subject, html } = fn(sample);
  writeFileSync(new URL(`pedido-${k}.html`, out), html); index.push([`pedido-${k}.html`, subject]);
}
for (const [k, t] of Object.entries(authTemplates)) {
  writeFileSync(new URL(`cuenta-${k}.html`, out), t.html); index.push([`cuenta-${k}.html`, t.subject]);
}
writeFileSync(new URL("README.md", out),
  "# Plantillas de email (generadas)\n\nNo editar estos archivos: editar `supabase/functions/_shared/emails.js` y correr `node scripts/build-emails.mjs`.\n\n" +
  "| Archivo | Asunto |\n|---|---|\n" + index.map(([f, s]) => `| [${f}](${f}) | ${s} |`).join("\n") +
  "\n\nLos `cuenta-*.html` se pegan en Supabase → Authentication → Email Templates (Confirm signup, Reset password, Change email).\n");
console.log(index.length, "plantillas");
