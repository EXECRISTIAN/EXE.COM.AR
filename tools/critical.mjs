// CSS crítico de la tienda (site/index.html). Lo corre el deploy (pages.yml) antes de publicar.
//
// Qué hace: abre la tienda en Chromium en varios tamaños de pantalla (celular, tablet, compu) y en los dos temas,
// junta las reglas de styles.css que usan los elementos de la primera parte de la página (dos pantallas de alto,
// más todo lo fijo/flotante y lo que está oculto ahí) y las pone dentro del HTML en un <style>. La hoja completa se
// carga después sin frenar el primer dibujo. Como las reglas son las mismas (mismo orden, mismos valores), cuando
// llega la hoja completa no cambia nada de lo que ya se ve.
//
// Si algo falla, deja index.html como estaba (hoja normal) y el deploy sigue: nunca rompe la publicación.
//
// Uso: node tools/critical.mjs            (necesita playwright: npm i --no-save playwright && npx playwright install chromium)
//      node tools/critical.mjs --check    (además compara capturas con y sin la hoja completa; falla si difieren)
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const PAGE = join(SITE, "index.html");
const CSS_HREF = "assets/css/styles.css";
const LINK = `<link rel="stylesheet" href="${CSS_HREF}">`;
const VIEWPORTS = process.env.CRIT_VP ? JSON.parse(process.env.CRIT_VP) : [[360, 640], [390, 844], [412, 915], [768, 1024], [1024, 768], [1280, 720], [1366, 768], [1536, 864], [1920, 1080], [2560, 1440]];
const THEMES = ["light", "dark"];
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" };

const serve = (html) => new Promise((ok) => {
  const srv = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    try {
      const body = path === "/" || path === "/index.html" ? html : await readFile(normalize(join(SITE, path)));
      res.writeHead(200, { "Content-Type": TYPES[extname(path)] || (path === "/" ? "text/html" : "application/octet-stream") }); res.end(body);
    } catch (e) { res.writeHead(404); res.end(); }
  }).listen(0, "127.0.0.1", () => ok(srv));
});

// Corre dentro de la página: índices de las reglas (en orden) que tocan la zona visible o lo fijo/oculto
function collect(depth) {
  const sheet = [...document.styleSheets].find((s) => (s.href || "").includes("styles.css"));
  const H = innerHeight * depth;
  const inZone = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.position === "fixed" || cs.position === "sticky") return true;   // flotantes, encabezado, carrito
      const r = e.getBoundingClientRect();
      if (r.width || r.height) return r.top < H + scrollY;   // el primero con tamaño decide (los ocultos heredan de su contenedor)
    }
    return true;
  };
  const els = [...document.querySelectorAll("*")].filter(inZone);
  els.push(document.documentElement, document.body);
  const strip = (sel) => sel.replace(/::?(before|after|placeholder|selection|marker|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(\([^)]*\))?/g, "")
    .replace(/:(hover|focus|focus-visible|focus-within|active|visited|target|checked|disabled|enabled|invalid|valid|placeholder-shown|autofill|-webkit-autofill)(?![\w-])/g, "");
  const hit = new Set();
  const walk = (rules, path) => [...rules].forEach((r, i) => {
    const id = path.concat(i).join(".");
    if (r.cssRules && !(r instanceof CSSStyleRule)) return walk(r.cssRules, path.concat(i));
    if (!(r instanceof CSSStyleRule)) { hit.add(id); return; }   // @font-face, @keyframes, etc.: siempre
    for (const part of r.selectorText.split(",")) {
      const s = strip(part).trim() || "*";
      try { if (els.some((e) => e.matches(s))) { hit.add(id); return; } } catch (e) { hit.add(id); return; }   // selector raro: mejor incluirlo
    }
  });
  walk(sheet.cssRules, []);
  return [...hit];
}

// Arma el CSS con las reglas elegidas, respetando @media y el orden original
function build(ids) {
  const sheet = [...document.styleSheets].find((s) => (s.href || "").includes("styles.css"));
  const want = new Set(ids);
  const out = (rules, path) => [...rules].map((r, i) => {
    const id = path.concat(i).join(".");
    if (r.cssRules && !(r instanceof CSSStyleRule) && !(r instanceof CSSKeyframesRule)) {
      const inner = out(r.cssRules, path.concat(i)); if (!inner) return "";
      const head = r instanceof CSSMediaRule ? `@media ${r.conditionText}` : r instanceof CSSSupportsRule ? `@supports ${r.conditionText}` : null;
      return head ? `${head}{${inner}}` : inner;
    }
    return want.has(id) ? r.cssText : "";
  }).join("");
  return out(sheet.cssRules, []);
}

// Porcentaje de píxeles que cambian de verdad entre dos capturas (diferencia de color > 40 en algún canal)
async function pixelDiff(browser, a, b) {
  const p = await browser.newPage();
  const r = await p.evaluate(async ([x, y]) => {
    const load = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + b64; });
    const [i1, i2] = [await load(x), await load(y)];
    const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const [d1, d2] = [px(i1), px(i2)]; let n = 0;
    for (let k = 0; k < d1.length; k += 4) if (Math.abs(d1[k] - d2[k]) > 40 || Math.abs(d1[k + 1] - d2[k + 1]) > 40 || Math.abs(d1[k + 2] - d2[k + 2]) > 40) n++;
    return n / (d1.length / 4);
  }, [a.toString("base64"), b.toString("base64")]);
  await p.close(); return r;
}

async function main() {
  const check = process.argv.includes("--check");
  const original = await readFile(PAGE, "utf8");
  if (!original.includes(LINK)) throw new Error("no encuentro la hoja de estilos en index.html");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const srv = await serve(original);
  const url = `http://127.0.0.1:${srv.address().port}/index.html`;
  const ids = new Set();
  let css = "";
  try {
    for (const [w, h] of VIEWPORTS) for (const theme of THEMES) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
      await page.addInitScript((t) => { try { localStorage.setItem("exe-theme", t); } catch (e) {} }, theme);
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1200);   // carrusel, productos y bloques editables ya dibujados
      (await page.evaluate(collect, 2)).forEach((x) => ids.add(x));
      await page.close();
    }
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load" });
    css = (await page.evaluate(build, [...ids])).replace(/\s*\n\s*/g, " ").replace(/<\/style/gi, "<\\/style");
    await page.close();
  } catch (e) { srv.close(); throw e; }

  // CSS crítico dentro de la página + hoja completa sin bloquear (y con <noscript> por si no hay JavaScript)
  const loader = `<style id="css-critico">${css}</style>
  <link rel="preload" as="style" href="${CSS_HREF}" id="cssFull">
  <noscript>${LINK}</noscript>
  <script>(function(){var p=document.getElementById("cssFull"),l=document.createElement("link");l.rel="stylesheet";l.href=p.href;document.head.appendChild(l)})()</script>`;
  const html = original.replace(LINK, loader);

  if (check) {
    // Lo que se ve en la primera pantalla tiene que ser idéntico con solo el CSS crítico que con la hoja completa
    const srv2 = await serve(html);
    const url2 = `http://127.0.0.1:${srv2.address().port}/index.html`;
    let bad = 0;
    for (const [w, h] of VIEWPORTS) for (const theme of THEMES) {
      const shot = async (u, blockFull) => {
        const p = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
        await p.addInitScript((t) => { try { localStorage.setItem("exe-theme", t); Math.random = () => 0.5; } catch (e) {} }, theme);
        await p.route("**/*", (r) => (blockFull && r.request().url().includes("styles.css") ? r.abort() : /supabase|googleapis|gstatic/.test(r.request().url()) ? r.abort() : r.continue()));
        await p.goto(u, { waitUntil: "load" }); await p.waitForTimeout(800);
        await p.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} .hero-track{transform:none!important}" });
        await p.waitForTimeout(300);
        const b = await p.screenshot(); await p.close(); return b;
      };
      const [a, b] = [await shot(url, false), await shot(url2, true)];
      if (process.env.CRIT_DEBUG) { const { writeFileSync } = await import("node:fs"); writeFileSync(`${process.env.CRIT_DEBUG}/${w}-${theme}-full.png`, a); writeFileSync(`${process.env.CRIT_DEBUG}/${w}-${theme}-crit.png`, b); }
      // Se toleran diferencias de suavizado (la misma página cargada dos veces también varía unos pocos píxeles)
      const diff = a.equals(b) ? 0 : await pixelDiff(browser, a, b);
      if (diff > 0.0005) { bad++; console.log(`✗ ${w}×${h} ${theme}: la primera pantalla cambia sin la hoja completa (${(diff * 100).toFixed(2)}% de los píxeles)`); }
    }
    srv2.close();
    if (bad) { srv.close(); await browser.close(); throw new Error(`${bad} vistas distintas`); }
    console.log("✓ primera pantalla idéntica en todos los tamaños y temas");
  }
  srv.close();
  await browser.close();
  await writeFile(PAGE, html);
  console.log(`CSS crítico: ${(css.length / 1024).toFixed(1)} KB (de ${((await readFile(join(SITE, CSS_HREF))).length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error("CSS crítico no aplicado (queda la hoja normal):", e.message); process.exit(process.argv.includes("--check") ? 1 : 0); });
