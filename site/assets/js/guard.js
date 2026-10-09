// Barrera básica contra curiosos: bloquea los atajos de las herramientas de desarrollador y el clic
// derecho. No es seguridad real (el menú del navegador siempre permite abrirlas): la protección de
// verdad está en el servidor. No se carga en el panel.
(() => {
  document.addEventListener("keydown", (e) => {
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
  // Clic derecho bloqueado en toda la página, salvo en los campos de texto (para poder pegar).
  // Copiar sigue andando con Ctrl+C.
  const isField = (t) => t instanceof Element && t.closest("input, textarea, [contenteditable]");
  document.addEventListener("contextmenu", (e) => { if (!isField(e.target)) e.preventDefault(); }, true);
  document.addEventListener("dragstart", (e) => { if (e.target instanceof HTMLImageElement) e.preventDefault(); }, true);
})();
