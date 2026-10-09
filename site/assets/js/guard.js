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
})();
