// Barrera básica contra curiosos: bloquea los atajos de las herramientas de desarrollador y el clic
// derecho. No es seguridad real (el menú del navegador siempre permite abrirlas): la protección de
// verdad está en el servidor. Se carga primero en TODAS las páginas (tools/csp.py lo exige en el deploy).
(() => {
  window.addEventListener("keydown", (e) => {
    // e.code no cambia con Alt/Opción (en Mac Opción+C da "ç"), así que se compara por tecla física.
    const k = e.key === "F12" ? "f12" : (e.code || "").replace(/^Key/, "").toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const blocked =
      k === "f12" ||
      (mod && e.shiftKey && ["i", "j", "c", "k"].includes(k)) || // inspeccionar / consola (Windows y Linux)
      (e.metaKey && e.altKey && ["i", "j", "c", "u"].includes(k)) || // lo mismo en Mac
      (mod && !e.shiftKey && !e.altKey && ["u", "s"].includes(k)); // ver código fuente / guardar página
    if (blocked) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // Clic derecho bloqueado en toda la página, sin excepciones (copiar y pegar siguen con Ctrl+C / Ctrl+V).
  window.addEventListener("contextmenu", (e) => e.preventDefault(), true);
  window.addEventListener("dragstart", (e) => { if (e.target instanceof HTMLImageElement) e.preventDefault(); }, true);

  // Como no hay menú de clic derecho: al marcar texto aparece un botón "Copiar" en la punta donde
  // terminó la selección (abajo a la derecha si se marcó hacia adelante, arriba a la izquierda si fue hacia atrás).
  const ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
  let btn = null, text = "", timer = 0;
  function make() {
    btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Copiar lo seleccionado");
    Object.assign(btn.style, { position: "fixed", zIndex: "2147483000", display: "none", alignItems: "center", gap: "6px",
      padding: "6px 12px", border: "1px solid #ffffff2e", borderRadius: "999px", background: "#0d1117", color: "#fff",
      font: "700 13px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif", boxShadow: "0 6px 18px #0006", cursor: "pointer", userSelect: "none" });
    btn.addEventListener("pointerdown", (e) => e.preventDefault());   // que no se pierda la selección al tocarlo
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", copy);
    document.body.appendChild(btn);
  }
  const label = (t) => { btn.innerHTML = ICON + "<span>" + t + "</span>"; };
  function hide() { if (btn) btn.style.display = "none"; }
  async function copy() {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (e) { try { ok = document.execCommand("copy"); } catch (er) { /* sin portapapeles */ } }
    label(ok ? "¡Copiado!" : "No se pudo copiar");
    setTimeout(hide, 900);
  }
  function selectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|email|url|tel|number)$/i.test(el.type)))) {
      try { return { text: el.value.slice(el.selectionStart, el.selectionEnd), rect: el.getBoundingClientRect(), fwd: el.selectionDirection !== "backward", field: true }; } catch (e) { return null; }
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0), rects = [...range.getClientRects()].filter((r) => r.width || r.height);
    if (!rects.length) return null;
    // ¿Se marcó hacia adelante? (el foco quedó después del ancla)
    const pos = sel.anchorNode.compareDocumentPosition(sel.focusNode);
    const fwd = pos ? !(pos & Node.DOCUMENT_POSITION_PRECEDING) : sel.anchorOffset <= sel.focusOffset;
    return { text: sel.toString(), rect: fwd ? rects[rects.length - 1] : rects[0], fwd };
  }
  function show() {
    const s = selectedText();
    if (!s || !s.text.trim()) return hide();
    if (!btn) make();
    text = s.text; label("Copiar");
    btn.style.display = "inline-flex";
    const w = btn.offsetWidth, h = btn.offsetHeight, r = s.rect, m = 8;
    let x = s.fwd ? r.right - (s.field ? w : 0) : r.left - (s.field ? 0 : w);
    let y = s.fwd ? r.bottom + m : r.top - h - m;
    if (y + h > innerHeight - 4) y = r.top - h - m;     // sin lugar abajo: arriba
    if (y < 4) y = r.bottom + m;                         // sin lugar arriba: abajo
    btn.style.left = Math.max(6, Math.min(innerWidth - w - 6, x)) + "px";
    btn.style.top = Math.max(6, Math.min(innerHeight - h - 6, y)) + "px";
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(show, 180); };
  document.addEventListener("selectionchange", later);

  // Pegar: clic derecho (o mantener apretado en el celular) sobre un campo de texto muestra un botón "Pegar"
  const PASTE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>';
  let pbtn = null, field = null;
  const editable = (el) => el && !el.disabled && !el.readOnly && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|email|url|tel|number|password)$/i.test(el.type)) || el.isContentEditable);
  function hidePaste() { if (pbtn) pbtn.style.display = "none"; field = null; }
  function makePaste() {
    pbtn = document.createElement("button");
    pbtn.type = "button";
    pbtn.setAttribute("aria-label", "Pegar en el campo");
    Object.assign(pbtn.style, { position: "fixed", zIndex: "2147483000", display: "none", alignItems: "center", gap: "6px",
      padding: "6px 12px", border: "1px solid #ffffff2e", borderRadius: "999px", background: "#0d1117", color: "#fff",
      font: "700 13px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif", boxShadow: "0 6px 18px #0006", cursor: "pointer", userSelect: "none" });
    pbtn.addEventListener("pointerdown", (e) => e.preventDefault());   // que el campo no pierda el foco
    pbtn.addEventListener("mousedown", (e) => e.preventDefault());
    pbtn.addEventListener("click", paste);
    document.body.appendChild(pbtn);
  }
  const plabel = (t) => { pbtn.innerHTML = PASTE_ICON + "<span>" + t + "</span>"; };
  async function paste() {
    const el = field;
    let t = null;
    try { t = await navigator.clipboard.readText(); } catch (e) { /* el navegador no dejó leer el portapapeles */ }
    if (t == null || !el) { plabel("Usá Ctrl+V para pegar"); setTimeout(hidePaste, 1800); return; }
    el.focus();
    if (el.isContentEditable) document.execCommand("insertText", false, t);
    else {
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
      try { el.setRangeText(t, a, b, "end"); } catch (e) { el.value += t; }   // los type="number"/"email" no aceptan setRangeText
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    hidePaste();
  }
  window.addEventListener("contextmenu", (e) => {
    const el = e.target.closest ? e.target.closest("input, textarea, [contenteditable]") : null;
    if (!editable(el)) return hidePaste();
    if (!pbtn) makePaste();
    field = el; plabel("Pegar");
    pbtn.style.display = "inline-flex";
    const w = pbtn.offsetWidth, h = pbtn.offsetHeight;
    let x = e.clientX + 4, y = e.clientY + 6;
    if (!e.clientX && !e.clientY) { const r = el.getBoundingClientRect(); x = r.left; y = r.bottom + 6; }   // abierto con el teclado
    pbtn.style.left = Math.max(6, Math.min(innerWidth - w - 6, x)) + "px";
    pbtn.style.top = Math.max(6, Math.min(innerHeight - h - 6, y)) + "px";
  }, true);
  document.addEventListener("pointerdown", (e) => { if (pbtn && e.target !== pbtn && !pbtn.contains(e.target)) hidePaste(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hide(); hidePaste(); } });

  window.addEventListener("scroll", () => { hide(); hidePaste(); }, true);
  window.addEventListener("resize", () => { hide(); hidePaste(); });
})();
