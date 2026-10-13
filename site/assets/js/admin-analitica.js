// Panel → Analítica (permiso analytics.read). Datos de la analítica propia y anónima de la tienda
// (función track() en la base) + provincias de los pedidos. El resumen lo arma la base (analytics_summary).
(() => {
  const A = window.EXE_ADMIN;
  const { esc, money, $ } = A;
  const sb = () => A.be.sb;
  const PERIODS = { hoy: "Hoy", "7dias": "7 días", mes: "Este mes", "mes-pasado": "Mes pasado", anio: "Este año" };
  const DAY = 86400000;
  const iso = (d) => d.toLocaleDateString("sv");
  const at = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmt = (n) => Number(n || 0).toLocaleString("es-AR");
  let period = "mes", sel = null;

  function range() {
    const now = new Date(), t = iso(now);
    if (period === "hoy") return [t, t];
    if (period === "7dias") return [iso(new Date(now - 6 * DAY)), t];
    if (period === "mes-pasado") return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    if (period === "anio") return [t.slice(0, 5) + "01-01", t];
    return [t.slice(0, 8) + "01", t];
  }

  // Mapa de Argentina en cuadrículas (una celda por provincia, ubicada aproximadamente donde está)
  const PROVS = [["JUJ", "Jujuy", 1, 0], ["SAL", "Salta", 2, 0], ["FOR", "Formosa", 3, 0], ["MIS", "Misiones", 5, 0],
    ["CAT", "Catamarca", 1, 1], ["TUC", "Tucumán", 2, 1], ["CHA", "Chaco", 3, 1], ["COR", "Corrientes", 4, 1],
    ["LRI", "La Rioja", 1, 2], ["SDE", "Santiago del Estero", 2, 2], ["SFE", "Santa Fe", 3, 2], ["ERI", "Entre Ríos", 4, 2],
    ["SJU", "San Juan", 0, 3], ["CBA", "Córdoba", 2, 3], ["CABA", "CABA", 4, 3],
    ["MZA", "Mendoza", 0, 4], ["SLU", "San Luis", 1, 4], ["BSAS", "Buenos Aires", 3, 4],
    ["NQN", "Neuquén", 0, 5], ["LPA", "La Pampa", 1, 5], ["RNE", "Río Negro", 1, 6], ["CHU", "Chubut", 1, 7], ["SCR", "Santa Cruz", 1, 8], ["TDF", "Tierra del Fuego", 1, 9]];
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(provincia de|pcia\.?|prov\.?)\s*/g, "").trim();
  const ALIAS = { "capital federal": "CABA", "ciudad autonoma de buenos aires": "CABA", "caba": "CABA", "c.a.b.a.": "CABA", "bs as": "Buenos Aires", "bs. as.": "Buenos Aires", "buenos aires": "Buenos Aires", "tierra del fuego": "Tierra del Fuego", "santiago del estero": "Santiago del Estero" };
  const provName = (s) => { const n = norm(s); return ALIAS[n] || (PROVS.find((p) => norm(p[1]) === n) || [])[1] || null; };

  function demo() {
    const days = [], [f, t] = range();
    for (let d = at(f), i = 0; iso(d) <= t; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), i++) days.push({ d: iso(d), n: 40 + ((i * 37) % 60) + (d.getDay() % 6 === 0 ? 30 : 0) });
    const visits = days.reduce((s, x) => s + x.n, 0);
    return {
      kpis: { visits, people: Math.round(visits * 0.6), wa: Math.round(visits * 0.03), mobile: Math.round(visits * 0.6 * 0.74), p_visits: Math.round(visits * 0.82), p_people: Math.round(visits * 0.51), p_wa: Math.round(visits * 0.027) },
      by_day: days,
      funnel: { product: Math.round(visits * 0.6), add: Math.round(visits * 0.28), cart: Math.round(visits * 0.1), wa: Math.round(visits * 0.03) },
      devices: { mobile: 74, desktop: 21, tablet: 5 }, os: { Android: 58, "iPhone/iPad": 16, Windows: 19, Mac: 4, Linux: 3 }, browsers: { Chrome: 71, Safari: 18, Edge: 6, Samsung: 5 },
      sources: [{ s: "Instagram", n: 38 }, { s: "Google", n: 27 }, { s: "WhatsApp", n: 17 }, { s: "Directo", n: 11 }, { s: "Mercado Libre", n: 7 }],
      campaigns: [{ c: "historia-ig", n: 22 }, { c: "ml-perfil", n: 9 }],
      products: (A.DEMO.products || []).map((p, i) => ({ id: p.id, name: p.name, image: null, views: 800 - i * 200, adds: 70 - i * 20 })),
      provinces: { "Buenos Aires": 128, CABA: 96, "Córdoba": 41, "Santa Fe": 38, Mendoza: 14, "Entre Ríos": 12, "Tucumán": 11, Salta: 9, "Neuquén": 9, Corrientes: 7, Misiones: 6, "Río Negro": 6 },
    };
  }

  A.views.analitica = async function (p) {
    if (p && PERIODS[p]) period = p;
    const [f, t] = range();
    let r;
    if (A.demo) r = demo();
    else { const { data, error } = await sb().rpc("analytics_summary", { p_from: f, p_to: t }); if (error) throw error; r = data; }
    const k = r.kpis || {};
    const delta = (a, b) => { if (!b) return `<span class="vt-delta">sin datos para comparar</span>`; const v = Math.round(((a - b) / b) * 100); return `<span class="vt-delta ${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v)}% vs período anterior</span>`; };
    const conv = k.people ? (k.wa / k.people) * 100 : 0, mob = k.people ? Math.round((k.mobile / k.people) * 100) : 0;

    // Provincias (se agrupan por nombre normalizado)
    const prov = {};
    Object.entries(r.provinces || {}).forEach(([n, c]) => { const p = provName(n); if (p) prov[p] = (prov[p] || 0) + c; });
    const pmax = Math.max(1, ...Object.values(prov));
    const cell = ([ab, name, c, row]) => { const v = prov[name] || 0, tt = Math.sqrt(v / pmax);
      return `<button type="button" class="an-pv${sel === name ? " sel" : ""}" style="grid-column:${c + 1};grid-row:${row + 1};--a:${(v ? 0.12 + 0.88 * tt : 0.05).toFixed(2)};color:${tt > 0.45 ? "#fff" : "var(--c2)"}" data-an-prov="${esc(name)}" title="${esc(name)}: ${v} pedido${v === 1 ? "" : "s"}" aria-label="${esc(name)}: ${v} pedidos"><b>${ab}</b><small>${v}</small></button>`; };
    const topProv = Object.entries(prov).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const bar = (label, v, max, shown) => `<div class="an-bar"><span>${esc(label)}</span><i><b style="width:${max ? Math.round((v / max) * 100) : 0}%"></b></i><strong>${shown ?? fmt(v)}</strong></div>`;

    const days = r.by_day || [], dmax = Math.max(1, ...days.map((x) => x.n));
    const fu = r.funnel || {}, fmax = Math.max(1, fu.product || 0);
    const pct = (obj) => { const tot = Object.values(obj || {}).reduce((s, v) => s + v, 0) || 1; return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, Math.round((v / tot) * 100)]); };
    const dev = pct(r.devices), DEVN = { mobile: "Celular", desktop: "Computadora", tablet: "Tablet" }, DEVC = { mobile: "var(--c0)", desktop: "#7cc0ea", tablet: "#cfe6f6" };
    let acc = 0; const donut = dev.map(([n, v]) => { const s = acc; acc += v; return `${DEVC[n] || "#ccc"} ${s}% ${acc}%`; }).join(",");
    const src = r.sources || [], stot = src.reduce((s, x) => s + x.n, 0) || 1, smax = Math.max(1, ...src.map((x) => x.n));
    const prods = (r.products || []).filter((x) => x.views > 0).slice(0, 6);
    const empty = !k.visits && !Object.keys(prov).length;

    return `<p class="ed-hint" style="margin-top:0">Quién visita la tienda, desde dónde compran, con qué dispositivo y de dónde llegan. Anónimo (sin nombre, IP ni GPS) y sin servicios pagos. No cuenta las visitas del equipo de EXE.</p>
      <div class="vt-bar-top">${Object.entries(PERIODS).map(([key, v]) => `<button type="button" class="vt-chip ${period === key ? "on" : ""}" data-an-period="${key}">${v}</button>`).join("")}</div>
      ${empty ? `<p class="notice info">Todavía no hay datos en este período: la medición arrancó el 13/10/2026. Las visitas aparecen a medida que la gente entra a la tienda.</p>` : ""}
      <div class="kpis">
        <div class="kpi"><small>Visitas</small><strong>${fmt(k.visits)}</strong>${delta(k.visits, k.p_visits)}</div>
        <div class="kpi"><small>Personas distintas</small><strong>${fmt(k.people)}</strong>${delta(k.people, k.p_people)}</div>
        <div class="kpi"><small>Pedidos por WhatsApp</small><strong>${fmt(k.wa)}</strong>${delta(k.wa, k.p_wa)}</div>
        <div class="kpi"><small>Conversión</small><strong>${conv.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</strong><span class="vt-delta">de cada 100 personas, ${Math.round(conv)} piden</span></div>
        <div class="kpi"><small>Desde el celular</small><strong>${mob}%</strong><span class="vt-delta">${100 - mob}% otros dispositivos</span></div>
      </div>
      <div class="an-grid">
        <div class="panel"><h3>🗺️ Desde dónde compran</h3><p class="ed-hint">Pedidos por provincia: la que elige el cliente en el carrito (opcional) y la de los pedidos armados en el panel. Más oscuro = más pedidos.</p>
          <div class="an-mapwrap"><div class="an-map">${PROVS.map(cell).join("")}</div>
            <div class="an-leg"><b>${sel ? esc(sel) : "Top provincias"}</b>${sel ? `<p class="ed-hint">${prov[sel] || 0} pedido${prov[sel] === 1 ? "" : "s"} en el período. <button type="button" class="link-btn" data-an-prov="">Ver todas</button></p>`
              : topProv.length ? topProv.map(([n, v]) => bar(n, v, topProv[0][1])).join("") : '<p class="ed-hint">Sin pedidos con provincia todavía.</p>'}
            <div class="an-scale">Menos <i></i> Más</div></div></div></div>
        <div class="panel"><h3>👀 Visitas por día</h3>
          ${days.length ? `<div class="an-spark">${days.map((x) => `<i style="height:${Math.max(2, Math.round((x.n / dmax) * 100))}%" title="${at(x.d).toLocaleDateString("es-AR")}: ${x.n} visitas"></i>`).join("")}</div>` : '<p class="ed-hint">Sin visitas en el período.</p>'}
          <h3 style="margin-top:18px">🛒 Del vistazo al pedido</h3><p class="ed-hint">Personas que llegaron a cada paso.</p>
          <div class="an-funnel">${[["Vieron productos", fu.product], ["Agregaron al carrito", fu.add], ["Abrieron el carrito", fu.cart], ["Enviaron WhatsApp", fu.wa]].map(([l, v]) => `<div><span>${l}</span><i><b style="width:${Math.round(((v || 0) / fmax) * 100)}%"></b></i><strong>${fmt(v)}</strong></div>`).join("")}</div></div>
      </div>
      <div class="an-grid3">
        <div class="panel"><h3>📱 Dispositivos</h3>${dev.length ? `<div class="an-donut" style="background:conic-gradient(${donut})"></div>
          ${dev.map(([n, v]) => `<div class="an-li"><span><i style="background:${DEVC[n] || "#ccc"}"></i>${DEVN[n] || esc(n)}</span><b>${v}%</b></div>`).join("")}
          <p class="ed-hint">${pct(r.os).map(([n, v]) => `${esc(n)} ${v}%`).join(" · ")}<br>Navegador: ${pct(r.browsers).slice(0, 4).map(([n, v]) => `${esc(n)} ${v}%`).join(", ")}</p>` : '<p class="ed-hint">Sin datos.</p>'}</div>
        <div class="panel"><h3>🔗 De dónde llegan</h3><p class="ed-hint">El link que trajo a cada persona la primera vez.</p>
          ${src.length ? src.slice(0, 7).map((x) => bar(x.s, x.n, smax, Math.round((x.n / stot) * 100) + "%")).join("") : '<p class="ed-hint">Sin datos.</p>'}
          ${(r.campaigns || []).length ? `<p class="ed-hint"><b>Links con etiqueta:</b> ${(r.campaigns || []).map((c) => `${esc(c.c)} (${c.n})`).join(" · ")}</p>` : ""}
          <p class="ed-hint">Para saber qué publicación trae gente, compartí links con etiqueta: <code>exe.com.ar/?origen=historia-ig</code></p></div>
        <div class="panel"><h3>🔥 Lo más mirado</h3><p class="ed-hint">Vistas de la ficha → agregados al carrito.</p>
          ${prods.length ? prods.map((x) => `<div class="an-prod">${x.image ? `<img src="${esc(/^(https?:)?\/\//.test(x.image) ? x.image : "../" + x.image)}" alt="">` : "<span></span>"}<span><a href="#editar/${encodeURIComponent(x.id)}">${esc(x.name || x.id)}</a><small>${fmt(x.views)} vistas · ${x.views ? Math.round((x.adds / x.views) * 100) : 0}% al carrito</small></span>${x.views >= 30 && x.adds / x.views < 0.05 ? '<b title="Muy mirado y poco agregado: revisar precio o fotos">⚠️</b>' : ""}</div>`).join("") : '<p class="ed-hint">Sin datos.</p>'}
          <p class="ed-hint">⚠️ = muy mirado y poco agregado: conviene revisar precio o fotos.</p></div>
      </div>
      <div class="an-grid">
        <div class="panel"><h3>📣 Publicidad (opcional)</h3><p class="ed-hint">Las herramientas gratis de Meta y Google sirven para medir anuncios pagos. Solo hacen falta si pautás.</p>
          <div class="an-ads"><span><b>Meta Pixel (Instagram / Facebook)</b><small>Mide qué anuncios traen pedidos</small></span><span class="pill pending">Sin conectar</span></div>
          <div class="an-ads"><span><b>Google Analytics 4</b><small>Visitas y búsquedas de Google</small></span><span class="pill pending">Sin conectar</span></div>
          <div class="an-ads"><span><b>Analítica propia de EXE</b><small>Todo lo de esta página, sin terceros</small></span><span class="pill paid">Activa</span></div>
          <p class="ed-hint">Para conectar Meta o Google: creá la cuenta gratis, pasame el ID (Pixel ID o G-XXXX) y lo agrego junto con el aviso de privacidad para los visitantes.</p></div>
        <div class="panel"><h3>🔒 Privacidad (Ley 25.326)</h3>
          <p class="ed-hint">La analítica propia es anónima: guarda un número al azar por navegador (no se relaciona con la cuenta ni con el nombre), tipo de dispositivo, sistema, navegador, de qué link vino y la provincia solo si la persona la elige en el carrito. No guarda IP ni ubicación por GPS. Por eso no necesita cartel de cookies; si se conecta Meta o Google, se agrega el aviso para aceptar.</p></div>
      </div>`;
  };

  A.views.analitica.after = () => {
    document.querySelectorAll("[data-an-period]").forEach((b) => (b.onclick = () => { const h = `#analitica/${b.dataset.anPeriod}`; location.hash === h ? A.route() : (location.hash = h); }));
    document.querySelectorAll("[data-an-prov]").forEach((b) => (b.onclick = () => { sel = b.dataset.anProv && sel !== b.dataset.anProv ? b.dataset.anProv : null; A.route(); }));
  };
})();
