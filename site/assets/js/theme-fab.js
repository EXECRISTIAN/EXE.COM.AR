/* Selector de tema flotante de Mi cuenta: un botón que alterna claro → automático → oscuro.
   Usa la misma preferencia (localStorage "exe-theme") que el selector del pie de la tienda. */
(function () {
  const fab = document.getElementById("themeFab");
  if (!fab) return;
  const MODES = ["light", "auto", "dark"];
  const NAMES = { light: "claro", auto: "automático", dark: "oscuro" };
  const root = document.documentElement;

  function apply(mode, save) {
    if (mode === "auto") delete root.dataset.theme; else root.dataset.theme = mode;
    if (save) { try { mode === "auto" ? localStorage.removeItem("exe-theme") : localStorage.setItem("exe-theme", mode); } catch (e) {} }
    fab.dataset.mode = mode;
    fab.setAttribute("aria-label", "Modo de tema: " + NAMES[mode] + ". Tocá para cambiar.");
  }
  let stored = null;
  try { stored = localStorage.getItem("exe-theme"); } catch (e) {}
  apply(MODES.includes(stored) ? stored : "auto", false);

  fab.addEventListener("click", () => {
    apply(MODES[(MODES.indexOf(fab.dataset.mode) + 1) % 3], true);
  });

  // Explicación solo si el mouse queda encima más de 5 segundos
  let timer = null;
  fab.addEventListener("mouseenter", () => { timer = setTimeout(() => fab.classList.add("show-tip"), 5000); });
  fab.addEventListener("mouseleave", () => { clearTimeout(timer); fab.classList.remove("show-tip"); });
})();
