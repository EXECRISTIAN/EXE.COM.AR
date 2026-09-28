/* Selector de tema mini de Mi cuenta (interruptor de 3 posiciones).
   Usa la misma preferencia (localStorage "exe-theme") que el selector del pie de la tienda. */
(function () {
  const sw = document.getElementById("themeMini");
  if (!sw) return;
  const MODES = ["light", "auto", "dark"];
  const root = document.documentElement;

  function apply(mode, save) {
    if (mode === "auto") delete root.dataset.theme; else root.dataset.theme = mode;
    if (save) { try { mode === "auto" ? localStorage.removeItem("exe-theme") : localStorage.setItem("exe-theme", mode); } catch (e) {} }
    sw.dataset.mode = mode;
    sw.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1;
    });
  }
  let stored = null;
  try { stored = localStorage.getItem("exe-theme"); } catch (e) {}
  apply(MODES.includes(stored) ? stored : "auto", false);

  sw.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) apply(b.dataset.mode, true); });
  sw.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = MODES[Math.min(2, Math.max(0, MODES.indexOf(sw.dataset.mode) + step))];
    apply(next, true); sw.querySelector(`[data-mode="${next}"]`).focus();
  });

  // Explicación solo si el mouse queda encima más de 5 segundos
  let timer = null;
  sw.addEventListener("mouseenter", () => { timer = setTimeout(() => sw.classList.add("show-tip"), 5000); });
  sw.addEventListener("mouseleave", () => { clearTimeout(timer); sw.classList.remove("show-tip"); });
})();
