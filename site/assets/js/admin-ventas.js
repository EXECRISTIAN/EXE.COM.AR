// Panel → Ventas: cuánto se vendió, cuánto se ganó y qué se vende más, por período.
// Solo cuenta pedidos pagados (pagado, en preparación, despachado, entregado), por la fecha del pago.
// La ganancia usa el costo actual de cada producto (product_costs, solo visible con products.write):
// sin ese permiso la ganancia no se muestra. Solo lee datos; no cambia nada en la base.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, money, $ } = A;
  const sb = () => A.be.sb;
  const can = (p) => A.perms.has(p);
  const PAID = ["paid", "preparing", "shipped", "delivered"];
  const PERIODS = { hoy: "Hoy", "7dias": "7 días", mes: "Este mes", "mes-pasado": "Mes pasado", anio: "Este año" };
  const DAY = 86400000;
  const iso = (d) => d.toLocaleDateString("sv");                 // AAAA-MM-DD en hora local
  const at = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  let state = { period: "mes", from: "", to: "" };
  let cache = null;                                              // datos del último cálculo (para el gráfico y el Excel)

  // Rango [desde, hasta] (fechas locales AAAA-MM-DD, ambos incluidos) y el período anterior del mismo largo.
  function range() {
    const now = new Date(), t = iso(now);
    let from, to = t;
    if (state.period === "hoy") from = t;
    else if (state.period === "7dias") from = iso(new Date(now - 6 * DAY));
    else if (state.period === "mes") from = t.slice(0, 8) + "01";
    else if (state.period === "mes-pasado") { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); from = iso(d); to = iso(new Date(now.getFullYear(), now.getMonth(), 0)); }
    else if (state.period === "anio") from = t.slice(0, 5) + "01-01";
    else { from = state.from || t; to = state.to || t; if (from > to) [from, to] = [to, from]; }
    const days = Math.round((at(to) - at(from)) / DAY) + 1;
    let pFrom, pTo;
    // Comparación justa: un mes o año en curso se compara con los mismos días del mes o año anterior.
    if (state.period === "mes" || state.period === "mes-pasado") {
      const f = at(from), last = new Date(f.getFullYear(), f.getMonth(), 0).getDate();
      pFrom = iso(new Date(f.getFullYear(), f.getMonth() - 1, 1));
      pTo = iso(new Date(f.getFullYear(), f.getMonth() - 1, Math.min(last, at(to).getDate())));
    } else if (state.period === "anio") { const y = Number(from.slice(0, 4)) - 1; pFrom = `${y}-01-01`; pTo = `${y}${to.slice(4)}`.replace(/-02-29$/, "-02-28"); }
    else { pTo = iso(new Date(at(from) - DAY)); pFrom = iso(new Date(at(from) - days * DAY)); }
    const vs = { hoy: "vs ayer", "7dias": "vs los 7 días anteriores", mes: "vs mismos días del mes pasado", "mes-pasado": "vs el mes anterior", anio: "vs mismas fechas del año pasado" }[state.period] || "vs el período anterior";
    return { from, to, days, pFrom, pTo, vs };
  }

  /* ---------- Datos ---------- */
  function demoData() {
    const names = [["demo-auris", "Auriculares inalámbricos Pro", "Audio", 70000, 49000], ["demo-cargador", "Cargador rápido 65W", "Cargadores", 30000, 22800],
      ["demo-reloj", "Smartwatch S8", "Relojes", 99000, 79200], ["demo-parlante", "Parlante portátil", "Audio", 45000, 34200], ["demo-funda", "Funda MagSafe", "Accesorios", 12000, 7200]];
    const products = names.map(([id, name, category]) => ({ id, name, category }));
    const costs = names.map(([id, , , , cost]) => ({ product_id: id, cost, cost_usd: null }));
    const orders = []; let id = 2000, seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 75; i++) {
      const d = new Date(Date.now() - Math.floor(rnd() * 70) * DAY - Math.floor(rnd() * 8) * 3600000);
      const items = [];
      for (let k = 0, n = 1 + Math.floor(rnd() * 2); k < n; k++) { const p = names[Math.floor(rnd() * names.length)]; if (!items.some((x) => x.product_id === p[0])) items.push({ product_id: p[0], qty: 1 + Math.floor(rnd() * 2), unit_price: p[3] }); }
      const total = items.reduce((s, x) => s + x.qty * x.unit_price, 0);
      orders.push({ id: id++, status: PAID[Math.floor(rnd() * 4)], total, paid_at: d.toISOString(), created_at: d.toISOString(), paid_by: rnd() < 0.72 ? "mercadopago" : "admin", payment_ref: null, customer_name: "Cliente de ejemplo", order_items: items });
    }
    return { orders, products, costs, fx: 1550 };
  }

  async function loadData(since) {
    if (A.demo) return demoData();
    // Margen de 60 días: un pedido creado antes del período puede haberse pagado dentro de él.
    const created = iso(new Date(at(since) - 60 * DAY));
    const [o, p, c, f] = await Promise.all([
      sb().from("orders").select("id, status, total, paid_at, paid_by, payment_ref, created_at, customer_name, customer:profiles(full_name), order_items(product_id, qty, unit_price)")
        .in("status", PAID).gte("created_at", created).order("created_at"),
      sb().from("products").select("id, name, category"),
      can("products.write") ? sb().from("product_costs").select("product_id, cost, cost_usd") : Promise.resolve({ data: null }),
      sb().from("fx_settings").select("effective_rate").eq("id", 1).maybeSingle(),
    ]);
    if (o.error) throw o.error;
    return { orders: o.data || [], products: p.data || [], costs: c.data, fx: Number(f.data?.effective_rate) || 0 };
  }

  // Calcula todo para un rango. costOf(id) = costo unitario en pesos o null si no hay costo cargado.
  function compute(orders, from, to, costOf) {
    const inR = orders.filter((o) => { const d = iso(new Date(o.paid_at || o.created_at)); return d >= from && d <= to; });
    const r = { orders: inR, total: 0, profit: 0, itemsSale: 0, missingCost: new Set(), byDay: new Map(), byProduct: new Map(), byPay: { mp: 0, manual: 0 } };
    for (const o of inR) {
      const t = Number(o.total || 0), d = iso(new Date(o.paid_at || o.created_at));
      r.total += t;
      const day = r.byDay.get(d) || { total: 0, orders: [] }; day.total += t; day.orders.push(o); r.byDay.set(d, day);
      r.byPay[o.paid_by === "mercadopago" || o.payment_ref ? "mp" : "manual"] += t;
      for (const it of o.order_items || []) {
        const sale = Number(it.unit_price || 0) * it.qty, c = costOf(it.product_id);
        r.itemsSale += sale;
        const p = r.byProduct.get(it.product_id) || { qty: 0, sale: 0, profit: 0, noCost: false };
        p.qty += it.qty; p.sale += sale;
        if (c == null) { p.noCost = true; r.missingCost.add(it.product_id); } else { p.profit += sale - c * it.qty; r.profit += sale - c * it.qty; }
        r.byProduct.set(it.product_id, p);
      }
    }
    r.count = inR.length; r.avg = r.count ? r.total / r.count : 0;
    return r;
  }

  /* ---------- Vista ---------- */
  A.views.ventas = async function (period) {
    if (period && (PERIODS[period] || period === "fechas")) state.period = period;
    const R = range();
    const data = await loadData(R.pFrom < R.from ? R.pFrom : R.from);
    const costMap = data.costs ? new Map(data.costs.map((c) => [c.product_id, c.cost != null ? Number(c.cost) : c.cost_usd != null && data.fx ? Number(c.cost_usd) * data.fx : null])) : null;
    const costOf = (id) => (costMap ? costMap.get(id) ?? null : null);
    const cur = compute(data.orders, R.from, R.to, costOf), prev = compute(data.orders, R.pFrom, R.pTo, costOf);
    const prod = new Map(data.products.map((p) => [p.id, p]));
    cache = { R, cur, prod, showProfit: !!costMap };

    const delta = (a, b, extra = "") => { const v = pct(a, b); return v == null ? `<span class="vt-delta">${extra || "sin ventas para comparar"}</span>` : `<span class="vt-delta ${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v)}% ${R.vs}${extra ? " · " + extra : ""}</span>`; };
    const margin = cur.itemsSale > 0 ? Math.round((cur.profit / cur.itemsSale) * 100) : 0;
    const chips = Object.entries(PERIODS).map(([k, v]) => `<button type="button" class="vt-chip ${state.period === k ? "on" : ""}" data-vt-period="${k}">${v}</button>`).join("");

    // Gráfico: un punto por día (hasta 62 días) o por mes (períodos más largos)
    const monthly = R.days > 62;
    const bars = [];
    if (monthly) {
      for (let d = at(R.from); iso(d) <= R.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const m = iso(d).slice(0, 7); let total = 0;
        cur.byDay.forEach((v, k) => { if (k.startsWith(m)) total += v.total; });
        bars.push({ key: m, label: d.toLocaleDateString("es-AR", { month: "short" }), total, weekend: false });
      }
    } else {
      for (let d = at(R.from); iso(d) <= R.to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const k = iso(d); bars.push({ key: k, label: String(d.getDate()), total: cur.byDay.get(k)?.total || 0, weekend: d.getDay() === 0 || d.getDay() === 6 });
      }
    }
    const max = Math.max(1, ...bars.map((b) => b.total)), best = bars.reduce((a, b) => (b.total > a.total ? b : a), bars[0] || { total: 0 });
    const chart = cur.count ? `<div class="vt-chart" role="list">${bars.map((b) => `<button type="button" role="listitem" class="vt-bar ${b.weekend ? "we" : ""}" data-vt-day="${b.key}" title="${esc(b.label)}: ${money(b.total)}" aria-label="${esc(monthly ? b.label : b.key)}: ${money(b.total)}" ${b.total ? "" : "disabled"}>
        <i style="height:${Math.max(b.total ? 3 : 0, Math.round((b.total / max) * 100))}%">${b === best && b.total ? `<span class="vt-tag">${money(b.total)}</span>` : ""}</i><small>${esc(b.label)}</small></button>`).join("")}</div>
        <p class="ed-hint">${monthly ? "Una barra por mes." : "Barras más suaves = sábados y domingos."} Tocá una barra para ver sus pedidos.</p><div id="vtDay"></div>`
      : `<p class="ed-hint">No hay ventas pagadas en este período.</p>`;

    const top = [...cur.byProduct.entries()].sort((a, b) => b[1].sale - a[1].sale).slice(0, 10);
    const name = (id) => prod.get(id)?.name || id;
    const cats = new Map();
    cur.byProduct.forEach((v, id) => { const c = prod.get(id)?.category || "Sin categoría"; cats.set(c, (cats.get(c) || 0) + v.sale); });
    const catList = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), catMax = Math.max(1, ...catList.map((c) => c[1]));
    const payTot = cur.byPay.mp + cur.byPay.manual || 1;
    const meter = (label, value, w, shown) => `<div class="vt-meter"><span>${esc(label)}</span><b>${shown}</b><div class="vt-track"><i style="width:${Math.round(w)}%"></i></div></div>`;
    const sp = cache.showProfit;

    return `<p class="ed-hint" style="margin-top:0">Cuánto vendiste, cuánto ganaste y qué se vende más. Solo cuenta pedidos pagados, por la fecha del pago.</p>
      <div class="vt-bar-top">${chips}<button type="button" class="vt-chip ${state.period === "fechas" ? "on" : ""}" data-vt-period="fechas">📅 Elegir fechas</button>
        <span class="vt-dates" ${state.period === "fechas" ? "" : "hidden"}><label>Desde <input type="date" id="vtFrom" value="${R.from}"></label><label>Hasta <input type="date" id="vtTo" value="${R.to}"></label></span>
        <button type="button" class="vt-chip vt-dl" id="vtCsv" ${cur.count ? "" : "disabled"}>⬇️ Descargar Excel</button></div>
      <div class="kpis">
        <div class="kpi"><small>Vendido</small><strong>${money(cur.total)}</strong>${delta(cur.total, prev.total)}</div>
        ${sp ? `<div class="kpi"><small>Ganancia estimada</small><strong>${money(Math.round(cur.profit))}</strong>${delta(cur.profit, prev.profit, cur.itemsSale ? `margen ${margin}%` : "")}</div>` : ""}
        <div class="kpi"><small>Pedidos pagados</small><strong>${cur.count}</strong>${delta(cur.count, prev.count)}</div>
        <div class="kpi"><small>Ticket promedio</small><strong>${money(Math.round(cur.avg))}</strong>${delta(cur.avg, prev.avg)}</div>
      </div>
      ${sp && cur.missingCost.size ? `<p class="notice info">⚠️ ${cur.missingCost.size} producto${cur.missingCost.size === 1 ? "" : "s"} vendido${cur.missingCost.size === 1 ? "" : "s"} no tiene${cur.missingCost.size === 1 ? "" : "n"} costo cargado y no suma${cur.missingCost.size === 1 ? "" : "n"} a la ganancia: ${[...cur.missingCost].slice(0, 5).map((id) => `<a href="#editar/${encodeURIComponent(id)}">${esc(name(id))}</a>`).join(", ")}${cur.missingCost.size > 5 ? "…" : ""}</p>` : ""}
      <div class="panel"><h3>Ventas por ${monthly ? "mes" : "día"} <small class="vt-range">${at(R.from).toLocaleDateString("es-AR")} al ${at(R.to).toLocaleDateString("es-AR")}</small></h3>${chart}</div>
      <div class="vt-grid">
        <div class="panel"><h3>Lo más vendido</h3>${top.length ? `<div class="tbl-scroll"><table class="table vt-t"><tr><th>Producto</th><th class="n">Unid.</th><th class="n">Vendido</th>${sp ? '<th class="n">Ganancia</th>' : ""}</tr>
          ${top.map(([id, v]) => `<tr><td>${prod.has(id) ? `<a href="#editar/${encodeURIComponent(id)}">${esc(name(id))}</a>` : esc(name(id))}</td><td class="n">${v.qty}</td><td class="n">${money(v.sale)}</td>${sp ? `<td class="n">${v.noCost ? '<span title="Sin costo cargado">—</span>' : money(Math.round(v.profit))}</td>` : ""}</tr>`).join("")}</table></div>` : '<p class="ed-hint">Sin ventas en este período.</p>'}</div>
        <div class="panel"><h3>Cómo pagaron</h3>
          ${meter("Mercado Pago", cur.byPay.mp, (cur.byPay.mp / payTot) * 100, `${Math.round((cur.byPay.mp / payTot) * 100)}%`)}
          ${meter("Marcado a mano (transferencia, efectivo)", cur.byPay.manual, (cur.byPay.manual / payTot) * 100, `${Math.round((cur.byPay.manual / payTot) * 100)}%`)}
          <h3 style="margin-top:22px">Por categoría</h3>
          ${catList.length ? catList.map(([c, v]) => meter(c, v, (v / catMax) * 100, money(v))).join("") : '<p class="ed-hint">Sin ventas en este período.</p>'}
        </div>
      </div>
      <p class="ed-hint">"Vendido" y el ticket promedio incluyen el envío cobrado. ${sp ? "La ganancia se calcula con el costo actual de cada producto (los costos en dólares se pasan con la cotización de hoy), sin el envío." : "La ganancia solo la ven quienes pueden editar costos."}</p>`;
  };

  A.views.ventas.after = () => {
    document.querySelectorAll("[data-vt-period]").forEach((b) => (b.onclick = () => {
      const p = b.dataset.vtPeriod;
      if (p === "fechas") { state.period = "fechas"; const R = cache?.R; state.from = R?.from || ""; state.to = R?.to || ""; }
      location.hash === `#ventas/${p}` ? A.route() : (location.hash = `#ventas/${p}`);
    }));
    const f = $("vtFrom"), t = $("vtTo");
    if (f && t) f.onchange = t.onchange = () => { state.period = "fechas"; state.from = f.value; state.to = t.value; A.route(); };
    document.querySelectorAll("[data-vt-day]").forEach((b) => (b.onclick = () => showDay(b.dataset.vtDay, b)));
    const dl = $("vtCsv"); if (dl) dl.onclick = download;
  };

  function showDay(key, btn) {
    const box = $("vtDay"); if (!box || !cache) return;
    document.querySelectorAll(".vt-bar.sel").forEach((b) => b.classList.remove("sel")); btn.classList.add("sel");
    const list = []; cache.cur.byDay.forEach((v, k) => { if (k.startsWith(key)) list.push(...v.orders); });
    const title = key.length === 7 ? at(key + "-01").toLocaleDateString("es-AR", { month: "long", year: "numeric" }) : at(key).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
    box.innerHTML = `<h4 class="vt-day-t">${esc(title)} — ${list.length} pedido${list.length === 1 ? "" : "s"}</h4><div class="tbl-scroll"><table class="table"><tr><th>#</th><th>Cliente</th><th>Pago</th><th class="n">Total</th></tr>
      ${list.map((o) => `<tr><td><a href="#pedido/${o.id}">#${o.id}</a></td><td>${esc(o.customer?.full_name || o.customer_name || "—")}</td><td>${o.paid_by === "mercadopago" || o.payment_ref ? "Mercado Pago" : "A mano"}</td><td class="n">${money(o.total)}</td></tr>`).join("")}</table></div>`;
  }

  // Excel: archivo CSV con ";" (Excel en español lo abre directo con columnas separadas)
  function download() {
    if (!cache) return;
    const { R, cur, prod, showProfit } = cache;
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Pedido", "Fecha de pago", "Cliente", "Pago", "Producto", "Categoría", "Cantidad", "Precio unitario", "Subtotal", ...(showProfit ? ["Ganancia estimada"] : []), "Total del pedido"];
    const lines = [];
    for (const o of cur.orders) {
      const pay = o.paid_by === "mercadopago" || o.payment_ref ? "Mercado Pago" : "A mano", d = new Date(o.paid_at || o.created_at).toLocaleDateString("es-AR");
      for (const it of o.order_items || []) {
        const p = prod.get(it.product_id), sale = Number(it.unit_price || 0) * it.qty, pr = cur.byProduct.get(it.product_id);
        const unitProfit = pr && !pr.noCost && pr.qty ? pr.profit / pr.qty : null;
        lines.push([o.id, d, o.customer?.full_name || o.customer_name || "", pay, p?.name || it.product_id, p?.category || "", it.qty, it.unit_price, sale,
          ...(showProfit ? [unitProfit == null ? "" : Math.round(unitProfit * it.qty)] : []), o.total].map(q).join(";"));
      }
    }
    const blob = new Blob(["﻿" + [head.map(q).join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ventas-exe-${R.from}-al-${R.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
})();
