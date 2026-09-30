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

  sw.addEventListener("click", (e) => { const b = e.target.closest("button[data-mode]"); if (b) apply(b.dataset.mode, true); });
  sw.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = MODES[Math.min(2, Math.max(0, MODES.indexOf(sw.dataset.mode) + step))];
    apply(next, true); sw.querySelector(`[data-mode="${next}"]`).focus();
  });

  // Explicación solo si el mouse queda encima: breve a los 5 s, detallada a los 17 s
  const tip = sw.querySelector(".tm-tip");
  const SHORT = tip.textContent;
  const LONG = "Modo de tema: elegí cómo se ve la página.\n☀ Claro: fondo blanco, ideal de día.\nA Automático: sigue el modo de tu dispositivo (claro u oscuro) y cambia solo.\n☾ Oscuro: fondo oscuro, cansa menos la vista de noche.\nTu elección se guarda en este navegador y se aplica también en la tienda.";
  // Cuenta regresiva al costado: muestra cuánto falta para cada explicación (5 s y 17 s).
  const count = sw.querySelector(".tm-count"), num = count.querySelector("b"), ring = count.querySelector(".tm-ring");
  const help = sw.querySelector(".tm-help");
  const STEPS = [5000, 17000];
  let timers = [], tick = null, t0 = 0;
  function showTip(long) {
    tip.textContent = long ? LONG : SHORT;
    sw.classList.add("show-tip"); sw.classList.toggle("tip-long", long);
  }
  function stopCount() { clearInterval(tick); tick = null; count.classList.remove("on"); }
  function updateCount() {
    const el = Date.now() - t0;
    const next = STEPS.find((ms) => ms > el);
    if (!next) return stopCount();
    const prev = STEPS[STEPS.indexOf(next) - 1] || 0;
    num.textContent = Math.ceil((next - el) / 1000);
    ring.style.strokeDashoffset = String(100 * (1 - (el - prev) / (next - prev)));
    count.classList.add("on");
  }
  function reset() {
    timers.forEach(clearTimeout); timers = []; stopCount();
    sw.classList.remove("show-tip", "tip-long"); tip.textContent = SHORT;
    help.setAttribute("aria-expanded", "false");
  }
  sw.addEventListener("mouseenter", () => {
    if (sw.classList.contains("tip-long")) return;
    t0 = Date.now(); updateCount(); tick = setInterval(updateCount, 100);
    timers = [setTimeout(() => showTip(false), STEPS[0]), setTimeout(() => { showTip(true); stopCount(); }, STEPS[1])];
  });
  sw.addEventListener("mouseleave", reset);
  // "?": muestra la explicación completa al instante (click, toque o teclado), sin esperar.
  help.addEventListener("click", (e) => {
    e.stopPropagation();
    if (sw.classList.contains("tip-long")) return reset();
    timers.forEach(clearTimeout); timers = []; stopCount();
    showTip(true); help.setAttribute("aria-expanded", "true");
  });
  help.addEventListener("blur", () => { if (!sw.matches(":hover")) reset(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") reset(); });
})();
