// Prueba de punta a punta del flujo de compra de la tienda (la corre GitHub en cada cambio: .github/workflows/pruebas.yml).
// Levanta la carpeta site/ en un servidor local, abre la tienda en Chromium y hace lo que haría un cliente:
// ver productos → agregar uno al carrito → abrir el carrito → enviar el pedido por WhatsApp (aceptando el aviso de
// grados si es outlet). Verifica que el link de WhatsApp lleve el número de EXE, el producto y el total.
// No envía nada: el link de WhatsApp se intercepta. Los datos salen de Supabase (o de site/data/products.json si no responde).
// Uso local: node tests/e2e/compra.mjs   (necesita playwright)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SITE = fileURLToPath(new URL("../../site/", import.meta.url));
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" };
const srv = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname); if (path.endsWith("/")) path += "index.html";
  try { const b = await readFile(normalize(join(SITE, path))); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(b); }
  catch (e) { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((ok) => srv.once("listening", ok));
const base = `http://127.0.0.1:${srv.address().port}`;

const fail = (m) => { throw new Error(m); };
const browser = await chromium.launch();
let waUrl = null;
const errors = [];
try {
  for (const [name, viewport] of [["compu", { width: 1280, height: 900 }], ["celular", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport });
    await ctx.route(/https:\/\/(api\.)?wa\.me\//, (r) => { waUrl = r.request().url(); r.fulfill({ body: "ok" }); });
    await ctx.route(/googletagmanager|static\.cloudflareinsights/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    ctx.on("page", (p) => { const u = p.url(); if (/wa\.me/.test(u)) waUrl = u; p.on("framenavigated", (f) => { if (/wa\.me/.test(f.url())) waUrl = f.url(); }); });
    waUrl = null;
    await page.goto(`${base}/index.html?demo=1`, { waitUntil: "load" });
    await page.waitForSelector("#productGrid .card [data-add]:not([disabled])", { timeout: 20000 });
    const cards = await page.locator("#productGrid > .card:not([data-peek])").count();
    if (cards < 1) fail(`${name}: no se ven productos`);
    const btn = page.locator("#productGrid > .card:not([data-peek]) [data-add]:not([disabled])").first();
    const productName = (await btn.locator("xpath=ancestor::article").locator("h3").innerText()).trim();
    await btn.click();
    await page.waitForFunction(() => document.getElementById("cartCount").textContent.trim() === "1", null, { timeout: 5000 });
    await page.click("#cartOpen");
    await page.waitForSelector("#cart.open, #cart[aria-hidden='false']", { timeout: 5000 });
    if (!(await page.locator("#cartItems li").count())) fail(`${name}: el carrito está vacío`);
    await page.fill("#customerName", "Prueba automática");
    await page.click("#sendWa");
    if (await page.locator("#ackDialog").isVisible().catch(() => false)) { await page.check("#ackCheck"); await page.click("#ackOk"); }
    for (let i = 0; i < 50 && !waUrl; i++) await page.waitForTimeout(100);
    if (!waUrl) fail(`${name}: no se abrió WhatsApp al enviar el pedido`);
    const text = decodeURIComponent(new URL(waUrl).searchParams.get("text") || "");
    const number = new URL(waUrl).pathname.replace(/\D/g, "");
    if (!/^549\d{8,}$/.test(number)) fail(`${name}: el número de WhatsApp no es válido (${number})`);
    if (!text.includes(productName.slice(0, 20))) fail(`${name}: el mensaje no menciona el producto "${productName}"`);
    if (!/\$\s?[\d.]+/.test(text)) fail(`${name}: el mensaje no tiene el total`);
    console.log(`✓ ${name}: ${cards} productos visibles, "${productName.slice(0, 40)}" al carrito y pedido por WhatsApp correcto`);
    await ctx.close();
  }
  if (errors.length) fail("errores de JavaScript en la página:\n  " + errors.join("\n  "));
  console.log("✓ Flujo de compra OK");
} finally { await browser.close(); srv.close(); }
