// Ayudas de escritura del panel (gratis, sin inteligencia artificial):
//  · Listas que se despliegan al tocar un campo (marca, categoría, etiquetas, especificaciones, tiendas…)
//    con todo lo cargado antes, sin repetidos y filtrando mientras escribís. Lo nuevo se guarda solo.
//  · Mayúsculas automáticas (cada palabra en el nombre, inicio de oración en textos).
//  · "Sugerir correcciones": espacios, signos, unidades (16gb → 16 GB), tildes comunes y marcas bien escritas.
(() => {
  const A = window.EXE_ADMIN;
  const sb = () => A && A.be && A.be.sb;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

  /* ---------- Vocabulario: lo cargado en productos + lo guardado antes ---------- */
  const store = new Map();   // kind → Map(norm → { value, n })
  const add = (kind, value, n = 1, hidden = false) => {
    const v = String(value ?? "").replace(/\s+/g, " ").trim(); if (!v || v.length > 200) return;
    if (!store.has(kind)) store.set(kind, new Map());
    const m = store.get(kind), k = fold(v), cur = m.get(k);
    if (cur) { cur.n += n; if (hidden) cur.hidden = true; } else m.set(k, { value: v, n, hidden });
  };
  const LS_HIDE = "exe-vocab-hidden";
  const hiddenSet = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_HIDE) || "[]")); } catch { return new Set(); } };
  const LS = "exe-vocab";
  let loaded = false;
  async function load(seed) {
    seed && seed(add);
    if (loaded) return; loaded = true;
    try { (JSON.parse(localStorage.getItem(LS) || "[]")).forEach(([k, v]) => add(k, v, 0.5)); } catch { /* sin almacenamiento */ }
    hiddenSet().forEach((key) => { const [k, ...rest] = key.split("|"); add(k, rest.join("|"), 0, true); });
    if (A && !A.demo && sb()) {
      for (let i = 0; ; i += 1000) {
        const { data, error } = await sb().from("panel_vocab").select("kind, value, uses, hidden").range(i, i + 999);
        if (error || !data) break; data.forEach((r) => add(r.kind, r.value, r.uses || 1, !!r.hidden)); if (data.length < 1000) break;
      }
    }
  }
  // Guarda lo nuevo (en la base y en este navegador) para la próxima vez
  async function remember(pairs) {
    const fresh = pairs.map(([k, v]) => [k, String(v ?? "").replace(/\s+/g, " ").trim()]).filter(([k, v]) => k && v && v.length <= 200);
    if (!fresh.length) return;
    fresh.forEach(([k, v]) => { add(k, v); const e = store.get(k).get(fold(v)); if (e) e.hidden = false; });   // volver a usarla la vuelve a mostrar
    try { const h = hiddenSet(); fresh.forEach(([k, v]) => h.delete(k + "|" + v)); localStorage.setItem(LS_HIDE, JSON.stringify([...h])); } catch { /* sin almacenamiento */ }
    try { const old = JSON.parse(localStorage.getItem(LS) || "[]"); localStorage.setItem(LS, JSON.stringify([...old, ...fresh].slice(-3000))); } catch { /* sin almacenamiento */ }
    if (A && !A.demo && sb()) {
      const rows = [...new Map(fresh.map(([k, v]) => [k + "|" + fold(v), { kind: k.slice(0, 80), norm: fold(v), value: v, hidden: false }])).values()];
      await sb().from("panel_vocab").upsert(rows, { onConflict: "kind,norm" }).then(() => {}, () => {});
    }
  }
  // ✕ en la lista: oculta esa opción para siempre (en la base y en este navegador) hasta que se vuelva a usar
  async function forget(kind, value) {
    const e = (store.get(kind) || new Map()).get(fold(value)); if (e) e.hidden = true;
    try { const h = hiddenSet(); h.add(kind + "|" + value); localStorage.setItem(LS_HIDE, JSON.stringify([...h])); } catch { /* sin almacenamiento */ }
    if (A && !A.demo && sb()) await sb().from("panel_vocab").upsert({ kind: kind.slice(0, 80), norm: fold(value), value, hidden: true }, { onConflict: "kind,norm" }).then(() => {}, () => {});
  }
  const options = (kind) => [...(store.get(kind) || new Map()).values()].filter((o) => !o.hidden).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value, "es"));
  const canonical = (kind, v) => { const hit = (store.get(kind) || new Map()).get(fold(v)); return hit ? hit.value : null; };

  /* ---------- Lista desplegable con búsqueda ---------- */
  let pop = null, cur = null, idx = -1;
  const multi = (inp) => inp.dataset.suggestMulti === "1";
  const token = (inp) => (multi(inp) ? inp.value.slice(0, inp.selectionStart ?? inp.value.length).split(",").pop() : inp.value);
  function render(inp) {
    const kind = inp.dataset.suggest, q = fold(token(inp));
    const taken = multi(inp) ? new Set(inp.value.split(",").map(fold).filter(Boolean)) : new Set();
    let list = options(kind).filter((o) => !taken.has(fold(o.value)) || fold(o.value) === q);
    if (q) list = list.filter((o) => fold(o.value).includes(q)).sort((a, b) => (fold(b.value).startsWith(q) - fold(a.value).startsWith(q)) || b.n - a.n);
    list = list.slice(0, 40);
    if (!pop) { pop = document.createElement("div"); pop.className = "sg-pop"; pop.setAttribute("role", "listbox"); document.body.appendChild(pop);
      pop.addEventListener("mousedown", (e) => {
        const x = e.target.closest("[data-x]");
        if (x) { e.preventDefault(); if (cur) { forget(cur.dataset.suggest, x.dataset.x); render(cur); } return; }
        const b = e.target.closest("[data-v]"); if (b) { e.preventDefault(); pick(b.dataset.v); } }); }
    const exact = list.some((o) => fold(o.value) === q);
    pop.innerHTML = (list.length ? list.map((o, i) => `<div class="sg-opt"><button type="button" role="option" data-v="${esc(o.value)}" class="${i === idx ? "on" : ""}">${hl(o.value, q)}</button><button type="button" class="sg-x" data-x="${esc(o.value)}" title="Borrar esta opción de la lista" aria-label="Borrar ${esc(o.value)} de la lista">✕</button></div>`).join("")
      : "") + (q && !exact ? `<p class="sg-new">＋ “${esc(token(inp).trim())}” se guarda como nueva opción</p>` : "") + (!list.length && !q ? `<p class="sg-new">Todavía no hay opciones guardadas: escribí una y queda para la próxima.</p>` : "");
    const r = inp.getBoundingClientRect();
    Object.assign(pop.style, { left: Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 220) - 8)) + "px", top: r.bottom + 4 + "px", width: Math.max(r.width, 220) + "px" });
    pop.hidden = false;
  }
  const hl = (v, q) => { if (!q) return esc(v); const i = fold(v).indexOf(q); return i < 0 ? esc(v) : esc(v.slice(0, i)) + "<mark>" + esc(v.slice(i, i + q.length)) + "</mark>" + esc(v.slice(i + q.length)); };
  function pick(v) {
    if (!cur) return;
    if (multi(cur)) { const parts = cur.value.split(","); parts[parts.length - 1] = " " + v; cur.value = parts.map((s) => s.trim()).filter(Boolean).join(", ") + ", "; }
    else cur.value = v;
    cur.dispatchEvent(new Event("input", { bubbles: true })); cur.dispatchEvent(new Event("change", { bubbles: true }));
    if (multi(cur)) render(cur); else close();
  }
  const close = () => { if (pop) pop.hidden = true; idx = -1; };
  function attach(root) {
    root.addEventListener("focusin", (e) => { const t = e.target.closest("[data-suggest]"); if (!t || t.readOnly || t.disabled) return; cur = t; idx = -1; render(t); });
    root.addEventListener("input", (e) => { if (e.target === cur) { idx = -1; render(cur); } });
    root.addEventListener("focusout", (e) => { if (e.target === cur) setTimeout(close, 120); });
    root.addEventListener("keydown", (e) => {
      if (e.target !== cur || !pop || pop.hidden) return;
      const items = [...pop.querySelectorAll("[data-v]")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length); items.forEach((b, i) => b.classList.toggle("on", i === idx)); items[idx]?.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter" && idx >= 0 && items[idx]) { e.preventDefault(); pick(items[idx].dataset.v); }
      else if (e.key === "Escape") close();
    });
    addEventListener("scroll", () => { if (cur && pop && !pop.hidden) render(cur); }, { passive: true });
  }

  /* ---------- Mayúsculas y correcciones ---------- */
  const UNITS = { gb: "GB", tb: "TB", mb: "MB", kb: "KB", mhz: "MHz", ghz: "GHz", hz: "Hz", w: "W", mm: "mm", cm: "cm", v: "V", rpm: "RPM", ms: "ms" };
  const UPPER = new Set(["rgb", "argb", "ssd", "hdd", "usb", "hdmi", "led", "lcd", "ips", "va", "tn", "oled", "atx", "itx", "eatx", "pc", "cpu", "gpu", "ram", "ddr", "ddr3", "ddr4", "ddr5", "gddr6", "gddr6x", "pcie", "sata", "m.2", "wifi", "ps2", "ps5", "rtx", "gtx", "rx", "amd", "msi", "asus", "evga", "nzxt", "pny", "xpg", "uhd", "fhd", "qhd", "hd", "4k", "ups", "lga", "am4", "am5", "tdp", "psu", "aio", "dp"]);
  const MIXED = { nvme: "NVMe", geforce: "GeForce", radeon: "Radeon", wifi6: "WiFi 6", bluetooth: "Bluetooth", iphone: "iPhone", playstation: "PlayStation", gigabyte: "Gigabyte", aorus: "AORUS", corsair: "Corsair", kingston: "Kingston", intel: "Intel", nvidia: "NVIDIA", "wi-fi": "Wi-Fi" };
  const SMALL = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "con", "para", "en", "a", "al", "por", "sin", "x"]);
  // Palabras comunes sin tilde → con tilde (catálogo de tecnología)
  const ACCENTS = { tecnologia: "tecnología", garantia: "garantía", rapido: "rápido", rapida: "rápida", rapidos: "rápidos", rapidas: "rápidas", graficos: "gráficos", grafica: "gráfica", grafico: "gráfico",
    nucleos: "núcleos", nucleo: "núcleo", maximo: "máximo", maxima: "máxima", minimo: "mínimo", minima: "mínima", optimo: "óptimo", optima: "óptima", energia: "energía", bateria: "batería", baterias: "baterías",
    energetica: "energética", tamano: "tamaño", diseno: "diseño", camara: "cámara", camaras: "cámaras", fisico: "físico", fisica: "física", electrico: "eléctrico", electrica: "eléctrica", electronico: "electrónico",
    electronica: "electrónica", termico: "térmico", termica: "térmica", ergonomico: "ergonómico", ergonomica: "ergonómica", magnetico: "magnético", optico: "óptico", optica: "óptica", tactil: "táctil",
    numero: "número", numeros: "números", ultimo: "último", ultima: "última", unico: "único", unica: "única", util: "útil", facil: "fácil", dificil: "difícil", rendimiento: "rendimiento", ademas: "además",
    tambien: "también", despues: "después", segun: "según", mas: "más", aca: "acá", alli: "allí", asi: "así", tipico: "típico", practico: "práctico", practica: "práctica", automatico: "automático",
    automatica: "automática", basico: "básico", basica: "básica", clasico: "clásico", clasica: "clásica", estetico: "estético", estetica: "estética", conexion: "conexión", conexiones: "conexiones",
    version: "versión", resolucion: "resolución", tension: "tensión", funcion: "función", funciones: "funciones", informacion: "información", instalacion: "instalación", configuracion: "configuración",
    refrigeracion: "refrigeración", ventilacion: "ventilación", iluminacion: "iluminación", proteccion: "protección", conexión: "conexión", compatible: "compatible", frecuencia: "frecuencia",
    memorias: "memorias", envio: "envío", envios: "envíos", codigo: "código", pagina: "página", catalogo: "catálogo", telefono: "teléfono", sistema: "sistema", grafico3d: "gráfico 3D", audifonos: "audífonos",
    teclado: "teclado", microfono: "micrófono", microfonos: "micrófonos", portatil: "portátil", portatiles: "portátiles", movil: "móvil", moviles: "móviles", dia: "día", dias: "días", ano: "año", anos: "años" };
  const keepCase = (w) => /\d/.test(w) && /[a-z]/i.test(w) ? null : /[a-z][A-Z]/.test(w) ? w : null;
  const unitFix = (s) => s.replace(/\b(\d+(?:[.,]\d+)?)\s?(gb|tb|mb|kb|mhz|ghz|hz|w|rpm)\b/gi, (_, n, u) => `${n} ${UNITS[u.toLowerCase()]}`);
  const accentFix = (s) => s.replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (w) => { const r = ACCENTS[w.toLowerCase()]; if (!r || r === w.toLowerCase()) return w; return w[0] === w[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r; });
  const spacing = (s) => s.replace(/[ \t]+/g, " ").replace(/ +([,.;:!?)])/g, "$1").replace(/([,;:])(?=[^\s\d])/g, "$1 ").replace(/\(\s+/g, "(").replace(/\b(\w+) \1\b/gi, "$1").trim();
  const brandFix = (s) => { const brands = options("brand").map((o) => o.value).filter((b) => b.length > 2); return brands.length ? s.replace(new RegExp(`\\b(${brands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi"), (m) => brands.find((b) => b.toLowerCase() === m.toLowerCase()) || m) : s; };
  // Nombre: cada palabra con mayúscula (respeta modelos, siglas y marcas)
  function titleCase(s) {
    return unitFix(spacing(s)).split(" ").map((w, i) => {
      const lw = w.toLowerCase(), bare = lw.replace(/[^a-z0-9.\-]/g, "");
      if (MIXED[bare]) return w.replace(new RegExp(bare.replace(/[.\-]/g, "\\$&"), "i"), MIXED[bare]);
      if (UPPER.has(bare)) return w.toUpperCase();
      if (Object.values(UNITS).includes(w)) return w;
      if (/^i[3579]$/i.test(bare)) return w.replace(/I/, "i");   // i3 / i5 / i7 / i9
      const k = keepCase(w); if (k) return /^[a-z]/.test(w) && !/[A-Z]/.test(w) ? w.toUpperCase() : w;
      if (i > 0 && SMALL.has(lw)) return lw;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  // Textos: mayúscula al empezar cada oración
  const sentenceCase = (s) => s.replace(/(^\s*|[.!?¡¿]\s+|\n\s*)([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase());
  const firstUpper = (s) => s.replace(/^\s*([a-záéíóúñ])/, (m, c) => m.replace(c, c.toUpperCase()));

  // Lista de correcciones propuestas para un texto
  function suggest(kind, text) {
    const t = String(text || "");
    const steps = kind === "name"
      ? [["Espacios y signos", spacing], ["Unidades (16gb → 16 GB)", unitFix], ["Tildes", accentFix], ["Marcas bien escritas", brandFix], ["Mayúscula en cada palabra", titleCase]]
      : [["Espacios y signos", (s) => s.split("\n").map(spacing).join("\n")], ["Unidades (16gb → 16 GB)", unitFix], ["Tildes", accentFix], ["Marcas bien escritas", brandFix], ["Mayúscula al empezar cada oración", sentenceCase]];
    const out = []; let acc = t;
    for (const [label, fn] of steps) { const next = fn(acc); if (next !== acc) out.push({ label, before: acc, after: next }); acc = next; }
    return { out, final: acc };
  }

  window.EXE_SUGGEST = { load, remember, forget, attach, close, canonical, titleCase, sentenceCase, firstUpper, suggest, fold };
})();
