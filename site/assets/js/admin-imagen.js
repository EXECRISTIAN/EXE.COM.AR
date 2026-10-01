// Editor de imágenes y vectores por capas (panel → Imágenes).
// Todo se dibuja en un <canvas>: fondo + capas (texto, rectángulo, elipse, trazo, curva, imagen) + zonas tocables.
// Cada capa puede llevar un enlace (producto, varios productos, categoría, marca, sección, link o WhatsApp):
// al guardar se publica un WebP y la lista de zonas con enlace (tabla designs; RLS exige site.edit),
// y la tienda dibuja esas zonas encima de la imagen.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const be = window.EXE_BACKEND;
  const qs = new URLSearchParams(location.search);
  const demo = qs.get("demo") === "1";
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + Math.random().toString(36).slice(2));
  const BUCKET = "sitio";
  const FONTS = ["Lato", "Oswald", "Bebas Neue", "Arial", "Georgia", "Impact", "Courier New"];
  const BLENDS = { normal: ["source-over", "Normal"], multiply: ["multiply", "Multiplicar"], screen: ["screen", "Pantalla"], overlay: ["overlay", "Superponer"], lighten: ["lighten", "Aclarar"], darken: ["darken", "Oscurecer"] };
  const TYPE_NAME = { text: "texto", rect: "rectángulo", ellipse: "elipse", path: "vector", image: "imagen", zone: "zona" };
  const TYPE_ICON = { text: "T", rect: "▭", ellipse: "◯", path: "⬠", image: "🖼", zone: "🔗" };
  const LINKS = [["", "Nada"], ["product", "Producto"], ["products", "Varios productos"], ["category", "Categoría"], ["brand", "Marca"], ["section", "Sección de la web"], ["url", "Link externo"], ["whatsapp", "WhatsApp"]];
  const SECTIONS = [["inicio", "Inicio (arriba de todo)"], ["productos", "Productos"], ["marcas", "Marcas"], ["contacto", "Contacto"], ["carrito", "Abrir el carrito"]];
  const PRESETS = [["Carrusel principal", 1904, 650], ["Tarjeta vertical", 352, 480], ["Banner ancho", 1400, 400], ["Banner de marca", 1200, 750], ["Foto de producto", 1200, 1200], ["Historia / celular", 1080, 1920]];

  let D = null;              // documento: { w, h, bg, layers: [] }
  let design = { id: null, name: "Diseño nuevo", kind: "banner" };
  let target = qs.get("target") || "";   // dónde se usa al guardar: block:<id>:<ruta> | product:<id>:<n>
  let sel = null, tool = "select", zoom = 1, showZones = true, dirty = false, hovId = null;
  let catalog = null;        // productos para los enlaces (id, name, brand, category, stock)
  const undo = [], redo = [];
  const imgCache = new Map(); // src → HTMLImageElement
  const cutCache = new Map(); // src|tol → canvas con el blanco quitado

  /* ---------- Acceso ---------- */
  // Si algo no responde, no queda trabado en "Verificando permisos…": avisa qué pasó
  const timeout = (p, ms, what) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error(what + " no respondió (recargá la página)")), ms))]);
  async function boot() {
    try { await bootInner(); }
    catch (e) { gate("No se pudo abrir el editor: " + esc(e.message) + ' — <a href="">Recargar</a>', true); console.error(e); }
  }
  async function bootInner() {
    if (!demo) {
      if (!be) return gate("El backend no está configurado.");
      const user = await timeout(be.user(), 15000, "El inicio de sesión");
      if (!user) return gate('Tenés que <a href="../cuenta.html">iniciar sesión</a>.', true);
      const perms = await timeout(be.permissions(), 15000, "La verificación de permisos").catch(() => new Set());
      if (!perms.has("site.edit")) return gate("Tu usuario no tiene permiso para editar imágenes.");
      if (window.EXE_MFA && !(await window.EXE_MFA.gate($("ieGateMsg"), { required: true }))) return gate("Para editar hace falta la verificación en dos pasos. <a href=\"\">Reintentar</a>", true);
    }
    gate("Abriendo la imagen…");
    try { await timeout(loadDoc(), 25000, "La imagen"); } catch (e) { return gate("No se pudo abrir el diseño: " + esc(e.message), true); }
    if (demo) $("ieBack").href = "index.html?demo=1#imagenes";
    $("ieGate").hidden = true; $("ie").hidden = false;
    bindUi(); fit(); render(); renderSide(); setState(demo ? "Modo demo: no se guarda en la base" : "");
  }
  const gate = (m, html) => { const g = $("ieGateMsg"); if (html) g.innerHTML = m; else g.textContent = m; };

  const newDoc = (w, h) => ({ w, h, bg: { type: "color", c1: "#ffffff", c2: "#0084d6", angle: 135 }, layers: [] });
  async function loadDoc() {
    const id = qs.get("id");
    if (id && !demo) {
      const r = await be.sb.from("designs").select("id,name,kind,width,height,doc,image_url").eq("id", id).single();
      if (r.error) throw r.error;
      design = { id: r.data.id, name: r.data.name, kind: r.data.kind, imageUrl: r.data.image_url };
      D = { ...newDoc(r.data.width, r.data.height), ...r.data.doc, w: r.data.width, h: r.data.height };
      if (!target && r.data.doc && r.data.doc.target) target = r.data.doc.target;
    } else if (qs.get("src")) {
      // Editar una imagen que ya está en la web: queda como capa de fondo (bloqueada) con su tamaño real
      const src = qs.get("src");
      const im = await loadImg(src);
      const k = Math.min(1, 4000 / Math.max(im.naturalWidth, im.naturalHeight));
      D = newDoc(Math.round(im.naturalWidth * k) || 1200, Math.round(im.naturalHeight * k) || 750);
      D.bg.type = "none";
      D.layers.push(layer("image", { name: "Imagen original", x: 0, y: 0, w: D.w, h: D.h, src, locked: true }));
      design.name = qs.get("name") || "Imagen editada";
      design.kind = target.startsWith("product:") ? "producto" : "banner";
    } else {
      const w = clamp(+qs.get("w") || 1200, 50, 4000), h = clamp(+qs.get("h") || 750, 50, 4000);
      D = newDoc(w, h);
      design.name = qs.get("name") || "Diseño nuevo";
      if (demo && !qs.get("w")) demoDoc();
    }
    D.target = target;
    $("ieName").value = design.name;
    await Promise.all(D.layers.filter((l) => l.type === "image" && l.src).map((l) => loadImg(l.src).catch(() => null)));
    snapshot(true);
  }
  function demoDoc() {
    D.bg = { type: "grad", c1: "#1e1b4b", c2: "#0ea5e9", angle: 135 };
    D.layers.push(layer("text", { name: "Título", x: 60, y: 70, w: 720, text: "Ryzen 8000 ya en stock", size: 64, weight: 900, color: "#ffffff", fx: { shadow: { on: true, x: 0, y: 6, blur: 24, color: "#000000", a: 50 } } }));
    D.layers.push(layer("path", { name: "Curva dorada", x: 470, y: 250, w: 200, h: 180, points: [[0, 1], [.5, 0], [1, 1]], smooth: true, closed: false, stroke: "#fbbf24", strokeW: 6, fill: "" }));
    D.layers.push(layer("rect", { name: "Botón", x: 60, y: 560, w: 300, h: 76, radius: 14, fill: "", stroke: "#ffffff", strokeW: 3, link: { t: "category", v: "Procesadores" } }));
    D.layers.push(layer("text", { name: "Texto del botón", x: 60, y: 580, w: 300, text: "Ver procesadores", size: 30, weight: 700, color: "#ffffff", align: "center" }));
    D.layers.push(layer("zone", { name: "Zona Ryzen 5", x: 760, y: 220, w: 380, h: 440, link: { t: "product", v: "amd-ryzen-5-8500g", price: true, hide: true } }));
  }

  /* ---------- Capas ---------- */
  function layer(type, o = {}) {
    const base = { id: uid(), type, name: TYPE_NAME[type][0].toUpperCase() + TYPE_NAME[type].slice(1), x: 40, y: 40, w: 300, h: 160, rot: 0, opacity: 100, blend: "normal", hidden: false, locked: false,
      fill: "#0084d6", stroke: "", strokeW: 0, radius: 0, fx: {}, link: null };
    if (type === "text") Object.assign(base, { text: "Texto", font: "Lato", size: 48, weight: 700, italic: false, color: "#111111", align: "left", lineH: 1.15, fill: "" });
    if (type === "image") Object.assign(base, { src: "", adj: { bri: 100, con: 100, sat: 100, blur: 0 }, crop: { l: 0, t: 0, r: 0, b: 0 }, cut: false, cutTol: 30, fill: "" });
    if (type === "path") Object.assign(base, { points: [], smooth: false, closed: false, fill: "", stroke: "#111111", strokeW: 4 });
    if (type === "zone") Object.assign(base, { fill: "" });
    return Object.assign(base, o);
  }
  const byId = (id) => D.layers.find((l) => l.id === id);
  const cur = () => (sel ? byId(sel) : null);

  /* ---------- Imágenes ---------- */
  const abs = (src) => (/^(https?:|blob:|data:)/.test(src) ? src : "../" + String(src).replace(/^\/+/, ""));
  function loadImg(src) {
    if (imgCache.has(src)) { const im = imgCache.get(src); return im.complete && im.naturalWidth ? Promise.resolve(im) : new Promise((ok, ko) => { im.addEventListener("load", () => ok(im)); im.addEventListener("error", ko); }); }
    const im = new Image(); im.crossOrigin = "anonymous"; im.decoding = "async";
    const p = new Promise((ok, ko) => { im.onload = () => { ok(im); render(); }; im.onerror = () => ko(new Error("No se pudo cargar la imagen")); });
    const u = abs(src);
    im.src = /^(blob:|data:)/.test(u) ? u : u + (u.includes("?") ? "&" : "?") + "cors=1"; imgCache.set(src, im);
    return p;
  }
  // "Varita": vuelve transparente el blanco (y casi blanco) de la imagen
  function cutWhite(im, src, tol) {
    const key = src + "|" + tol;
    if (cutCache.has(key)) return cutCache.get(key);
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(im, 0, 0);
    try {
      const d = x.getImageData(0, 0, c.width, c.height), p = d.data, lim = 255 - tol * 2.55;
      for (let i = 0; i < p.length; i += 4) {
        const m = Math.min(p[i], p[i + 1], p[i + 2]);
        if (m >= lim) p[i + 3] = 0; else if (m >= lim - 25) p[i + 3] = Math.round(p[i + 3] * (lim - m) / 25);
      }
      x.putImageData(d, 0, 0);
    } catch (e) { setState("Esta imagen no permite quitar el fondo (origen externo).", "err"); }
    cutCache.set(key, c); return c;
  }
  // Foto subida → WebP (máx. 2400 px) en el bucket "sitio" (en demo queda solo en el navegador)
  async function uploadImage(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/webp", 0.9));
    if (demo) return { src: URL.createObjectURL(blob), w: cv.width, h: cv.height };
    const path = `disenos/src/${uid()}.webp`;
    const up = await be.sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
    if (up.error) throw up.error;
    return { src: be.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, w: cv.width, h: cv.height };
  }

  /* ---------- Dibujo ---------- */
  const rgba = (hex, a) => { const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000"; return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${(a ?? 100) / 100})`; };
  function paintBg(ctx, w, h) {
    const b = D.bg || {};
    if (b.type === "none") return;
    if (b.type === "grad") {
      const a = ((b.angle || 0) - 90) * Math.PI / 180, r = Math.hypot(w, h) / 2, cx = w / 2, cy = h / 2;
      const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.addColorStop(0, b.c1 || "#000"); g.addColorStop(1, b.c2 || "#fff"); ctx.fillStyle = g;
    } else ctx.fillStyle = b.c1 || "#fff";
    ctx.fillRect(0, 0, w, h);
  }
  function textLines(ctx, L) {
    ctx.font = `${L.italic ? "italic " : ""}${L.weight} ${L.size}px "${L.font}", Lato, sans-serif`;
    const out = [];
    String(L.text || "").split("\n").forEach((para) => {
      let line = "";
      para.split(/(\s+)/).forEach((word) => {
        const t = line + word;
        if (line && ctx.measureText(t.trimEnd()).width > L.w) { out.push(line.trimEnd()); line = word.trimStart(); } else line = t;
      });
      out.push(line.trimEnd());
    });
    return out;
  }
  function shapePath(ctx, L) {
    const w = L.w, h = L.h;
    ctx.beginPath();
    if (L.type === "ellipse") ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    else if (L.type === "path") {
      const P = (L.points || []).map(([fx, fy]) => [(fx - 0.5) * w, (fy - 0.5) * h]);
      if (!P.length) return;
      ctx.moveTo(P[0][0], P[0][1]);
      if (L.smooth && P.length > 2) {
        for (let i = 1; i < P.length - 1; i++) { const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2; ctx.quadraticCurveTo(P[i][0], P[i][1], mx, my); }
        const l = P[P.length - 1]; ctx.lineTo(l[0], l[1]);
      } else P.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      if (L.closed) ctx.closePath();
    } else if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, clamp(L.radius || 0, 0, Math.min(w, h) / 2));
    else ctx.rect(-w / 2, -h / 2, w, h);
  }
  function drawBody(ctx, L) {
    if (L.type === "image") {
      const im = imgCache.get(L.src);
      if (!im || !im.naturalWidth) { ctx.fillStyle = "#8884"; ctx.fillRect(-L.w / 2, -L.h / 2, L.w, L.h); return; }
      const c = L.crop || {}, src = L.cut ? cutWhite(im, L.src, L.cutTol) : im;
      const iw = im.naturalWidth, ih = im.naturalHeight;
      const sx = iw * (c.l || 0) / 100, sy = ih * (c.t || 0) / 100, sw = Math.max(1, iw * (1 - ((c.l || 0) + (c.r || 0)) / 100)), sh = Math.max(1, ih * (1 - ((c.t || 0) + (c.b || 0)) / 100));
      if (L.radius) { ctx.save(); shapePath(ctx, { ...L, type: "rect" }); ctx.clip(); ctx.drawImage(src, sx, sy, sw, sh, -L.w / 2, -L.h / 2, L.w, L.h); ctx.restore(); }
      else ctx.drawImage(src, sx, sy, sw, sh, -L.w / 2, -L.h / 2, L.w, L.h);
      if (L.stroke && L.strokeW) { ctx.lineWidth = L.strokeW; ctx.strokeStyle = L.stroke; shapePath(ctx, { ...L, type: "rect" }); ctx.stroke(); }
      return;
    }
    if (L.type === "text") {
      const lines = textLines(ctx, L), lh = L.size * (L.lineH || 1.15);
      ctx.fillStyle = L.color; ctx.textBaseline = "top"; ctx.textAlign = L.align;
      const x = L.align === "center" ? 0 : L.align === "right" ? L.w / 2 : -L.w / 2;
      lines.forEach((t, i) => {
        if (L.stroke && L.strokeW) { ctx.lineWidth = L.strokeW; ctx.strokeStyle = L.stroke; ctx.lineJoin = "round"; ctx.strokeText(t, x, -L.h / 2 + i * lh); }
        ctx.fillText(t, x, -L.h / 2 + i * lh);
      });
      return;
    }
    shapePath(ctx, L);
    if (L.fill && (L.type !== "path" || L.closed)) { ctx.fillStyle = L.fill; ctx.fill(); }
    if (L.stroke && L.strokeW) { ctx.lineWidth = L.strokeW; ctx.strokeStyle = L.stroke; ctx.lineCap = ctx.lineJoin = "round"; ctx.stroke(); }
  }
  function drawLayer(ctx, L) {
    if (L.hidden || L.type === "zone") return;
    if (L.type === "text") { const n = textLines(ctx, L).length; L.h = Math.max(1, Math.round(n * L.size * (L.lineH || 1.15))); }
    const fx = L.fx || {};
    ctx.save();
    ctx.globalAlpha = clamp(L.opacity, 0, 100) / 100;
    ctx.globalCompositeOperation = (BLENDS[L.blend] || BLENDS.normal)[0];
    ctx.translate(L.x + L.w / 2, L.y + L.h / 2); ctx.rotate((L.rot || 0) * Math.PI / 180);
    const f = [];
    if (fx.blur && fx.blur.on) f.push(`blur(${clamp(+fx.blur.r || 0, 0, 60)}px)`);
    if (L.type === "image" && L.adj) f.push(`brightness(${L.adj.bri}%) contrast(${L.adj.con}%) saturate(${L.adj.sat}%)`);
    ctx.filter = f.join(" ") || "none";
    // Brillo (resplandor) y sombra: se dibuja la capa con una sombra de color; el cuerpo final va encima
    [["glow", (g) => [0, 0, g.blur, g.color, g.a ?? 90]], ["shadow", (s) => [s.x, s.y, s.blur, s.color, s.a]]].forEach(([k, get]) => {
      const e = fx[k]; if (!e || !e.on) return;
      const [x, y, b, c, a] = get(e);
      ctx.save(); ctx.shadowOffsetX = +x || 0; ctx.shadowOffsetY = +y || 0; ctx.shadowBlur = clamp(+b || 0, 0, 200); ctx.shadowColor = rgba(c, a);
      drawBody(ctx, L); ctx.restore();
    });
    drawBody(ctx, L);
    ctx.filter = "none";
    if (fx.border && fx.border.on && L.type !== "text") { ctx.lineWidth = clamp(+fx.border.w || 2, 1, 60); ctx.strokeStyle = fx.border.color || "#fff"; ctx.lineJoin = "round"; shapePath(ctx, L.type === "image" ? { ...L, type: "rect" } : L); ctx.stroke(); }
    ctx.restore();
  }
  function paint(ctx, w, h) { ctx.clearRect(0, 0, w, h); paintBg(ctx, w, h); D.layers.forEach((L) => drawLayer(ctx, L)); }
  let raf = 0;
  function render() {
    if (!D) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const c = $("ieCanvas");
      if (c.width !== D.w || c.height !== D.h) { c.width = D.w; c.height = D.h; }
      paint(c.getContext("2d"), D.w, D.h);
      overlay(); live(true);
    });
  }

  /* ---------- Vista en la web en vivo: la página real con esta imagen, que se actualiza mientras editás ---------- */
  let liveOn = false, liveW = 1280, liveTimer = 0, liveBlobUrl = "", liveReady = false;
  const baseName = (u) => String(u || "").split("?")[0].split("/").pop();
  function liveUrl() {
    const pid = target.startsWith("product:") ? target.split(":")[1] : "";
    return `../index.html?cms-edit=1${pid ? "#producto/" + encodeURIComponent(pid) : ""}`;
  }
  function toggleLive(on = !liveOn) {
    liveOn = on; $("ieLive").setAttribute("aria-pressed", on); $("ieLivePanel").hidden = !on;
    if (on) {
      const f = $("ieLiveFrame"); liveReady = false;
      f.onload = () => { liveReady = true; setTimeout(() => live(true), 600); setTimeout(() => live(true), 2000); };
      f.src = liveUrl(); fitLive();
    }
    setTimeout(fit, 50);
  }
  function fitLive() {
    const wrap = $("ieLiveWrap"), f = $("ieLiveFrame"); if (!wrap || !f) return;
    const k = Math.min(1, (wrap.clientWidth - 16) / liveW);
    f.style.width = liveW + "px"; f.style.height = Math.round((wrap.clientHeight - 4) / k) + "px"; f.style.transform = `scale(${k})`;
    f.parentElement.style.minWidth = "0";
  }
  // Imágenes de la página que corresponden a esta imagen (por nombre de archivo o por su lugar en la sección)
  function liveTargets(doc) {
    const names = [baseName(qs.get("src")), baseName(design.imageUrl)].filter(Boolean);
    let imgs = [...doc.querySelectorAll("img")].filter((i) => names.includes(baseName(i.dataset.ieOrig || i.getAttribute("src"))));
    if (!imgs.length && target.startsWith("block:")) {
      const [, id, path] = target.split(":"); const n = +(String(path).match(/\d+/) || [0])[0];
      const all = [...doc.querySelectorAll(`[data-block="${CSS.escape(id)}"] img`)]; if (all[n]) imgs = [all[n]];
    }
    if (!imgs.length && target.startsWith("product:")) imgs = [...doc.querySelectorAll("#pdMain")];
    return imgs;
  }
  function live(content) {
    if (!liveOn || !liveReady) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      const doc = $("ieLiveFrame").contentDocument; if (!doc || !doc.body) return;
      const imgs = liveTargets(doc);
      $("ieLiveInfo").textContent = imgs.length ? "" : " · Esta imagen todavía no está puesta en ninguna parte de la página";
      if (content && imgs.length) {
        const c = document.createElement("canvas"); c.width = D.w; c.height = D.h; paint(c.getContext("2d"), D.w, D.h);
        const blob = await new Promise((ok) => c.toBlob(ok, "image/webp", 0.8)).catch(() => null);
        if (blob) { if (liveBlobUrl) URL.revokeObjectURL(liveBlobUrl); liveBlobUrl = URL.createObjectURL(blob); }
      }
      // Marcas amarillas: la imagen completa y la capa elegida (o la que tiene el mouse encima)
      doc.querySelectorAll(".__ie-mark").forEach((m) => m.remove());
      let st = doc.getElementById("__ie-st");
      if (!st) { st = doc.createElement("style"); st.id = "__ie-st"; st.textContent = ".__ie-mark{position:absolute;pointer-events:none;z-index:2147483000;border:3px solid #facc15;box-shadow:0 0 0 1px #0009;border-radius:3px}.__ie-mark.l{border-style:dashed;background:#facc1526}.__ie-mark i{position:absolute;left:-3px;top:-22px;background:#facc15;color:#111;font:700 11px/1 Lato,sans-serif;padding:3px 6px;border-radius:4px;white-space:nowrap;font-style:normal}"; doc.head.appendChild(st); }
      const L = (hovId && byId(hovId)) || cur(), sx = doc.defaultView.scrollX, sy = doc.defaultView.scrollY;
      imgs.forEach((im, i) => {
        if (!im.dataset.ieOrig) im.dataset.ieOrig = im.getAttribute("src") || "";
        if (liveBlobUrl) { im.removeAttribute("srcset"); im.src = liveBlobUrl; }
        const r = im.getBoundingClientRect(); if (!r.width) return;
        const box = (x, y, w, h, cls, label) => { const m = doc.createElement("div"); m.className = "__ie-mark " + cls; Object.assign(m.style, { left: x + sx + "px", top: y + sy + "px", width: w + "px", height: h + "px" }); if (label) m.innerHTML = `<i>${esc(label)}</i>`; doc.body.appendChild(m); };
        box(r.left, r.top, r.width, r.height, "", i === 0 ? `${D.w} × ${D.h} → se ve a ${Math.round(r.width)} × ${Math.round(r.height)} px` : "");
        if (L && !L.hidden) {
          // Dónde se dibuja de verdad la imagen dentro de su caja (la página puede recortarla: object-fit cover / contain)
          const cs = doc.defaultView.getComputedStyle(im), fit = cs.objectFit;
          let w = r.width, h = r.height, ox = 0, oy = 0;
          if (fit === "cover" || fit === "contain") {
            const k = (fit === "cover" ? Math.max : Math.min)(r.width / D.w, r.height / D.h);
            w = D.w * k; h = D.h * k;
            const [px, py] = (cs.objectPosition || "50% 50%").split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : 0.5));
            ox = (r.width - w) * (isNaN(px) ? 0.5 : px); oy = (r.height - h) * (isNaN(py) ? 0.5 : py);
          }
          const x0 = Math.max(r.left, r.left + ox + w * L.x / D.w), y0 = Math.max(r.top, r.top + oy + h * L.y / D.h);
          const x1 = Math.min(r.right, r.left + ox + w * (L.x + L.w) / D.w), y1 = Math.min(r.bottom, r.top + oy + h * (L.y + L.h) / D.h);
          if (x1 > x0 && y1 > y0) box(x0, y0, x1 - x0, y1 - y0, "l", i === 0 ? L.name : "");
        }
        if (i === 0 && !im.dataset.ieSeen) { im.dataset.ieSeen = "1"; im.scrollIntoView({ block: "center" }); }
      });
    }, content ? 300 : 30);
  }

  /* ---------- Vista: zoom y superposición (selección, manijas, zonas) ---------- */
  function fit() {
    const st = $("ieStage"); const k = Math.min((st.clientWidth - 80) / D.w, (st.clientHeight - 80) / D.h, 1);
    setZoom(k > 0 ? k : 1);
  }
  function setZoom(k) {
    zoom = clamp(k, 0.05, 4);
    const b = $("ieBoard"); b.style.width = D.w * zoom + "px"; b.style.height = D.h * zoom + "px";
    $("ieZoomFit").textContent = Math.round(zoom * 100) + "%";
    $("ieSize").textContent = `${D.w} × ${D.h}`;
    overlay();
  }
  const boxCss = (L) => `left:${L.x * zoom}px;top:${L.y * zoom}px;width:${L.w * zoom}px;height:${L.h * zoom}px;transform:rotate(${L.rot || 0}deg)`;
  function linkLabel(k) {
    if (!k || !k.t) return "";
    const p = catalog && k.t === "product" ? catalog.find((x) => x.id === k.v) : null;
    const n = { product: "Producto: " + (p ? p.name : k.v), products: `${(k.v || []).length} productos`, category: "Categoría: " + k.v, brand: "Marca: " + k.v, section: "Sección: " + k.v, url: k.v, whatsapp: "WhatsApp" }[k.t];
    return "🔗 " + (n || "") + (k.price ? " · $ en vivo" : "");
  }
  function overlay() {
    if (!D) return;
    const ov = $("ieOv"); let h = "";
    D.layers.forEach((L) => {
      if (L.hidden) return;
      if (L.type === "zone") { if (showZones || L.id === sel) h += `<div class="zone" style="${boxCss(L)}"><i>${esc(linkLabel(L.link) || "🔗 Zona sin enlace")}</i></div>`; }
      else if (L.link && L.link.t && showZones) h += `<div class="zone lnk" style="${boxCss(L)}"><i>${esc(linkLabel(L.link))}</i></div>`;
    });
    const HV = hovId && hovId !== sel ? byId(hovId) : null;
    if (HV && !HV.hidden) h += `<div class="hov" style="${boxCss(HV)}"></div>`;
    const L = cur();
    if (L && !L.hidden) {
      h += `<div class="sel" style="${boxCss(L)}"></div>`;
      h += `<div class="dim" style="left:${(L.x + L.w / 2) * zoom}px;top:${(L.y + L.h) * zoom + 4}px">${Math.round(L.w)} × ${Math.round(L.h)} px</div>`;
      if (!L.locked) handles(L).forEach(([k, x, y]) => { h += `<div class="hdl${k === "rot" ? " rot" : ""}" data-h="${k}" style="left:${x * zoom}px;top:${y * zoom}px;cursor:${k === "rot" ? "grab" : CURSOR[k]}"></div>`; });
    }
    if (poly) h += `<svg><polyline points="${poly.map(([x, y]) => `${x * zoom},${y * zoom}`).join(" ")}" fill="none" stroke="#0084d6" stroke-width="2" stroke-dasharray="5 4"/>${poly.map(([x, y]) => `<circle cx="${x * zoom}" cy="${y * zoom}" r="4" fill="#fff" stroke="#0084d6" stroke-width="2"/>`).join("")}</svg>`;
    if (drawBox) h += `<div class="sel" style="left:${drawBox.x * zoom}px;top:${drawBox.y * zoom}px;width:${drawBox.w * zoom}px;height:${drawBox.h * zoom}px"></div>`;
    if (pen) h += `<svg><polyline points="${pen.map(([x, y]) => `${x * zoom},${y * zoom}`).join(" ")}" fill="none" stroke="#0084d6" stroke-width="2"/></svg>`;
    ov.innerHTML = h;
    ov.className = "ie-ov" + (["text", "rect", "ellipse", "pen", "poly", "zone"].includes(tool) ? " draw" : "");
  }
  const CURSOR = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
  const SIGN = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
  function rotPt(L, lx, ly) { const a = (L.rot || 0) * Math.PI / 180, cx = L.x + L.w / 2, cy = L.y + L.h / 2; return [cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a)]; }
  function handles(L) {
    const keys = L.type === "text" ? ["e", "w"] : Object.keys(SIGN);
    const out = keys.map((k) => { const [sx, sy] = SIGN[k]; const [x, y] = rotPt(L, sx * L.w / 2, sy * L.h / 2); return [k, x, y]; });
    const [rx, ry] = rotPt(L, 0, -L.h / 2 - 28 / zoom); out.push(["rot", rx, ry]);
    return out;
  }
  function hit(x, y) {
    for (let i = D.layers.length - 1; i >= 0; i--) {
      const L = D.layers[i]; if (L.hidden || (L.type === "zone" && !showZones && L.id !== sel)) continue;
      const a = -(L.rot || 0) * Math.PI / 180, cx = L.x + L.w / 2, cy = L.y + L.h / 2, dx = x - cx, dy = y - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a), pad = 4 / zoom;
      if (Math.abs(lx) <= L.w / 2 + pad && Math.abs(ly) <= L.h / 2 + pad) return L;
    }
    return null;
  }

  /* ---------- Mouse / dedo sobre el lienzo ---------- */
  let drag = null, drawBox = null, pen = null, poly = null;
  const pt = (e) => { const r = $("ieOv").getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; };
  function onDown(e) {
    if (e.button && e.button !== 0) return;
    const [x, y] = pt(e); const ov = $("ieOv");
    ov.setPointerCapture(e.pointerId);
    const hd = e.target.closest && e.target.closest("[data-h]");
    if (hd && cur()) { const L = cur(); drag = { kind: hd.dataset.h === "rot" ? "rot" : "resize", h: hd.dataset.h, L, start: clone(L), x, y }; return; }
    if (tool === "hand") { const st = $("ieStage"); drag = { kind: "pan", sx: e.clientX, sy: e.clientY, l: st.scrollLeft, t: st.scrollTop }; st.classList.add("drag"); return; }
    if (tool === "pen") { pen = [[x, y]]; return; }
    if (tool === "poly") { if (!poly) poly = []; poly.push([x, y]); overlay(); return; }
    if (["rect", "ellipse", "zone", "text"].includes(tool)) { drawBox = { x, y, w: 0, h: 0, ox: x, oy: y }; return; }
    const L = hit(x, y);
    if (tool === "crop" || tool === "wand") { if (L && L.type === "image") { select(L.id); toolAction(); } return; }
    select(L ? L.id : null);
    if (L && !L.locked) drag = { kind: "move", L, start: clone(L), x, y };
  }
  function onMove(e) {
    const [x, y] = pt(e);
    if (pen) { const l = pen[pen.length - 1]; if (Math.hypot(x - l[0], y - l[1]) * zoom > 3) { pen.push([x, y]); overlay(); } return; }
    if (drawBox) { Object.assign(drawBox, { x: Math.min(x, drawBox.ox), y: Math.min(y, drawBox.oy), w: Math.abs(x - drawBox.ox), h: Math.abs(y - drawBox.oy) }); overlay(); return; }
    if (!drag) return;
    if (drag.kind === "pan") { const st = $("ieStage"); st.scrollLeft = drag.l - (e.clientX - drag.sx); st.scrollTop = drag.t - (e.clientY - drag.sy); return; }
    const L = drag.L, s = drag.start, dx = x - drag.x, dy = y - drag.y;
    if (drag.kind === "move") {
      let nx = s.x + dx, ny = s.y + dy;
      // Imán: bordes y centro del lienzo
      const snap = 8 / zoom;
      [[0, "x"], [D.w - s.w, "x"], [(D.w - s.w) / 2, "x"]].forEach(([v]) => { if (Math.abs(nx - v) < snap) nx = v; });
      [[0], [D.h - s.h], [(D.h - s.h) / 2]].forEach(([v]) => { if (Math.abs(ny - v) < snap) ny = v; });
      L.x = Math.round(nx); L.y = Math.round(ny);
    } else if (drag.kind === "rot") {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      let a = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      L.rot = Math.round(((a + 540) % 360) - 180);
    } else {
      const [sx, sy] = SIGN[drag.h], a = -(s.rot || 0) * Math.PI / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      let w = Math.max(4, s.w + sx * lx), h = Math.max(4, s.h + sy * ly);
      if ((e.shiftKey || s.type === "image") && sx && sy && !e.altKey) { const k = Math.max(w / s.w, h / s.h); w = s.w * k; h = s.h * k; }
      const dw = w - s.w, dh = L.type === "text" ? 0 : h - s.h;
      const [cx, cy] = rotPt(s, sx * dw / 2, sy * dh / 2);
      L.w = Math.round(w); if (L.type !== "text") L.h = Math.round(h);
      L.x = Math.round(cx - L.w / 2); L.y = Math.round(cy - L.h / 2);
    }
    render(); syncFields();
  }
  function onUp() {
    if (pen) { const p = pen; pen = null; if (p.length > 2) addPath(p, false, true); else overlay(); return; }
    if (drawBox) {
      const b = drawBox; drawBox = null;
      if (tool === "text") { add(layer("text", { x: Math.round(b.ox), y: Math.round(b.oy), w: Math.max(200, Math.round(b.w)) })); setTool("select"); return; }
      if (b.w * zoom < 6 || b.h * zoom < 6) { overlay(); return; }
      add(layer(tool, { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), ...(tool === "zone" ? { name: "Zona tocable", link: { t: "" } } : {}) }));
      setTool("select"); return;
    }
    if (drag) { const moved = drag.kind !== "pan" && JSON.stringify(drag.start) !== JSON.stringify(drag.L); if (drag.kind === "pan") $("ieStage").classList.remove("drag"); drag = null; if (moved) commit(); }
  }
  function addPath(P, closed, smooth) {
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(4, Math.max(...xs) - x), h = Math.max(4, Math.max(...ys) - y);
    add(layer("path", { name: closed ? "Forma" : smooth ? "Trazo" : "Curva", x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), closed, smooth,
      points: P.map(([px, py]) => [+((px - x) / w).toFixed(4), +((py - y) / h).toFixed(4)]), fill: closed ? "#0084d6" : "" }));
  }
  function finishPoly() {
    if (!poly) return; const p = poly; poly = null;
    if (p.length < 2) return overlay();
    // Si el último punto quedó cerca del primero, la forma se cierra
    const closed = p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) * zoom < 14;
    if (closed) p.pop();
    addPath(p, closed, $("iePolySmooth") ? $("iePolySmooth").checked : true);
    setTool("select");
  }

  /* ---------- Historial ---------- */
  function snapshot(reset) { const s = JSON.stringify({ D, name: design.name }); if (reset) { undo.length = 0; redo.length = 0; } undo.push(s); if (undo.length > 80) undo.shift(); buttons(); }
  function commit() { snapshot(); dirty = true; renderSide(); render(); setState("Cambios sin guardar"); }
  function restore(s) { const o = JSON.parse(s); D = o.D; design.name = o.name; $("ieName").value = design.name; if (sel && !byId(sel)) sel = null; D.layers.filter((l) => l.type === "image").forEach((l) => loadImg(l.src).catch(() => null)); setZoom(zoom); render(); renderSide(); dirty = true; buttons(); }
  function doUndo() { if (undo.length < 2) return; redo.push(undo.pop()); restore(undo[undo.length - 1]); }
  function doRedo() { if (!redo.length) return; const s = redo.pop(); undo.push(s); restore(s); }
  function buttons() { $("ieUndo").disabled = undo.length < 2; $("ieRedo").disabled = !redo.length; }

  /* ---------- Acciones ---------- */
  function add(L) { D.layers.push(L); sel = L.id; if (L.type === "image") loadImg(L.src).catch(() => null); commit(); }
  function select(id) {
    sel = id; renderSide(); overlay(); live();
    const row = sel && document.querySelector(`#ieLayers [data-sel="${sel}"]`); if (row) row.scrollIntoView({ block: "nearest" });
  }
  function removeSel() { const L = cur(); if (!L) return; D.layers = D.layers.filter((l) => l !== L); sel = null; commit(); }
  function duplicate() { const L = cur(); if (!L) return; const c = clone(L); c.id = uid(); c.name += " (copia)"; c.x += 20; c.y += 20; c.locked = false; D.layers.splice(D.layers.indexOf(L) + 1, 0, c); sel = c.id; commit(); }
  function move(id, d) { const i = D.layers.findIndex((l) => l.id === id), j = i + d; if (i < 0 || j < 0 || j >= D.layers.length) return; [D.layers[i], D.layers[j]] = [D.layers[j], D.layers[i]]; commit(); }
  function setTool(t) {
    if (tool === "poly" && t !== "poly") finishPoly();
    tool = t; document.querySelectorAll("#ieTools [data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
    $("ieStage").classList.toggle("hand", t === "hand");
    if (t === "image") { $("ieFile").click(); tool = "select"; setTool("select"); return; }
    if (t === "crop" || t === "wand") toolAction();
    overlay();
  }
  function toolAction() {
    const L = cur();
    if (!L || L.type !== "image") return setState(tool === "crop" ? "Elegí una imagen para recortarla." : "Elegí una imagen para quitarle el fondo blanco.");
    if (tool === "wand") { L.cut = !L.cut; commit(); setState(L.cut ? "Fondo blanco quitado (ajustá la tolerancia a la derecha)." : "Fondo blanco restaurado."); setTool("select"); }
    else { renderSide(); const c = document.querySelector("#ieSide [data-sec=crop]"); if (c) c.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
  async function onFile(files) {
    const f = [...files].find((x) => x.type.startsWith("image/")); if (!f) return;
    setState("Subiendo imagen…");
    try {
      const r = await uploadImage(f);
      await loadImg(r.src);
      const k = Math.min(1, (D.w * 0.6) / r.w, (D.h * 0.6) / r.h);
      add(layer("image", { name: f.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Imagen", src: r.src, w: Math.round(r.w * k), h: Math.round(r.h * k), x: Math.round((D.w - r.w * k) / 2), y: Math.round((D.h - r.h * k) / 2) }));
      setState(demo ? "Imagen agregada (en demo no se sube)." : "Imagen agregada.", "ok");
    } catch (e) { setState("No se pudo subir la imagen: " + e.message, "err"); }
  }
  function setState(m, kind) { const s = $("ieState"); s.textContent = m || ""; s.className = "ie-state" + (kind ? " " + kind : ""); }

  /* ---------- Productos (para los enlaces) ---------- */
  const DEMO_PRODUCTS = [
    { id: "amd-ryzen-5-8500g", name: "Procesador AMD Ryzen 5 8500G AM5", brand: "AMD", category: "Procesadores", stock: 4 },
    { id: "amd-ryzen-7-5800x", name: "Procesador AMD Ryzen 7 5800X AM4", brand: "AMD", category: "Procesadores", stock: 2 },
    { id: "intel-i5-13400", name: "Procesador Intel Core i5 13400", brand: "Intel", category: "Procesadores", stock: 0 },
    { id: "asus-gtx1660", name: "Placa de video ASUS GTX 1660", brand: "ASUS", category: "Placas de video", stock: 3 },
  ];
  async function loadCatalog() {
    if (catalog) return catalog;
    if (demo) catalog = DEMO_PRODUCTS;
    else { const r = await be.sb.from("products").select("id,name,brand,category,stock,active").eq("active", true).order("name"); catalog = r.error ? [] : r.data; }
    setTimeout(() => { renderSide(); overlay(); });
    return catalog;
  }
  const uniq = (k) => [...new Set((catalog || []).map((p) => p[k]).filter(Boolean))].sort();

  /* ---------- Panel derecho ---------- */
  const num = (label, key, v, min, max, step = 1, unit = "") => `<label class="f"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${key}"><input type="number" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${key}" aria-label="${label}${unit ? " (" + unit + ")" : ""}"></label>`;
  const color = (label, key, v) => `<label class="f w2"><span>${label}</span><input type="color" value="${/^#[0-9a-f]{6}$/i.test(v || "") ? v : "#000000"}" data-k="${key}"></label>`;
  const optColor = (label, key, v) => `<div class="f"><span>${label}</span><input type="color" value="${/^#[0-9a-f]{6}$/i.test(v || "") ? v : "#000000"}" data-k="${key}" ${v ? "" : 'data-off="1" style="opacity:.35"'}><button type="button" class="sbtn" data-clear="${key}" title="${v ? "Quitar" : "Usar color"}">${v ? "✕" : "＋"}</button></div>`;
  const check = (label, key, v) => `<label class="chk"><input type="checkbox" data-k="${key}" ${v ? "checked" : ""}> ${label}</label>`;
  const selectF = (label, key, v, opts) => `<label class="f w2"><span>${label}</span><select data-k="${key}">${opts.map(([val, t]) => `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;

  function renderSide() {
    const L = cur(), side = $("ieSide");
    const top = side.scrollTop;
    let h = `<h4>Capas</h4><div id="ieLayers">${[...D.layers].reverse().map((l) => `<div class="ly${l.id === sel ? " on" : ""}" data-sel="${l.id}">
        <button type="button" data-vis="${l.id}" title="${l.hidden ? "Mostrar" : "Ocultar"}" aria-label="${l.hidden ? "Mostrar" : "Ocultar"} ${esc(l.name)}">${l.hidden ? "🚫" : "👁"}</button>
        <button type="button" data-lock="${l.id}" title="${l.locked ? "Desbloquear" : "Bloquear"}" aria-label="${l.locked ? "Desbloquear" : "Bloquear"} ${esc(l.name)}">${l.locked ? "🔒" : "🔓"}</button>
        <span class="nm">${TYPE_ICON[l.type]} ${esc(l.name)}${l.link && l.link.t ? " 🔗" : ""}</span><small>${TYPE_NAME[l.type]}</small>
        <button type="button" data-mv="${l.id}" data-d="1" title="Subir" aria-label="Subir ${esc(l.name)}">▲</button><button type="button" data-mv="${l.id}" data-d="-1" title="Bajar" aria-label="Bajar ${esc(l.name)}">▼</button></div>`).join("") || '<p class="hint">Sin capas todavía: usá las herramientas de la izquierda.</p>'}
      <div class="ly" data-sel=""><span class="nm">▦ Fondo del lienzo</span><small>fondo</small></div></div>`;
    h += L ? layerProps(L) : canvasProps();
    side.innerHTML = h; side.scrollTop = top;
  }
  function canvasProps() {
    const b = D.bg;
    return `<h4>Lienzo</h4>
      <div class="xy"><label>Ancho<input type="number" min="50" max="4000" value="${D.w}" data-doc="w"></label><label>Alto<input type="number" min="50" max="4000" value="${D.h}" data-doc="h"></label></div>
      <div class="chips" style="margin-top:6px">${PRESETS.map(([n, w, h], i) => `<button type="button" data-preset="${i}" title="${w} × ${h}">${esc(n)}</button>`).join("")}</div>
      <h4>Fondo</h4>
      <div class="chips">${[["color", "Color"], ["grad", "Degradé"], ["none", "Transparente"]].map(([k, t]) => `<button type="button" data-bg="${k}" aria-pressed="${b.type === k}">${t}</button>`).join("")}</div>
      ${b.type !== "none" ? `<label class="f w2"><span>${b.type === "grad" ? "Color 1" : "Color"}</span><input type="color" value="${b.c1}" data-bgk="c1"></label>` : ""}
      ${b.type === "grad" ? `<label class="f w2"><span>Color 2</span><input type="color" value="${b.c2}" data-bgk="c2"></label><label class="f"><span>Ángulo</span><input type="range" min="0" max="360" value="${b.angle}" data-bgk="angle"><input type="number" min="0" max="360" value="${b.angle}" data-bgk="angle" aria-label="Ángulo"></label>` : ""}
      <p class="hint">Elegí una capa en la lista (o tocándola en el lienzo) para editarla. Atajos: Supr borra, Ctrl+D duplica, flechas mueven (Shift = 10 px), Ctrl+Z deshace.</p>`;
  }
  function layerProps(L) {
    const fx = L.fx || {};
    let h = `<h4 class="on">${TYPE_ICON[L.type]} ${esc(TYPE_NAME[L.type])} seleccionado</h4>
      <label class="f w2"><span>Nombre</span><input type="text" value="${esc(L.name)}" data-k="name" maxlength="60"></label>
      <div class="xy"><label>X<input type="number" value="${L.x}" data-k="x"></label><label>Y<input type="number" value="${L.y}" data-k="y"></label><label>Ancho<input type="number" min="1" value="${L.w}" data-k="w"></label><label>Alto<input type="number" min="1" value="${L.h}" data-k="h" ${L.type === "text" ? "disabled" : ""}></label></div>
      <div class="row" style="margin:6px 0"><button type="button" class="sbtn" data-align="l" title="Alinear a la izquierda del lienzo">⇤</button><button type="button" class="sbtn" data-align="c" title="Centrar horizontal">↔</button><button type="button" class="sbtn" data-align="r" title="Alinear a la derecha">⇥</button><button type="button" class="sbtn" data-align="t" title="Arriba">⤒</button><button type="button" class="sbtn" data-align="m" title="Centrar vertical">↕</button><button type="button" class="sbtn" data-align="b" title="Abajo">⤓</button>${L.type === "image" ? '<button type="button" class="sbtn" data-align="fill" title="Cubrir todo el lienzo">⛶</button>' : ""}</div>`;
    if (L.type !== "zone") h += num("Rotación", "rot", L.rot || 0, -180, 180, 1, "°") + num("Opacidad", "opacity", L.opacity, 0, 100, 1, "%") + selectF("Fusión", "blend", L.blend, Object.entries(BLENDS).map(([k, v]) => [k, v[1]]));
    if (L.type === "text") h += `<h4>Texto</h4><textarea class="in" data-k="text" rows="3">${esc(L.text)}</textarea>
      ${selectF("Letra", "font", L.font, FONTS.map((f) => [f, f]))}${num("Tamaño", "size", L.size, 8, 400, 1, "px")}
      ${selectF("Grosor", "weight", L.weight, [[400, "Normal"], [700, "Negrita"], [900, "Extra negrita"]])}${num("Interlineado", "lineH", L.lineH || 1.15, 0.8, 2.5, 0.05)}
      ${color("Color", "color", L.color)}
      <div class="chips" style="margin:6px 0">${[["left", "⇤ Izquierda"], ["center", "↔ Centro"], ["right", "⇥ Derecha"]].map(([k, t]) => `<button type="button" data-set="align" data-v="${k}" aria-pressed="${L.align === k}">${t}</button>`).join("")}<button type="button" data-set="italic" data-v="${!L.italic}" aria-pressed="${!!L.italic}"><i>Cursiva</i></button></div>
      ${optColor("Contorno", "stroke", L.stroke)}${L.stroke ? num("Grosor contorno", "strokeW", L.strokeW || 0, 0, 30) : ""}`;
    if (["rect", "ellipse", "path"].includes(L.type)) h += `<h4>Relleno y borde</h4>${L.type !== "path" || L.closed ? optColor("Relleno", "fill", L.fill) : ""}${optColor("Borde", "stroke", L.stroke)}${L.stroke ? num("Grosor", "strokeW", L.strokeW || 0, 0, 80) : ""}${L.type === "rect" ? num("Esquinas", "radius", L.radius || 0, 0, 400) : ""}
      ${L.type === "path" ? check("Suavizar (curva)", "smooth", L.smooth) + check("Cerrar la forma", "closed", L.closed) : ""}`;
    if (L.type === "image") {
      const a = L.adj || {}, c = L.crop || {};
      h += `<h4>Imagen</h4><div class="row"><button type="button" class="sbtn" data-replace="1">Reemplazar imagen…</button><button type="button" class="sbtn" data-natural="1" title="Tamaño original de la foto">1:1</button></div>
        ${num("Esquinas", "radius", L.radius || 0, 0, 400)}${optColor("Borde", "stroke", L.stroke)}${L.stroke ? num("Grosor", "strokeW", L.strokeW || 0, 0, 80) : ""}
        <h4>Ajustes de imagen</h4>${num("Brillo", "adj.bri", a.bri ?? 100, 0, 200, 1, "%")}${num("Contraste", "adj.con", a.con ?? 100, 0, 200, 1, "%")}${num("Saturación", "adj.sat", a.sat ?? 100, 0, 300, 1, "%")}
        ${check("🪄 Quitar fondo blanco", "cut", L.cut)}${L.cut ? num("Tolerancia", "cutTol", L.cutTol ?? 30, 1, 60) : ""}
        <h4 data-sec="crop">✂ Recorte</h4>${num("Izquierda", "crop.l", c.l || 0, 0, 90, 1, "%")}${num("Derecha", "crop.r", c.r || 0, 0, 90, 1, "%")}${num("Arriba", "crop.t", c.t || 0, 0, 90, 1, "%")}${num("Abajo", "crop.b", c.b || 0, 0, 90, 1, "%")}`;
    }
    if (L.type !== "zone") h += `<h4>Efectos de la capa</h4>
      <div class="fx">${check("Sombra", "fx.shadow.on", fx.shadow && fx.shadow.on)}${fx.shadow && fx.shadow.on ? num("Horizontal", "fx.shadow.x", fx.shadow.x ?? 0, -200, 200) + num("Vertical", "fx.shadow.y", fx.shadow.y ?? 8, -200, 200) + num("Difuminado", "fx.shadow.blur", fx.shadow.blur ?? 20, 0, 200) + num("Opacidad", "fx.shadow.a", fx.shadow.a ?? 50, 0, 100) + color("Color", "fx.shadow.color", fx.shadow.color || "#000000") : ""}</div>
      <div class="fx">${check("Brillo (resplandor)", "fx.glow.on", fx.glow && fx.glow.on)}${fx.glow && fx.glow.on ? num("Tamaño", "fx.glow.blur", fx.glow.blur ?? 30, 0, 200) + num("Intensidad", "fx.glow.a", fx.glow.a ?? 90, 0, 100) + color("Color", "fx.glow.color", fx.glow.color || "#0084d6") : ""}</div>
      ${L.type !== "text" ? `<div class="fx">${check("Borde exterior", "fx.border.on", fx.border && fx.border.on)}${fx.border && fx.border.on ? num("Grosor", "fx.border.w", fx.border.w ?? 3, 1, 60) + color("Color", "fx.border.color", fx.border.color || "#ffffff") : ""}</div>` : ""}
      <div class="fx">${check("Desenfoque", "fx.blur.on", fx.blur && fx.blur.on)}${fx.blur && fx.blur.on ? num("Cantidad", "fx.blur.r", fx.blur.r ?? 4, 0, 60) : ""}</div>`;
    h += linkProps(L);
    h += `<h4>Capa</h4><div class="row"><button type="button" class="sbtn" data-act="dup">⧉ Duplicar</button><button type="button" class="sbtn" data-act="front">⇈ Al frente</button><button type="button" class="sbtn" data-act="back">⇊ Al fondo</button><button type="button" class="sbtn del" data-act="del">✕ Borrar</button></div>`;
    return h;
  }
  function linkProps(L) {
    const k = L.link || { t: "" };
    let h = `<h4>🔗 Al hacer clic${L.type === "zone" ? " en la zona" : ""}</h4><div class="chips">${LINKS.map(([t, n]) => `<button type="button" data-lt="${t}" aria-pressed="${(k.t || "") === t}">${n}</button>`).join("")}</div>`;
    if (!k.t) return h + `<p class="hint">${L.type === "zone" ? "Elegí a dónde lleva esta zona." : "Sin enlace. También podés dibujar una zona tocable (🔗) sobre cualquier parte."}</p>`;
    if (["product", "products", "category", "brand"].includes(k.t) && !catalog) { loadCatalog(); return h + '<p class="hint">Cargando productos…</p>'; }
    if (k.t === "product" || k.t === "products") {
      const multi = k.t === "products", chosen = new Set(multi ? k.v || [] : [k.v]);
      const q = (L.__q || "").toLowerCase();
      const list = catalog.filter((p) => !q || `${p.name} ${p.brand || ""}`.toLowerCase().includes(q)).sort((a, b) => chosen.has(b.id) - chosen.has(a.id)).slice(0, 60);
      h += `<input class="in" style="margin-top:8px" type="search" placeholder="🔍 Buscar producto" value="${esc(L.__q || "")}" data-lq="1" aria-label="Buscar producto">
        <div class="plist">${list.map((p) => `<label><input type="${multi ? "checkbox" : "radio"}" name="lp" value="${esc(p.id)}" data-lp="1" ${chosen.has(p.id) ? "checked" : ""}><span>${esc(p.name)}</span><small>${typeof p.stock === "number" ? (p.stock > 0 ? "stock " + p.stock : "sin stock") : ""}</small></label>`).join("") || '<p class="hint">Sin resultados.</p>'}</div>
        ${multi ? `<p class="hint">${chosen.size} elegidos: la tienda muestra solo esos productos.</p>` : check("Mostrar el precio sobre la imagen (se actualiza solo)", "link.price", k.price) + check("Ocultar si no hay stock", "link.hide", k.hide)}`;
    }
    if (k.t === "category") h += selectF("Categoría", "link.v", k.v || "", [["", "Elegir…"], ...uniq("category").map((c) => [c, c])]);
    if (k.t === "brand") h += selectF("Marca", "link.v", k.v || "", [["", "Elegir…"], ...uniq("brand").map((c) => [c, c])]);
    if (k.t === "section") h += selectF("Sección", "link.v", k.v || "", [["", "Elegir…"], ...SECTIONS]);
    if (k.t === "url") h += `<label class="f w2"><span>Dirección</span><input type="text" data-k="link.v" value="${esc(k.v || "")}" placeholder="https://…"></label>${/^https?:\/\/[^\s]+$/i.test(k.v || "") || !k.v ? "" : '<p class="hint" style="color:#f87171">Tiene que empezar con https://</p>'}${check("Abrir en pestaña nueva", "link.tab", k.tab)}`;
    if (k.t === "whatsapp") h += `<textarea class="in" style="margin-top:8px" data-k="link.v" rows="3" placeholder="Mensaje (ej: Hola EXE! Quiero consultar por el Ryzen 5 8500G)" maxlength="400">${esc(k.v || "")}</textarea>`;
    return h;
  }
  function syncFields() {
    const L = cur(); if (!L) return;
    ["x", "y", "w", "h", "rot"].forEach((k) => document.querySelectorAll(`#ieSide [data-k="${k}"]`).forEach((i) => { if (document.activeElement !== i) i.value = L[k] || 0; }));
  }
  const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  function setPath(o, p, v) { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach((k) => { if (!a[k] || typeof a[k] !== "object") a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }

  let editTimer;
  function onSideInput(e) {
    const t = e.target, L = cur();
    if (t.dataset.doc) { const v = clamp(Math.round(+t.value || 0), 50, 4000); D[t.dataset.doc] = v; setZoom(zoom); render(); later(); return; }
    if (t.dataset.bgk) { D.bg[t.dataset.bgk] = t.type === "color" ? t.value : +t.value; sibling(t); render(); later(); return; }
    if (t.dataset.lq && L) { L.__q = t.value; clearTimeout(editTimer); editTimer = setTimeout(() => { renderSide(); const q = document.querySelector("[data-lq]"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200); return; }
    if (t.dataset.lp && L) {
      if (L.link.t === "products") { const s = new Set(L.link.v || []); t.checked ? s.add(t.value) : s.delete(t.value); L.link.v = [...s].slice(0, 60); }
      else L.link.v = t.value;
      if (L.type === "zone" && /^Zona/.test(L.name)) { const p = catalog.find((x) => x.id === L.link.v); if (p) L.name = "Zona " + p.name.slice(0, 40); }
      commit(); return;
    }
    const k = t.dataset.k; if (!k || !L) return;
    let v = t.type === "checkbox" ? t.checked : t.type === "range" || t.type === "number" ? +t.value : t.value;
    if (t.type === "number" && t.value === "") return;
    if (t.dataset.off) { delete t.dataset.off; t.style.opacity = ""; }
    if (["x", "y", "w", "h"].includes(k)) v = Math.round(v);
    if (k === "w" || k === "h") v = Math.max(1, v);
    if (k === "link.v" && L.link && L.link.t === "url") v = String(v).trim().slice(0, 500);
    setPath(L, k, v);
    sibling(t);
    render();
    // Los checkboxes que muestran u ocultan controles necesitan redibujar el panel
    if (t.type === "checkbox" || t.tagName === "SELECT" || (k === "stroke" && t.type === "color")) { commit(); if (k === "cut" && v) setState("Fondo blanco quitado."); return; }
    later();
    if (k === "name") document.querySelectorAll(`#ieLayers [data-sel="${L.id}"] .nm`).forEach((n) => { n.textContent = `${TYPE_ICON[L.type]} ${L.name}${L.link && L.link.t ? " 🔗" : ""}`; });
  }
  function sibling(t) { const f = t.closest(".f"); if (f) f.querySelectorAll("input").forEach((i) => { if (i !== t && i.type !== "color" && (i.dataset.k || i.dataset.bgk)) i.value = t.value; }); }
  let laterT; function later() { clearTimeout(laterT); laterT = setTimeout(() => { snapshot(); dirty = true; setState("Cambios sin guardar"); }, 400); }

  function onSideClick(e) {
    const t = e.target.closest("button, [data-sel]"); if (!t) return;
    const L = cur(), d = t.dataset;
    if (d.vis) { const l = byId(d.vis); l.hidden = !l.hidden; return commit(); }
    if (d.lock) { const l = byId(d.lock); l.locked = !l.locked; return commit(); }
    if (d.mv) return move(d.mv, +d.d);
    if (d.sel !== undefined && t.classList.contains("ly")) return select(d.sel || null);
    if (d.preset) { const [, w, h] = PRESETS[+d.preset]; D.w = w; D.h = h; fit(); return commit(); }
    if (d.bg) { D.bg.type = d.bg; return commit(); }
    if (!L) return;
    if (d.clear) { const k = d.clear; if (L[k]) L[k] = ""; else { L[k] = k === "fill" ? "#0084d6" : "#111111"; if (k === "stroke" && !L.strokeW) L.strokeW = L.type === "text" ? 2 : 3; } return commit(); }
    if (d.set) { L[d.set] = d.v === "true" ? true : d.v === "false" ? false : d.v; return commit(); }
    if (d.lt !== undefined) { L.link = d.lt ? { t: d.lt, v: d.lt === "products" ? [] : "" } : null; if (d.lt === "product") L.link.price = false; return commit(); }
    if (d.align) {
      const m = { l: () => (L.x = 0), c: () => (L.x = Math.round((D.w - L.w) / 2)), r: () => (L.x = D.w - L.w), t: () => (L.y = 0), m: () => (L.y = Math.round((D.h - L.h) / 2)), b: () => (L.y = D.h - L.h),
        fill: () => { const im = imgCache.get(L.src); const k = im && im.naturalWidth ? Math.max(D.w / im.naturalWidth, D.h / im.naturalHeight) : 1; L.w = Math.round(im ? im.naturalWidth * k : D.w); L.h = Math.round(im ? im.naturalHeight * k : D.h); L.x = Math.round((D.w - L.w) / 2); L.y = Math.round((D.h - L.h) / 2); L.rot = 0; } };
      m[d.align](); return commit();
    }
    if (d.replace) { $("ieFile").dataset.replace = L.id; return $("ieFile").click(); }
    if (d.natural) { const im = imgCache.get(L.src); if (im && im.naturalWidth) { L.w = im.naturalWidth; L.h = im.naturalHeight; } return commit(); }
    if (d.act === "dup") return duplicate();
    if (d.act === "del") return removeSel();
    if (d.act === "front") { D.layers = D.layers.filter((l) => l !== L); D.layers.push(L); return commit(); }
    if (d.act === "back") { D.layers = D.layers.filter((l) => l !== L); D.layers.unshift(L); return commit(); }
  }

  /* ---------- Guardar ---------- */
  // Zonas con enlace, en fracciones de la imagen (0–1), para que la tienda las dibuje a cualquier tamaño
  function hotspots() {
    const out = [];
    D.layers.forEach((L) => {
      const k = L.link; if (L.hidden || !k || !k.t) return;
      if (k.t === "url" && !/^https?:\/\/[^\s]+$/i.test(k.v || "")) return;
      if (["product", "category", "brand", "section"].includes(k.t) && !k.v) return;
      if (k.t === "products" && !(k.v || []).length) return;
      // Caja que contiene la capa girada
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotPt(L, sx * L.w / 2, sy * L.h / 2));
      const x0 = clamp(Math.min(...pts.map((p) => p[0])), 0, D.w), x1 = clamp(Math.max(...pts.map((p) => p[0])), 0, D.w);
      const y0 = clamp(Math.min(...pts.map((p) => p[1])), 0, D.h), y1 = clamp(Math.max(...pts.map((p) => p[1])), 0, D.h);
      if (x1 - x0 < 2 || y1 - y0 < 2) return;
      const r = (n) => +n.toFixed(4);
      const link = { t: k.t, v: k.t === "products" ? k.v.slice(0, 60) : String(k.v || "").slice(0, 500) };
      if (k.t === "url" && k.tab) link.tab = true;
      if (k.t === "product") { if (k.price) link.price = true; if (k.hide) link.hide = true; }
      out.push({ x: r(x0 / D.w), y: r(y0 / D.h), w: r((x1 - x0) / D.w), h: r((y1 - y0) / D.h), label: String(L.name || "").slice(0, 80), link });
    });
    return out.reverse().slice(0, 40);   // la capa de más arriba primero
  }
  function exportBlob() {
    const c = document.createElement("canvas"); c.width = D.w; c.height = D.h;
    paint(c.getContext("2d"), D.w, D.h);
    return new Promise((ok, ko) => { try { c.toBlob((b) => (b ? ok(b) : ko(new Error("No se pudo generar la imagen"))), "image/webp", 0.88); } catch (e) { ko(new Error("Una imagen externa no permite exportar: reemplazala por una subida.")); } });
  }
  async function exportFile() {
    try {
      const b = await exportBlob(); const a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = (design.name || "diseño").replace(/[^\w\- áéíóúñ]+/gi, "").trim() + ".webp"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setState(e.message, "err"); }
  }
  async function save(apply = true) {
    const btn = $(apply ? "ieSave" : "ieSaveDraft"); btn.disabled = true; setState("Guardando…");
    try {
      design.name = ($("ieName").value || "Diseño").trim().slice(0, 120);
      const blob = await exportBlob(), hs = hotspots();
      if (demo) { dirty = false; setState(`Modo demo (${apply ? "aplicar" : "guardar"}): se generó la imagen (${Math.round(blob.size / 1024)} KB) y ${hs.length} zona${hs.length === 1 ? "" : "s"} con enlace, pero no se guardó.`, "ok"); return; }
      design.id = design.id || uid();
      const path = `disenos/${design.id}-${Date.now()}.webp`;
      const up = await be.sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
      if (up.error) throw up.error;
      const url = be.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      design.imageUrl = design.imageUrl || url;
      const doc = clone(D); doc.layers.forEach((l) => delete l.__q); delete doc.w; delete doc.h; doc.target = target;
      const row = { id: design.id, name: design.name, kind: design.kind, width: D.w, height: D.h, doc, image_url: url, hotspots: hs, updated_at: new Date().toISOString() };
      const r = await be.sb.from("designs").upsert(row);
      if (r.error) throw r.error;
      history.replaceState(null, "", `?id=${design.id}`);
      let where = "";
      if (target && apply) where = await applyTarget(url);
      dirty = false;
      setState(`${where ? "Guardado y aplicado en " + where : apply && !target ? "Guardado (este diseño todavía no está puesto en ninguna parte de la web)" : "Cambios guardados (la web todavía no cambió: tocá Aplicar en la web)"}. ${hs.length} zona${hs.length === 1 ? "" : "s"} con enlace.`, "ok");
    } catch (e) { setState("No se pudo guardar: " + e.message, "err"); }
    finally { btn.disabled = false; }
  }
  // Reemplaza la imagen donde se usa: una sección de la página (site_blocks) o una foto de producto
  async function applyTarget(url) {
    const [kind, id, where] = target.split(":");
    if (kind === "block") {
      const r = await be.sb.from("site_blocks").select("data").eq("id", id).single();
      if (r.error) throw r.error;
      const data = r.data.data || {};
      if (!/^[\w.]+$/.test(where || "")) throw new Error("Ubicación inválida");
      setPath(data, where, url);
      const u = await be.sb.from("site_blocks").update({ data, updated_at: new Date().toISOString() }).eq("id", id);
      if (u.error) throw u.error;
      return "la página";
    }
    if (kind === "product") {
      const r = await be.sb.from("products").select("images").eq("id", id).single();
      if (r.error) throw r.error;
      const imgs = [...(r.data.images || [])], n = clamp(+where || 0, 0, 20);
      if (n < imgs.length) imgs[n] = url; else imgs.push(url);
      const u = await be.sb.from("products").update({ images: imgs }).eq("id", id);
      if (u.error) throw u.error;
      return "el producto";
    }
    return "";
  }

  /* ---------- Eventos ---------- */
  function bindUi() {
    const ov = $("ieOv");
    ov.addEventListener("pointerdown", onDown);
    ov.addEventListener("pointermove", onMove);
    ov.addEventListener("pointerup", onUp);
    ov.addEventListener("pointercancel", onUp);
    ov.addEventListener("dblclick", (e) => { if (tool === "poly") return finishPoly(); const [x, y] = pt(e); const L = hit(x, y); if (L && L.type === "text") { select(L.id); const t = document.querySelector('#ieSide [data-k="text"]'); if (t) { t.focus(); t.select(); } } });
    $("ieTools").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); });
    $("ieSide").addEventListener("input", onSideInput);
    $("ieSide").addEventListener("change", (e) => { if (e.target.type === "color") { commit(); } });
    $("ieSide").addEventListener("click", onSideClick);
    $("ieFile").addEventListener("change", async (e) => {
      const rep = e.target.dataset.replace; delete e.target.dataset.replace;
      const files = e.target.files; if (!files.length) return;
      if (rep) {
        const L = byId(rep); setState("Subiendo imagen…");
        try { const r = await uploadImage(files[0]); await loadImg(r.src); L.src = r.src; L.h = Math.round(L.w * r.h / r.w); commit(); setState("Imagen reemplazada.", "ok"); } catch (err) { setState("No se pudo subir: " + err.message, "err"); }
      } else onFile(files);
      e.target.value = "";
    });
    // Arrastrar o pegar imágenes directo en el lienzo
    $("ieStage").addEventListener("dragover", (e) => e.preventDefault());
    $("ieStage").addEventListener("drop", (e) => { e.preventDefault(); onFile(e.dataTransfer.files); });
    document.addEventListener("paste", (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; const f = [...(e.clipboardData || {}).files || []]; if (f.length) { e.preventDefault(); onFile(f); } });
    $("ieUndo").onclick = doUndo; $("ieRedo").onclick = doRedo;
    $("ieZoomIn").onclick = () => setZoom(zoom * 1.25); $("ieZoomOut").onclick = () => setZoom(zoom / 1.25); $("ieZoomFit").onclick = fit;
    $("ieZones").onclick = () => { showZones = !showZones; $("ieZones").setAttribute("aria-pressed", showZones); overlay(); };
    $("ieExport").onclick = exportFile;
    $("ieSave").onclick = () => save(true);
    $("ieSaveDraft").onclick = () => save(false);
    $("ieLive").onclick = () => toggleLive();
    $("ieLiveClose").onclick = () => toggleLive(false);
    document.querySelectorAll("[data-lw]").forEach((b) => (b.onclick = () => { liveW = +b.dataset.lw; fitLive(); }));
    // Pasar el mouse por una capa de la lista la marca en el lienzo (y en la vista en la web)
    $("ieSide").addEventListener("mouseover", (e) => { const r = e.target.closest("#ieLayers [data-sel]"); const id = r ? r.dataset.sel || null : null; if (id !== hovId) { hovId = id; overlay(); live(); } });
    $("ieSide").addEventListener("mouseleave", () => { if (hovId) { hovId = null; overlay(); live(); } });
    // Tamaño del lienzo arrastrando la esquina
    $("ieBoardH").addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation(); const h = $("ieBoardH"); h.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, w0 = D.w, h0 = D.h;
      const mv = (ev) => { let w = clamp(Math.round(w0 + (ev.clientX - sx) / zoom), 50, 4000), hh = clamp(Math.round(h0 + (ev.clientY - sy) / zoom), 50, 4000); if (ev.shiftKey) hh = clamp(Math.round(w * h0 / w0), 50, 4000); D.w = w; D.h = hh; setZoom(zoom); render(); $("ieSize").textContent = `${w} × ${hh}`; };
      const up = () => { h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); commit(); };
      h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up);
    });
    $("ieName").addEventListener("input", () => { design.name = $("ieName").value; later(); });
    $("ieStage").addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
    addEventListener("resize", () => { setZoom(zoom); if (liveOn) fitLive(); });
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
      if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); return doRedo(); }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); return save(false); }
      if (typing) return;
      if (e.key === "Enter" && tool === "poly") return finishPoly();
      if (e.key === "Escape") { poly = null; pen = null; drawBox = null; if (tool !== "select") setTool("select"); else select(null); return; }
      const L = cur();
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); return duplicate(); }
      if ((e.key === "Delete" || e.key === "Backspace") && L) { e.preventDefault(); return removeSel(); }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && L && !L.locked) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; L.x += arrows[e.key][0] * s; L.y += arrows[e.key][1] * s; render(); syncFields(); return later(); }
      const keys = { v: "select", h: "hand", t: "text", r: "rect", e: "ellipse", p: "pen", c: "poly", i: "image", z: "zone" };
      if (!mod && keys[e.key.toLowerCase()]) setTool(keys[e.key.toLowerCase()]);
    });
    addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  }

  boot();
})();
