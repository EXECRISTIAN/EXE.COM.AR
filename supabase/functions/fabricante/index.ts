// Importar fotos y especificaciones desde la página OFICIAL del fabricante (panel → producto).
// Sin inteligencia artificial: reglas fijas. Solo lee sitios de la lista certificada de fabricantes (MAKERS);
// nunca tiendas. Las imágenes se aceptan solo si vienen del dominio del fabricante (o su CDN declarado).
//
// Acciones (POST JSON, requiere sesión con products.write — que ya exige verificación en dos pasos):
//   lookup { brand, name, url? } → { page, maker, title, match:{ok, found, missing}, images:[url], specs:[{title, rows}] }
//   image  { url }               → bytes de la imagen (para convertirla a WebP en el navegador y subirla)
//   makers {}                    → lista de fabricantes certificados (para mostrar en el panel)
// Deploy: supabase functions deploy fabricante
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// ---------- Fabricantes certificados: marca(s) → dominios oficiales (y CDNs propios) ----------
type Maker = { name: string; keys: string[]; domains: string[] };
const M = (name: string, keys: string[], domains: string[]): Maker => ({ name, keys: keys.map((k) => k.toLowerCase()), domains });
const MAKERS: Maker[] = [
  M("Intel", ["intel"], ["intel.com"]),
  M("AMD", ["amd", "ryzen", "radeon"], ["amd.com"]),
  M("NVIDIA", ["nvidia", "geforce"], ["nvidia.com"]),
  M("ASUS", ["asus", "rog", "tuf"], ["asus.com"]),
  M("GIGABYTE", ["gigabyte", "aorus"], ["gigabyte.com", "aorus.com"]),
  M("MSI", ["msi"], ["msi.com"]),
  M("ASRock", ["asrock"], ["asrock.com"]),
  M("Biostar", ["biostar"], ["biostar.com.tw"]),
  M("EVGA", ["evga"], ["evga.com"]),
  M("ZOTAC", ["zotac"], ["zotac.com"]),
  M("PNY", ["pny"], ["pny.com"]),
  M("Sapphire", ["sapphire"], ["sapphiretech.com"]),
  M("PowerColor", ["powercolor"], ["powercolor.com"]),
  M("XFX", ["xfx"], ["xfxforce.com"]),
  M("Palit", ["palit"], ["palit.com"]),
  M("Gainward", ["gainward"], ["gainward.com"]),
  M("Inno3D", ["inno3d"], ["inno3d.com"]),
  M("Corsair", ["corsair"], ["corsair.com"]),
  M("Kingston", ["kingston", "fury"], ["kingston.com"]),
  M("Crucial", ["crucial"], ["crucial.com"]),
  M("G.Skill", ["g.skill", "gskill"], ["gskill.com"]),
  M("TeamGroup", ["teamgroup", "t-force", "team"], ["teamgroupinc.com"]),
  M("ADATA / XPG", ["adata", "xpg"], ["adata.com", "xpg.com"]),
  M("Seagate", ["seagate"], ["seagate.com"]),
  M("Western Digital", ["western digital", "wd"], ["westerndigital.com"]),
  M("Samsung", ["samsung"], ["samsung.com"]),
  M("Patriot", ["patriot"], ["patriotmemory.com"]),
  M("Sabrent", ["sabrent"], ["sabrent.com"]),
  M("NZXT", ["nzxt"], ["nzxt.com"]),
  M("Cooler Master", ["cooler master", "coolermaster"], ["coolermaster.com"]),
  M("Thermaltake", ["thermaltake"], ["thermaltake.com"]),
  M("Seasonic", ["seasonic"], ["seasonic.com"]),
  M("be quiet!", ["be quiet", "bequiet"], ["bequiet.com"]),
  M("Noctua", ["noctua"], ["noctua.at"]),
  M("DeepCool", ["deepcool"], ["deepcool.com"]),
  M("Lian Li", ["lian li", "lian-li"], ["lian-li.com"]),
  M("SilverStone", ["silverstone"], ["silverstonetek.com"]),
  M("Phanteks", ["phanteks"], ["phanteks.com"]),
  M("Fractal Design", ["fractal"], ["fractal-design.com"]),
  M("Arctic", ["arctic"], ["arctic.de"]),
  M("Antec", ["antec"], ["antec.com"]),
  M("Aerocool", ["aerocool"], ["aerocool.io"]),
  M("Logitech", ["logitech"], ["logitech.com", "logitechg.com"]),
  M("Razer", ["razer"], ["razer.com", "razerzone.com"]),
  M("SteelSeries", ["steelseries"], ["steelseries.com"]),
  M("HyperX", ["hyperx"], ["hyperx.com"]),
  M("ROCCAT", ["roccat"], ["roccat.com"]),
  M("Glorious", ["glorious"], ["gloriousgaming.com"]),
  M("Redragon", ["redragon"], ["redragon.es", "redragonzone.com"]),
  M("BenQ", ["benq", "zowie"], ["benq.com"]),
  M("ViewSonic", ["viewsonic"], ["viewsonic.com"]),
  M("Ducky", ["ducky"], ["duckychannel.com.tw"]),
  M("Keychron", ["keychron"], ["keychron.com"]),
  M("BitFenix", ["bitfenix"], ["bitfenix.com"]),
  M("ID-COOLING", ["id-cooling", "idcooling"], ["idcooling.com"]),
  M("Scythe", ["scythe"], ["scythe-eu.com"]),
  M("Thermalright", ["thermalright"], ["thermalright.com"]),
  M("Colorful", ["colorful"], ["colorful.cn"]),
  M("Yeston", ["yeston"], ["yeston.net"]),
  M("Montech", ["montech"], ["montechpc.com"]),
  M("Zalman", ["zalman"], ["zalman.com"]),
  M("V-Color", ["v-color", "vcolor"], ["vcolor.com.tw"]),
  M("Silicon Power", ["silicon power"], ["silicon-power.com"]),
  M("Lexar", ["lexar"], ["lexar.com"]),
  M("Netac", ["netac"], ["netac.com"]),
  M("Sentey", ["sentey"], ["sentey.com"]),
  M("Overtech", ["overtech"], ["overtech.com.ar"]),
  M("Noga", ["noga"], ["noga.com.ar"]),
  M("Kolink", ["kolink"], ["kolink.eu"]),
  M("GameMax", ["gamemax"], ["gamemaxpc.com"]),
  M("Mars Gaming", ["mars gaming"], ["marsgaming.eu"]),
  M("1STPLAYER", ["1stplayer"], ["1stplayer.com"]),
  M("Marvo", ["marvo"], ["marvo-tech.com"]),
  M("Huananzhi", ["huananzhi"], ["huananzhi.com"]),
  M("Valve", ["valve", "steam deck"], ["steamdeck.com", "steampowered.com", "steamstatic.com"]),
];
const findMaker = (brand: string, name: string) => {
  const b = ` ${String(brand || "").toLowerCase()} `, n = ` ${String(name || "").toLowerCase()} `;
  return MAKERS.find((m) => m.keys.some((k) => b.includes(` ${k} `) || b.trim() === k)) ||
    MAKERS.find((m) => m.keys.some((k) => n.includes(` ${k} `)));
};
const hostOf = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" ? x.hostname.toLowerCase() : ""; } catch { return ""; } };
const onDomain = (host: string, domains: string[]) => !!host && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && domains.some((d) => host === d || host.endsWith("." + d));

// ---------- Descargas seguras: solo https, solo dominios permitidos (también en cada redirección), con límite ----------
async function safeFetch(url: string, allowed: string[], maxBytes: number, accept = "text/html,*/*") {
  let u = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!onDomain(hostOf(u), allowed)) throw new Error("Dominio no permitido: " + (hostOf(u) || u));
    const r = await fetch(u, { redirect: "manual", headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "es-AR,es;q=0.9,en;q=0.8" }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location")!, u).href; continue; }
    if (!r.ok) throw new Error(`El sitio respondió ${r.status}`);
    const len = +(r.headers.get("content-length") || 0);
    if (len > maxBytes) throw new Error("Archivo demasiado grande");
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("Archivo demasiado grande");
    return { buf, type: r.headers.get("content-type") || "", url: u };
  }
  throw new Error("Demasiadas redirecciones");
}
const SEARCH = ["html.duckduckgo.com", "duckduckgo.com", "www.bing.com", "bing.com"];

// Busca la página del modelo dentro del sitio del fabricante (buscador web común, sin IA)
async function searchPage(maker: Maker, q: string): Promise<string[]> {
  const out: string[] = [];
  const add = (u: string) => { if (onDomain(hostOf(u), maker.domains) && !out.includes(u) && !/\/(search|support\/download|forum|news|blog|press)/i.test(u)) out.push(u); };
  for (const d of maker.domains.slice(0, 2)) {
    const query = `site:${d} ${q}`;
    try {
      const { buf } = await safeFetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), SEARCH, 2_000_000);
      const html = new TextDecoder().decode(buf);
      for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)) {
        const h = m[1].replace(/&amp;/g, "&");
        const real = h.includes("uddg=") ? decodeURIComponent(h.split("uddg=")[1].split("&")[0]) : h;
        add(real.startsWith("//") ? "https:" + real : real);
      }
    } catch { /* probamos con el otro buscador */ }
    if (out.length) break;
    try {
      const { buf } = await safeFetch("https://www.bing.com/search?q=" + encodeURIComponent(query), SEARCH, 2_000_000);
      const html = new TextDecoder().decode(buf);
      for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<a[^>]+href="(https:[^"]+)"/g)) add(m[1].replace(/&amp;/g, "&"));
    } catch { /* sin resultados */ }
    if (out.length) break;
  }
  return out.slice(0, 5);
}

// ---------- Coincidencia: las palabras del modelo (las que tienen números) tienen que estar en la página ----------
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
function modelTokens(name: string, brand: string) {
  const skip = new Set(["gb", "tb", "mb", "ghz", "mhz", "w", "ddr4", "ddr5", "lga1200", "lga1700", "lga1151", "am4", "am5", "1200", "1700", "1151"]);
  return [...new Set(String(name).split(/[\s/(),]+/).map((t) => t.trim()).filter((t) => /\d/.test(t) && (/[a-z]/i.test(t) || /^\d{3,}$/.test(t))))]
    .map(norm).filter((t) => t.length >= 2 && !skip.has(t) && !/^\d+(gb|tb|w|ghz|mhz|mm|hz|a|o|gen|th|nd|rd|st)$/.test(t) && t !== norm(brand)).slice(0, 6);
}
function matchScore(tokens: string[], text: string) {
  const hay = norm(text);
  const found = tokens.filter((t) => hay.includes(t)), missing = tokens.filter((t) => !hay.includes(t));
  return { ok: tokens.length > 0 && missing.length === 0, found, missing };
}

// ---------- Extracción (reglas fijas) ----------
const clean = (s: string | null | undefined, max = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
function jsonLd(doc: any): any[] {
  const out: any[] = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.textContent || ""); (Array.isArray(j) ? j : j["@graph"] || [j]).forEach((x: any) => out.push(x)); } catch { /* JSON inválido */ }
  }
  return out.filter((x) => /product/i.test(String(x && x["@type"])));
}
function images(doc: any, base: string, maker: Maker, tokens: string[]): string[] {
  const cand: { u: string; w: number }[] = [];
  const push = (raw: string | null | undefined, w: number) => {
    if (!raw) return;
    let u: string; try { u = new URL(raw.trim().split(" ")[0], base).href; } catch { return; }
    if (!onDomain(hostOf(u), maker.domains)) return;   // solo del fabricante: nunca de tiendas
    if (/\.svg(\?|$)|logo|icon|sprite|banner|badge|flag|avatar|placeholder|loading|blank|thumb[_-]?nail|1x1|pixel/i.test(u)) return;
    const c = cand.find((x) => x.u === u); if (c) c.w += w; else cand.push({ u, w });
  };
  jsonLd(doc).forEach((p) => ([] as any[]).concat(p.image || []).forEach((im: any) => push(typeof im === "string" ? im : im && (im.url || im.contentUrl), 6)));
  push(doc.querySelector('meta[property="og:image"]')?.getAttribute("content"), 5);
  push(doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content"), 3);
  for (const im of doc.querySelectorAll("img")) {
    const e = im as Element;
    const src = e.getAttribute("data-zoom-image") || e.getAttribute("data-large") || e.getAttribute("data-src") || e.getAttribute("src") || (e.getAttribute("srcset") || "").split(",").pop();
    const hint = norm((e.getAttribute("alt") || "") + " " + (e.getAttribute("class") || "") + " " + (src || ""));
    let w = 0;
    if (/gallery|product|zoom|slide|carousel|hero|main/.test(hint)) w += 2;
    if (tokens.some((t) => hint.includes(t))) w += 2;
    if (w) push(src, w);
  }
  return cand.sort((a, b) => b.w - a.w).map((x) => x.u).slice(0, 8);
}
function specs(doc: any): { title: string; rows: [string, string][] }[] {
  const secs: { title: string; rows: [string, string][] }[] = [];
  const add = (title: string, k: string, v: string) => {
    k = clean(k, 80); v = clean(v, 300);
    if (!k || !v || k === v || k.length > 80 || /^(comprar|buy|precio|price|share|compartir)$/i.test(k)) return;
    let s = secs.find((x) => x.title === title); if (!s) { if (secs.length >= 12) return; s = { title, rows: [] }; secs.push(s); }
    if (s.rows.length < 50 && !s.rows.some((r) => r[0] === k)) s.rows.push([k, v]);
  };
  const headingFor = (el: any) => {
    let n = el;
    for (let i = 0; n && i < 40; i++) {
      let p = n.previousElementSibling;
      while (p) { if (/^H[2-5]$/.test(p.tagName)) return clean(p.textContent, 60); const h = p.querySelector && p.querySelector("h2,h3,h4"); if (h) return clean(h.textContent, 60); p = p.previousElementSibling; }
      n = n.parentElement;
    }
    return "Especificaciones";
  };
  jsonLd(doc).forEach((p) => ([] as any[]).concat(p.additionalProperty || []).forEach((x: any) => add("Especificaciones", x && x.name, x && x.value)));
  for (const t of doc.querySelectorAll("table")) {
    const title = clean(t.querySelector("caption")?.textContent, 60) || headingFor(t);
    let cur = title;
    for (const tr of t.querySelectorAll("tr")) {
      const cells = [...tr.querySelectorAll("th,td")] as Element[];
      if (cells.length === 1 && cells[0].getAttribute("colspan")) { cur = clean(cells[0].textContent, 60) || title; continue; }
      if (cells.length === 2) add(cur, cells[0].textContent || "", cells[1].textContent || "");
    }
  }
  for (const dl of doc.querySelectorAll("dl")) {
    const title = headingFor(dl), dts = [...dl.querySelectorAll("dt")] as Element[];
    dts.forEach((dt) => { const dd = dt.nextElementSibling; if (dd && dd.tagName === "DD") add(title, dt.textContent || "", dd.textContent || ""); });
  }
  // Pares "etiqueta / valor" en <div>/<li>/<span> (ej. Intel ARK, muchas fichas de fabricantes)
  for (const k of doc.querySelectorAll('[class*="label"],[class*="spec-name"],[class*="specName"],[class*="key"],[class*="title"]')) {
    const v = (k as Element).nextElementSibling;
    if (!v || !/value|desc|data|spec-value|specValue|content/i.test(v.getAttribute("class") || "")) continue;
    if ((k.textContent || "").length > 80 || (v.textContent || "").length > 300) continue;
    add(headingFor(k), k.textContent || "", v.textContent || "");
  }
  return secs.filter((s) => s.rows.length >= 2);
}

async function lookup(body: any) {
  const brand = clean(body.brand, 60), name = clean(body.name, 200);
  const maker = findMaker(brand, name);
  if (!maker) return { error: `No hay fabricante certificado para la marca "${brand || "?"}".`, makers: MAKERS.map((m) => m.name) };
  const tokens = modelTokens(name, brand);
  if (!tokens.length) return { error: "El nombre no tiene el modelo (ej: B460M DS3H V2, i3-10100, RTX 3060).", maker: maker.name };
  let pages: string[] = [];
  if (body.url) {
    if (!onDomain(hostOf(body.url), maker.domains)) return { error: `Ese link no es de ${maker.name} (${maker.domains.join(", ")}). Solo se aceptan páginas del fabricante.`, maker: maker.name };
    pages = [body.url];
  } else pages = await searchPage(maker, tokens.join(" "));
  if (!pages.length) return { error: `No se encontró la página del modelo en ${maker.domains[0]}. Pegá el link de la página oficial.`, maker: maker.name, tokens };
  let best: any = null;
  for (const page of pages.slice(0, 3)) {
    try {
      const { buf, url } = await safeFetch(page, maker.domains, 6_000_000);
      const html = new TextDecoder().decode(buf);
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc) continue;
      const ld = jsonLd(doc);
      const title = clean(doc.querySelector("title")?.textContent, 200);
      const text = [title, doc.querySelector("h1")?.textContent, ld.map((p) => p.name + " " + (p.model || "") + " " + (p.mpn || "")).join(" "), doc.querySelector('meta[property="og:title"]')?.getAttribute("content"), (doc.body?.textContent || "").slice(0, 60000)].join(" ");
      const match = matchScore(tokens, text);
      const res = { page: url, maker: maker.name, title, tokens, match, images: images(doc, url, maker, tokens), specs: specs(doc) };
      if (!best || (match.found.length > best.match.found.length) || (match.found.length === best.match.found.length && res.images.length > best.images.length)) best = res;
      if (match.ok && res.images.length) break;
    } catch (e) { best = best || { page, maker: maker.name, tokens, match: { ok: false, found: [], missing: tokens }, images: [], specs: [], error: String((e as Error).message) }; }
  }
  return best;
}

async function requirePerm(req: Request, perm: string) {
  const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data } = await user.rpc("has_perm", { p: perm });
  if (data !== true) throw Object.assign(new Error("Sin permiso"), { status: 403 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    await requirePerm(req, "products.write");
    const body = await req.json();
    if (body.action === "makers") return json({ makers: MAKERS.map((m) => ({ name: m.name, domains: m.domains })) });
    if (body.action === "lookup") return json(await lookup(body));
    if (body.action === "image") {
      const host = hostOf(body.url);
      const maker = MAKERS.find((m) => onDomain(host, m.domains));
      if (!maker) return json({ error: "Solo imágenes de fabricantes certificados" }, 400);
      const { buf, type } = await safeFetch(body.url, maker.domains, 12_000_000, "image/*");
      if (!/^image\/(jpeg|png|webp|gif|avif)/.test(type)) return json({ error: "No es una imagen" }, 400);
      return new Response(buf, { headers: { ...cors, "Content-Type": type, "Cache-Control": "no-store" } });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, (e as any).status || 500);
  }
});
