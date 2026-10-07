/* Página 404: botones, buscador y la parte de la barra superior y el pie que en la tienda maneja app.js
   (tema, botón flotante de WhatsApp, menú en celular, contador del carrito y datos de contacto). */
(() => {
  const cfg = window.SITE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const base = document.querySelector("base") ? document.querySelector("base").href : location.origin + "/";
  const wa = `https://wa.me/${cfg.whatsappNumber || "5491130095254"}`;
  const waHello = `${wa}?text=${encodeURIComponent("Hola EXE! Quería hacer una consulta.")}`;
  const waLost = `${wa}?text=${encodeURIComponent("Hola EXE! Llegué a una página que no existe (" + location.pathname + ") y quería hacer una consulta.")}`;

  // Botones principales
  $("e404Home").href = base;
  $("e404Wa").href = waLost;

  // En pantallas angostas el texto de ejemplo completo no entra
  if (window.matchMedia("(max-width: 520px)").matches) $("e404Q").placeholder = "¿Buscás algo en especial?";

  // Buscador: lleva a la tienda con la búsqueda aplicada (#buscar/<texto>)
  $("e404Search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("e404Q").value.trim();
    location.href = q ? `${base}#buscar/${encodeURIComponent(q)}` : `${base}#productos`;
  });

  // Barra superior y pie
  if ($("waFloat")) $("waFloat").href = waHello;
  if ($("waFooter")) $("waFooter").href = waHello;
  if ($("mailFooter") && cfg.email) { $("mailFooter").href = `mailto:${cfg.email}`; $("mailFooter").textContent = cfg.email; }
  if ($("year")) $("year").textContent = new Date().getFullYear();
  if ($("menuToggle")) $("menuToggle").onclick = () => $("nav").classList.toggle("open");
  try {
    const count = (JSON.parse(localStorage.getItem("exe-cart")) || []).reduce((n, l) => n + (Number(l.qty) || 0), 0);
    if (count > 0) { $("cartCount").textContent = count; $("cartCount").hidden = false; }
  } catch (e) { /* sin carrito guardado */ }

  // Tema claro / automático / oscuro (misma preferencia que la tienda)
  const themeSwitch = $("themeSwitch");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const MODES = ["light", "auto", "dark"];
  const syncMeta = () => {
    const t = root.dataset.theme;
    if (themeMeta) themeMeta.content = t === "dark" || (t !== "light" && darkQuery.matches) ? "#05070b" : "#ffffff";
  };
  function applyTheme(mode, save = true) {
    if (mode === "auto") delete root.dataset.theme; else root.dataset.theme = mode;
    if (save) { try { mode === "auto" ? localStorage.removeItem("exe-theme") : localStorage.setItem("exe-theme", mode); } catch (e) {} }
    themeSwitch.dataset.mode = mode;
    themeSwitch.querySelectorAll("button").forEach((b) => { const on = b.dataset.mode === mode; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
    syncMeta();
  }
  if (themeSwitch) {
    let stored = null;
    try { stored = localStorage.getItem("exe-theme"); } catch (e) {}
    applyTheme(MODES.includes(stored) ? stored : "auto", false);
    themeSwitch.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) applyTheme(b.dataset.mode); });
    themeSwitch.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = MODES[Math.min(2, Math.max(0, MODES.indexOf(themeSwitch.dataset.mode) + step))];
      applyTheme(next); themeSwitch.querySelector(`[data-mode="${next}"]`).focus();
    });
    darkQuery.addEventListener("change", syncMeta);
  }

  // Botón flotante de WhatsApp visible / oculto
  const waSwitch = $("waSwitch");
  function applyWa(mode, save = true) {
    if (mode === "off") root.dataset.waFloat = "off"; else delete root.dataset.waFloat;
    if (save) { try { mode === "off" ? localStorage.setItem("exe-wa-float", "off") : localStorage.removeItem("exe-wa-float"); } catch (e) {} }
    waSwitch.dataset.mode = mode;
    waSwitch.querySelectorAll("button").forEach((b) => { const on = b.dataset.mode === mode; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
  }
  if (waSwitch) {
    let stored = null;
    try { stored = localStorage.getItem("exe-wa-float"); } catch (e) {}
    applyWa(stored === "off" ? "off" : "on", false);
    waSwitch.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) applyWa(b.dataset.mode); });
    waSwitch.addEventListener("keydown", (e) => {
      const next = { ArrowLeft: "off", ArrowUp: "off", ArrowRight: "on", ArrowDown: "on" }[e.key];
      if (!next) return;
      e.preventDefault(); applyWa(next); waSwitch.querySelector(`[data-mode="${next}"]`).focus();
    });
  }
})();
