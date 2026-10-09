// Editor visual de la página de inicio (panel → Página web → Editor visual).
// A la derecha, la web real en un iframe (?cms-edit=1); a la izquierda, los controles. Los cambios se ven al instante
// sobre un borrador y recién llegan a la web al tocar "Publicar" (tabla site_blocks; RLS exige site.edit).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const be = window.EXE_BACKEND;
  const demo = /[?&]demo=1/.test(location.search);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // Firma para saber si una sección cambió (un estilo vacío cuenta como "sin cambios")
  const sig = (b) => { const d = { ...b.data }; if (d.style && !Object.keys(d.style).length) delete d.style; return JSON.stringify({ d, a: b.active }); };
  const NAMES = { hero: "Carrusel principal", tarjetas: "Tarjetas", catalogo: "Catálogo de productos", banner: "Banner ancho", beneficios: "Beneficios", logos: "Logos de marcas",
    contacto: "Contacto", texto: "Texto con botón", imagen: "Imagen", imagen_texto: "Imagen + texto", espaciador: "Espacio / separador", aviso: "Barra de aviso" };

  let blocks = [], saved = {}, sel = null, layer = "sec", device = 1280, win = null, doc = null;
  const undo = [], redo = [];

  /* ---------- Acceso ---------- */
  async function boot() {
    if (demo) {
      blocks = ["hero", "tarjetas", "catalogo", "banner-ancho", "beneficios", "logos", "contacto"].map((id, i) => ({
        id, type: { "banner-ancho": "banner" }[id] || id, title: NAMES[{ "banner-ancho": "banner" }[id] || id], position: i, active: id !== "banner-ancho", data: {} }));
      blocks.splice(6, 0, { id: "espacio-demo", type: "espaciador", title: "Espacio / separador", position: 5.5, active: true, data: { height: 60, height_mobile: 32 } });
      blocks.forEach((b, i) => (b.position = i));
      return start();
    }
    if (!be) return ($("veGateMsg").textContent = "El backend no está configurado.");
    const user = await be.user();
    if (!user) return ($("veGateMsg").innerHTML = 'Tenés que <a href="../cuenta.html">iniciar sesión</a>.');
    const perms = await be.permissions().catch(() => new Set());
    if (!perms.has("site.edit")) return ($("veGateMsg").textContent = "Tu usuario no tiene permiso para editar la página.");
    if (window.EXE_MFA && !(await window.EXE_MFA.staffGate($("veGateMsg")))) return ($("veGateMsg").innerHTML = 'Para editar hace falta la verificación en dos pasos. <a href="">Reintentar</a>');
    const r = await be.sb.from("site_blocks").select("*").eq("page", "inicio").order("position");
    if (r.error) return ($("veGateMsg").textContent = "No se pudieron cargar las secciones: " + r.error.message);
    blocks = r.data;
    start();
  }
  function start() {
    blocks.forEach((b) => { b.data = b.data || {}; saved[b.id] = sig(b); });
    $("veGate").hidden = true; $("ve").hidden = false;
    sel = blocks[0] && blocks[0].id;
    renderSide(); bindTop(); fit();
    $("veFrame").addEventListener("load", onFrame);
    if ($("veFrame").contentDocument && $("veFrame").contentDocument.readyState === "complete") onFrame();
  }

  /* ---------- Vista previa ---------- */
  function onFrame() {
    win = $("veFrame").contentWindow; doc = $("veFrame").contentDocument;
    (function wait(n = 0) {
      if (win.EXE_CMS) { win.EXE_CMS.draft = true; injectOverlay(); applyDraft(); renderSide(); return; }
      if (n < 100) setTimeout(() => wait(n + 1), 50);
    })();
  }
  function applyDraft() {
    if (!win || !win.EXE_CMS) return;
    try { win.EXE_CMS.applySite(clone(blocks)); } catch (e) { console.warn(e); }
    doc.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));   // sin animación de entrada en el editor
    draw();
  }
  function fit() {
    const wrap = $("veWrap"), fr = $("veFrame"), avail = $("veStage").clientWidth - 32, h = $("veStage").clientHeight - 32;
    const k = Math.min(1, avail / device);
    fr.style.width = device + "px"; fr.style.height = Math.round(h / k) + "px";
    fr.style.transform = `scale(${k})`;
    wrap.style.width = Math.round(device * k) + "px"; wrap.style.height = h + "px";
    setTimeout(() => { const el = sel && elOf(sel); if (el) el.scrollIntoView({ block: "center" }); draw(); }, 120);
  }
  window.addEventListener("resize", fit);

  /* ---------- Capas y bordes dentro de la vista previa ---------- */
  function injectOverlay() {
    if (doc.getElementById("__ve")) return;
    const st = doc.createElement("style");
    st.textContent = `#__ve{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none;font:600 11px/1.2 Lato,system-ui,sans-serif}
      #__ve .b{position:absolute;box-sizing:border-box;border:2px dashed}
      #__ve .sec{border-color:#f59e0b}#__ve .cont{border-color:#22c55e}#__ve .vcard{border:2px solid #0084d6}#__ve .sp{border-color:#a855f7;background:repeating-linear-gradient(45deg,#a855f733 0 6px,transparent 6px 12px)}
      #__ve .act{border-width:3px}
      #__ve .pad{position:absolute;background:repeating-linear-gradient(45deg,#f59e0b2e 0 6px,transparent 6px 12px)}
      #__ve .pad i{position:absolute;right:8px;top:50%;transform:translateY(-50%);color:#b45309;background:#fff9;padding:1px 4px;border-radius:3px;font-style:normal}
      #__ve .vtag{font-size:11px;z-index:auto;position:absolute;padding:2px 6px;border-radius:4px;color:#fff;white-space:nowrap}
      #__ve .hover{position:absolute;box-sizing:border-box;border:1px solid #0084d6aa}
      #__ve .h{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;background:#fff;border:2px solid #0084d6;border-radius:3px;pointer-events:auto;touch-action:none}
      #__ve .h.x{cursor:ew-resize}#__ve .h.y{cursor:ns-resize}
      html.__ve-off #__ve .b, html.__ve-off #__ve .pad{display:none}
      [data-block]{cursor:pointer}
      .reveal{opacity:1!important;transform:none!important;transition:none!important}
      .reveal *{transition:none!important;animation:none!important}`;
    doc.head.appendChild(st);
    const ov = doc.createElement("div"); ov.id = "__ve"; doc.body.appendChild(ov);
    doc.addEventListener("click", (e) => {
      if (e.target.closest("#__ve")) return;
      const el = e.target.closest("[data-block]");
      e.preventDefault(); e.stopPropagation();          // en el editor los links no navegan
      if (el) { select(el.dataset.block); }
    }, true);
    doc.addEventListener("mousemove", (e) => {
      const el = e.target.closest && e.target.closest("[data-block]");
      const hv = ov.querySelector(".hover");
      if (!el || el.dataset.block === sel) { if (hv) hv.remove(); return; }
      const r = rect(el); const d = hv || Object.assign(doc.createElement("div"), { className: "hover" });
      Object.assign(d.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
      if (!hv) ov.appendChild(d);
    });
    win.addEventListener("scroll", () => {}, { passive: true });
    win.addEventListener("resize", draw);
    new win.ResizeObserver(() => draw()).observe(doc.body);
  }
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height }; };
  const cur = () => blocks.find((b) => b.id === sel);
  const elOf = (id) => doc && doc.querySelector(`[data-block="${CSS.escape(id)}"]`);
  const layersOf = (el) => (win.EXE_CMS.cmsLayers ? win.EXE_CMS.cmsLayers(el) : { sec: el, cont: null, card: null });

  function draw() {
    if (!doc || !doc.getElementById("__ve")) return;
    const ov = doc.getElementById("__ve"); ov.innerHTML = "";
    const b = cur(); const el = b && elOf(b.id);
    if (!el || el.hidden) return;
    const L = layersOf(el);
    const box = (node, cls, label, color) => {
      if (!node) return null;
      const r = rect(node), d = doc.createElement("div");
      d.className = `b ${cls}${layer === cls || (cls === "sp") ? " act" : ""}`;
      Object.assign(d.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" }); ov.appendChild(d);
      if (label) { const t = doc.createElement("span"); t.className = "vtag"; t.style.background = color;
        t.textContent = `${label} · ${Math.round(r.w)} × ${Math.round(r.h)}`; Object.assign(t.style, { left: r.x + 4 + "px", top: Math.max(0, r.y - 18) + "px" }); ov.appendChild(t); }
      return r;
    };
    if (b.type === "espaciador") {
      const r = box(el, "sp", "Espacio", "#a855f7");
      handle(r.x + r.w / 2, r.y + r.h, "y", "sp");
      return;
    }
    const rs = box(L.sec, "sec", layer === "sec" ? "Sección" : "", "#f59e0b");
    // espacio interno arriba/abajo de la sección, rayado con su medida
    const cs = win.getComputedStyle(L.sec), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
    [[rs.y, pt], [rs.y + rs.h - pb, pb]].forEach(([y, h]) => { if (h < 1) return; const p = doc.createElement("div"); p.className = "pad";
      Object.assign(p.style, { left: rs.x + "px", top: y + "px", width: rs.w + "px", height: h + "px" }); p.innerHTML = `<i>${Math.round(h)} px</i>`; ov.appendChild(p); });
    const rc = box(L.cont, "cont", layer === "cont" ? "Contenedor" : "", "#16a34a");
    const rk = box(L.card, "vcard", layer === "card" ? "Tarjeta" : "", "#0084d6");
    if (layer === "sec") handle(rs.x + rs.w / 2, rs.y + rs.h, "y", "sec");
    if (layer === "cont" && rc) handle(rc.x + rc.w, rc.y + rc.h / 2, "x", "cont");
    if (layer === "card" && rk) { handle(rk.x + rk.w, rk.y + rk.h / 2, "x", "card-w"); handle(rk.x + rk.w / 2, rk.y + rk.h, "y", "card-h"); }
  }

  /* ---------- Arrastrar bordes para cambiar tamaños ---------- */
  function handle(x, y, axis, what) {
    const h = doc.createElement("div"); h.className = `h ${axis}`; h.title = "Arrastrá para cambiar el tamaño";
    Object.assign(h.style, { left: x + "px", top: y + "px" }); doc.getElementById("__ve").appendChild(h);
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId);
      const b = cur(), el = elOf(b.id), L = layersOf(el), st = style(b);
      const x0 = e.clientX, y0 = e.clientY;
      const start = { sec: L.sec.offsetHeight, cont: L.cont ? L.cont.offsetWidth : 0, cardW: L.card ? L.card.offsetWidth : 0, cardH: L.card ? L.card.offsetHeight : 0,
        contW: L.cont ? L.cont.clientWidth : 1, sp: el.offsetHeight };
      snapshot();
      const move = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (what === "sec") st.sec_h = Math.max(0, Math.round(start.sec + dy));
        if (what === "cont") st.cont_w = Math.max(200, Math.round(start.cont + dx * 2));
        if (what === "card-w") st.card_w = Math.max(10, Math.min(100, Math.round(((start.cardW + dx * 2) / start.contW) * 100)));
        if (what === "card-h") st.card_h = Math.max(0, Math.round(start.cardH + dy));
        if (what === "sp") { const k = device <= 500 ? "height_mobile" : "height"; b.data[k] = Math.max(0, Math.min(400, Math.round(start.sp + dy))); }
        applyDraft(); changed(false);
      };
      const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); renderSide(); changed(); };
      h.addEventListener("pointermove", move); h.addEventListener("pointerup", up);
    });
  }

  /* ---------- Historial (deshacer / rehacer) ---------- */
  function snapshot() { undo.push(JSON.stringify(blocks)); if (undo.length > 100) undo.shift(); redo.length = 0; }
  function restore(from, to) { if (!from.length) return; to.push(JSON.stringify(blocks)); blocks = JSON.parse(from.pop()); applyDraft(); renderSide(); changed(); }
  function changed(full = true) {
    const dirty = blocks.filter((b) => saved[b.id] !== sig(b));
    $("vePublish").disabled = !dirty.length;
    $("veState").textContent = dirty.length ? `${dirty.length} ${dirty.length > 1 ? "secciones" : "sección"} con cambios sin publicar` : "Todo publicado";
    $("veUndo").disabled = !undo.length; $("veRedo").disabled = !redo.length;
    if (full) draw();
  }

  /* ---------- Panel izquierdo ---------- */
  const style = (b) => (b.data.style = b.data.style || {});
  function field(label, key, obj, min, max, unit, hint) {
    const v = obj[key]; const has = v != null && v !== "";
    return `<div class="vf" data-k="${key}"><label>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</label>
      <input type="range" min="${min}" max="${max}" value="${has ? v : min}" ${has ? "" : 'class="unset"'} aria-label="${esc(label)}">
      <span class="vf-num"><input type="number" min="${min}" max="${max}" value="${has ? v : ""}" placeholder="auto">${unit}</span>
      <button type="button" class="vf-reset" title="Volver al valor de la web" ${has ? "" : "disabled"}>↺</button></div>`;
  }
  const PRESETS = { suave: { x: 0, y: 10, blur: 30, spread: -8, color: "#000000", a: 35 }, fuerte: { x: 0, y: 24, blur: 60, spread: 0, color: "#000000", a: 70 },
    brillo: { x: 0, y: 0, blur: 40, spread: 2, color: "#0084d6", a: 55 }, borde: { x: 0, y: 0, blur: 0, spread: 1, color: "#ffffff", a: 12 } };
  function renderSide() {
    const b = cur();
    const L = b && elOf(b.id) ? layersOf(elOf(b.id)) : {};
    const st = b ? b.data.style || {} : {};
    const layerBtn = (k, n, ok) => `<button type="button" data-layer="${k}" aria-checked="${layer === k}" ${ok ? "" : "disabled title=\"Esta sección no tiene esa capa\""}>${n}</button>`;
    if (b && layer !== "sec" && !L[layer]) layer = "sec";
    $("veSide").innerHTML = `
      <h4>Secciones de la página</h4>
      <ol class="ve-list">${blocks.map((x) => `<li><button type="button" data-sel="${esc(x.id)}" class="${x.id === sel ? "on" : ""} ${x.active ? "" : "off"}">
        ${x.type === "espaciador" ? "⇕ " : ""}${esc(x.title || NAMES[x.type] || x.id)}${x.type === "espaciador" ? ` <small>${x.data.height ?? 40} px</small>` : ""}${x.active ? "" : " <small>(oculta)</small>"}</button></li>`).join("")}</ol>
      ${!b ? "" : `
      <h4>${esc(b.title || NAMES[b.type])}</h4>
      <label class="vt"><input type="checkbox" id="veActive" ${b.active ? "checked" : ""}> Mostrar en la página</label>
      ${b.type === "espaciador" ? `
        ${field("Alto en PC", "height", b.data, 0, 400, "px")}
        ${field("Alto en celular", "height_mobile", b.data, 0, 400, "px")}
        <p class="ve-hint">También podés arrastrar el borde de abajo en la vista previa (en 📱 cambia el alto de celular).</p>` : `
      <h4>Capa a editar</h4>
      <div class="ve-seg ve-layers">${layerBtn("sec", "Sección", true)}${layerBtn("cont", "Contenedor", !!L.cont)}${layerBtn("card", "Tarjeta", !!L.card)}</div>
      <div data-obj="style">
      ${layer === "sec" ? `
        ${field("Alto mínimo", "sec_h", st, 0, 1200, "px")}
        ${field("Espacio interno arriba", "pt", st, 0, 240, "px")}
        ${field("Espacio interno abajo", "pb", st, 0, 240, "px")}
        ${field("Separación arriba", "sec_mt", st, -200, 300, "px", "negativo = se monta sobre la de arriba")}
        ${field("Separación abajo", "sec_mb", st, -200, 300, "px")}
        ${field("Esquinas redondeadas", "radius", st, 0, 60, "px")}` : ""}
      ${layer === "cont" ? `
        ${field("Ancho máximo del contenido", "cont_w", st, 200, 2400, "px")}
        <p class="ve-hint">También podés arrastrar el borde derecho del contenedor.</p>` : ""}
      ${layer === "card" ? `
        ${field("Ancho", "card_w", st, 10, 100, "%")}
        ${field("Alto mínimo", "card_h", st, 0, 1200, "px")}
        ${field("Relleno arriba/abajo", "card_py", st, 0, 200, "px")}
        ${field("Relleno a los costados", "card_px", st, 0, 200, "px")}
        ${field("Esquinas redondeadas", "card_r", st, 0, 120, "px")}
        <p class="ve-hint">Arrastrá el borde derecho (ancho) o el de abajo (alto) de la tarjeta.</p>` : ""}
      </div>`}
      <h4>Sombras (capas de efectos)</h4>
      <div class="ve-shadows">${(st.shadows || []).map((s, i) => shadowRow(s, i, L)).join("") || '<p class="ve-hint">Sin sombras propias: se usan las de la web.</p>'}</div>
      <div class="ve-presets"><span>Agregar:</span>${Object.keys(PRESETS).map((k) => `<button type="button" data-preset="${k}">${{ suave: "Suave", fuerte: "Fuerte", brillo: "Brillo azul", borde: "Borde fino" }[k]}</button>`).join("")}</div>
      <label class="vt"><input type="checkbox" id="veOver" ${st.over ? "checked" : ""}> Los efectos sobresalen por encima de las secciones vecinas</label>
      `}`;
    bindSide();
  }
  function shadowRow(s, i, L) {
    const opt = (k, n) => `<option value="${k}" ${s.layer === k ? "selected" : ""} ${k !== "sec" && !L[k] ? "disabled" : ""}>${n}</option>`;
    const r = (k, n, a, z) => `<label class="vs-r"><span>${n}</span><input type="range" min="${a}" max="${z}" value="${s[k] ?? 0}" data-sh="${i}" data-shk="${k}"><output>${s[k] ?? 0}</output></label>`;
    return `<div class="vs ${s.on === false ? "is-off" : ""}">
      <div class="vs-head"><label class="sw"><input type="checkbox" data-sh="${i}" data-shk="on" ${s.on === false ? "" : "checked"}><span></span></label>
        <select data-sh="${i}" data-shk="layer" aria-label="Capa">${opt("sec", "Sección")}${opt("cont", "Contenedor")}${opt("card", "Tarjeta")}</select>
        <input type="color" value="${s.color || "#000000"}" data-sh="${i}" data-shk="color" aria-label="Color">
        <button type="button" class="vs-up" data-shmv="${i}" title="Subir capa">▲</button>
        <button type="button" class="vs-del" data-shdel="${i}" title="Quitar">✕</button></div>
      ${r("x", "Horizontal", -100, 100)}${r("y", "Vertical", -100, 100)}${r("blur", "Difuminado", 0, 200)}${r("spread", "Tamaño", -50, 100)}${r("a", "Opacidad %", 0, 100)}
      <label class="vt small"><input type="checkbox" data-sh="${i}" data-shk="inset" ${s.inset ? "checked" : ""}> Hacia adentro</label>
    </div>`;
  }
  function bindSide() {
    const side = $("veSide"), b = cur();
    side.querySelectorAll("[data-sel]").forEach((x) => (x.onclick = () => select(x.dataset.sel)));
    side.querySelectorAll("[data-layer]").forEach((x) => (x.onclick = () => { layer = x.dataset.layer; renderSide(); draw(); }));
    if (!b) return;
    const obj = () => (b.type === "espaciador" ? b.data : style(b));
    side.querySelectorAll(".vf").forEach((f) => {
      const k = f.dataset.k, rg = f.querySelector("[type=range]"), nm = f.querySelector("[type=number]");
      let snap = false;
      const setv = (v, live) => { if (!snap) { snapshot(); snap = true; } obj()[k] = v === "" ? undefined : Number(v); if (v === "") delete obj()[k];
        if (live) nm.value = v; else rg.value = v; rg.classList.toggle("unset", v === ""); f.querySelector(".vf-reset").disabled = v === ""; applyDraft(); changed(); };
      rg.oninput = () => setv(rg.value, true); rg.onchange = () => { snap = false; };
      nm.onchange = () => { const v = nm.value === "" ? "" : Math.max(+nm.min, Math.min(+nm.max, +nm.value)); snap = false; setv(v, false); snap = false; };
      f.querySelector(".vf-reset").onclick = () => { snap = false; setv("", false); renderSide(); };
    });
    const act = $("veActive"); if (act) act.onchange = () => { snapshot(); b.active = act.checked; applyDraft(); renderSide(); changed(); };
    const over = $("veOver"); if (over) over.onchange = () => { snapshot(); if (over.checked) style(b).over = true; else delete style(b).over; applyDraft(); changed(); };
    side.querySelectorAll("[data-preset]").forEach((x) => (x.onclick = () => {
      snapshot(); const st = style(b); st.shadows = st.shadows || [];
      if (st.shadows.length >= 8) return alert("Máximo 8 sombras por sección.");
      st.shadows.push({ on: true, layer: layersOf(elOf(b.id)).card ? "card" : "sec", inset: false, ...PRESETS[x.dataset.preset] });
      applyDraft(); renderSide(); changed();
    }));
    side.querySelectorAll("[data-sh]").forEach((x) => {
      let snap = false;
      const ev = x.type === "range" || x.type === "color" ? "input" : "change";
      x.addEventListener(ev, () => {
        if (!snap) { snapshot(); snap = true; }
        const s = style(b).shadows[+x.dataset.sh], k = x.dataset.shk;
        s[k] = x.type === "checkbox" ? x.checked : x.type === "range" ? Number(x.value) : x.value;
        if (x.nextElementSibling && x.nextElementSibling.tagName === "OUTPUT") x.nextElementSibling.textContent = x.value;
        if (k === "on") x.closest(".vs").classList.toggle("is-off", !x.checked);
        applyDraft(); changed();
      });
      x.addEventListener("change", () => { snap = false; });
    });
    side.querySelectorAll("[data-shdel]").forEach((x) => (x.onclick = () => { snapshot(); style(b).shadows.splice(+x.dataset.shdel, 1); applyDraft(); renderSide(); changed(); }));
    side.querySelectorAll("[data-shmv]").forEach((x) => (x.onclick = () => { const i = +x.dataset.shmv; if (!i) return; snapshot(); const a = style(b).shadows; [a[i - 1], a[i]] = [a[i], a[i - 1]]; applyDraft(); renderSide(); changed(); }));
  }
  function select(id) {
    sel = id; layer = "sec"; renderSide(); draw();
    const el = elOf(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(draw, 450);
  }

  /* ---------- Barra superior ---------- */
  function bindTop() {
    $("veDevice").addEventListener("click", (e) => { const x = e.target.closest("[data-w]"); if (!x) return;
      device = +x.dataset.w; $("veDevice").querySelectorAll("button").forEach((y) => y.setAttribute("aria-checked", String(y === x))); fit(); });
    $("veTheme").onclick = () => { if (!doc) return; const r = doc.documentElement; r.dataset.theme = r.dataset.theme === "dark" ? "light" : "dark"; setTimeout(draw, 50); };
    $("veOutline").onclick = () => { const on = $("veOutline").getAttribute("aria-pressed") !== "true"; $("veOutline").setAttribute("aria-pressed", String(on)); doc && doc.documentElement.classList.toggle("__ve-off", !on); };
    $("veUndo").onclick = () => restore(undo, redo);
    $("veRedo").onclick = () => restore(redo, undo);
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.target.matches("input[type=number], input[type=text]")) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); restore(undo, redo); }
      if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); restore(redo, undo); }
    });
    $("vePublish").onclick = publish;
    window.addEventListener("beforeunload", (e) => { if (!$("vePublish").disabled) { e.preventDefault(); e.returnValue = ""; } });
    changed();
  }
  async function publish() {
    const dirty = blocks.filter((b) => saved[b.id] !== sig(b));
    if (!dirty.length) return;
    $("vePublish").disabled = true; $("veState").textContent = "Publicando…";
    try {
      for (const b of dirty) {
        if (!demo) {
          const r = await be.sb.from("site_blocks").update({ data: b.data, active: b.active, updated_at: new Date().toISOString() }).eq("id", b.id);
          if (r.error) throw r.error;
        }
        saved[b.id] = sig(b);
      }
      changed(); $("veState").textContent = demo ? "Modo demo: no se guardó en la base" : "¡Publicado! Ya se ve en la web.";
    } catch (e) { $("vePublish").disabled = false; $("veState").textContent = "No se pudo publicar: " + e.message; }
  }

  boot();
})();
