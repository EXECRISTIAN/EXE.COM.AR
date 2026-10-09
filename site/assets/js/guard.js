// Barrera básica contra curiosos: bloquea los atajos de las herramientas de desarrollador y el clic
// derecho sobre las fotos. No es seguridad real (el navegador siempre permite ver el código por su
// menú): la protección de verdad está en el servidor. El clic derecho sobre textos y links sigue
// funcionando para que los clientes puedan copiar y abrir pestañas. No se carga en el panel.
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
  const isImg = (t) => t instanceof Element && t.closest("img, picture, .hero-slide, .brand-card");
  document.addEventListener("contextmenu", (e) => { if (isImg(e.target)) e.preventDefault(); }, true);
  document.addEventListener("dragstart", (e) => { if (e.target instanceof HTMLImageElement) e.preventDefault(); }, true);
})();
