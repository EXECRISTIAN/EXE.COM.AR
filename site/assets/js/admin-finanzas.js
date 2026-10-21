// Panel → Estado de resultados (permiso finance.manage, solo administradores).
// Por mes: ingresos (pedidos pagados, por fecha de pago, con envío), costo de lo vendido (costo actual de cada
// producto, como en Ventas), ganancia bruta, gastos cargados a mano y resultado neto.
// Módulos financieros activables por partes (finance_modules): hoy "resultados"; facturación y reportes,
// próximamente. Seguridad: la base (RLS) solo deja leer y escribir con finance.manage.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, money, $ } = A;
  const sb = () => A.be.sb;
  const PAID = ["paid", "preparing", "shipped", "delivered"];
  const CATS = ["Publicidad", "Comisiones de cobro", "Envíos pagados", "Sueldos", "Alquiler", "Servicios", "Impuestos", "Compras varias", "Otros"];
  const MODULES = [
    ["resultados", "📒 Estado de resultados", "Ingresos, costo de lo vendido, gastos y resultado de cada mes."],
    ["facturacion", "🧾 Facturación", "Facturas con y sin ARCA (monotributo, responsable inscripto). Próximamente.", true],
    ["reportes", "📬 Reportes automáticos", "Resumen por email cada semana o mes. Próximamente.", true],
  ];
  const MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const r0 = (n) => Math.round(n);
  const num = (v) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  let year = new Date().getFullYear(), sel = null, cache = null;

  /* ---------- Datos ---------- */
  function demo() {
    const D = A.DEMO;
    if (!D._fin) {
      const y = new Date().getFullYear(), m = new Date().getMonth();
      const orders = [], expenses = []; let seed = 11, id = 3000;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      for (let k = 0; k <= m; k++) {
        for (let i = 0, n = 6 + Math.floor(rnd() * 10); i < n; i++) {
          const price = [70000, 30000, 99000, 45000][Math.floor(rnd() * 4)], qty = 1 + Math.floor(rnd() * 2);
          orders.push({ id: id++, total: price * qty + 6000, paid_at: new Date(y, k, 1 + Math.floor(rnd() * 27)).toISOString(), order_items: [{ product_id: "p" + price, qty, unit_price: price }] });
        }
        expenses.push({ id: k * 3 + 1, month: `${y}-${String(k + 1).padStart(2, "0")}-01`, category: "Publicidad", description: "Instagram", amount: 40000 + Math.floor(rnd() * 30000) });
        expenses.push({ id: k * 3 + 2, month: `${y}-${String(k + 1).padStart(2, "0")}-01`, category: "Comisiones de cobro", description: "Mercado Pago", amount: 15000 + Math.floor(rnd() * 10000) });
      }
      D._fin = { modules: { resultados: true, facturacion: false, reportes: false }, orders, expenses,
        costs: [70000, 30000, 99000, 45000].map((p) => ({ product_id: "p" + p, cost: Math.round(p * 0.72) })), fx: 1550 };
    }
    return D._fin;
  }

  async function loadModules() {
    if (A.demo) return demo().modules;
    const { data, error } = await sb().from("finance_modules").select("key, enabled");
    if (error) throw error;
    return Object.fromEntries((data || []).map((m) => [m.key, m.enabled]));
  }

  async function loadYear(y) {
    if (A.demo) { const d = demo(); return { orders: d.orders, expenses: d.expenses, costs: d.costs, fx: d.fx }; }
    const from = `${y}-01-01`, to = `${y + 1}-01-01`;
    const [o, e, c, f] = await Promise.all([
      // Margen de 60 días: un pedido creado en diciembre puede haberse pagado en enero.
      sb().from("orders").select("id, total, paid_at, created_at, order_items(product_id, qty, unit_price)").in("status", PAID)
        .gte("created_at", `${y - 1}-11-01`).lt("created_at", to),
      sb().from("expenses").select("id, month, category, description, amount").gte("month", from).lt("month", to).order("month").order("id"),
      A.perms.has("products.write") ? sb().from("product_costs").select("product_id, cost, cost_usd") : Promise.resolve({ data: null }),
      sb().from("fx_settings").select("effective_rate").eq("id", 1).maybeSingle(),
    ]);
    for (const x of [o, e]) if (x.error) throw x.error;
    return { orders: o.data || [], expenses: e.data || [], costs: c.data, fx: Number(f.data?.effective_rate) || 0 };
  }

  function compute(d, y) {
    const costMap = d.costs ? new Map(d.costs.map((c) => [c.product_id, c.cost != null ? Number(c.cost) : c.cost_usd != null && d.fx ? Number(c.cost_usd) * d.fx : null])) : null;
    const now = new Date(), last = y < now.getFullYear() ? 11 : y > now.getFullYear() ? -1 : now.getMonth();
    const months = Array.from({ length: last + 1 }, (_, i) => ({ i, key: `${y}-${String(i + 1).padStart(2, "0")}`, income: 0, cogs: 0, noCost: 0, expenses: 0, byCat: {}, list: [] }));
    for (const o of d.orders) {
      const p = new Date(o.paid_at || o.created_at); if (p.getFullYear() !== y || !months[p.getMonth()]) continue;
      const m = months[p.getMonth()]; m.income += Number(o.total || 0);
      for (const it of o.order_items || []) { const c = costMap ? costMap.get(it.product_id) : null; if (c == null) m.noCost += it.qty; else m.cogs += c * it.qty; }
    }
    for (const e of d.expenses) {
      const m = months.find((x) => x.key === String(e.month).slice(0, 7)); if (!m) continue;
      m.expenses += Number(e.amount); m.byCat[e.category] = (m.byCat[e.category] || 0) + Number(e.amount); m.list.push(e);
    }
    months.forEach((m) => { m.gross = m.income - m.cogs; m.net = m.gross - m.expenses; });
    const tot = months.reduce((t, m) => { ["income", "cogs", "noCost", "expenses", "gross", "net"].forEach((k) => (t[k] += m[k])); return t; }, { income: 0, cogs: 0, noCost: 0, expenses: 0, gross: 0, net: 0 });
    return { months, tot, hasCosts: !!costMap };
  }

  /* ---------- Vista ---------- */
  const signed = (n) => `<span class="${n < 0 ? "fin-neg" : ""}">${n < 0 ? "−" : ""}${money(Math.abs(r0(n)))}</span>`;
  const pctOf = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

  function modulesPanel(mods) {
    return `<div class="panel"><h3>Módulos financieros</h3><p class="ed-hint">Cada parte se prende o se apaga por separado. Apagar no borra nada.</p>
      <div class="fin-mods">${MODULES.map(([k, t, d, soon]) => `<label class="fin-mod ${soon ? "soon" : ""}"><input type="checkbox" data-fin-mod="${k}" ${mods[k] ? "checked" : ""} ${soon ? "disabled" : ""}>
        <span><b>${t}</b><small>${esc(d)}</small></span></label>`).join("")}</div></div>`;
  }

  A.views.resultados = async function () {
    const mods = await loadModules();
    if (!mods.resultados) return modulesPanel(mods) + `<p class="notice info">El Estado de resultados está apagado. Prendelo arriba para verlo.</p>`;
    const d = await loadYear(year), c = compute(d, year);
    cache = { d, c };
    if (sel == null || !c.months[sel]) sel = c.months.length - 1;
    const thisY = new Date().getFullYear();
    const chips = [thisY, thisY - 1].map((y) => `<button type="button" class="vt-chip ${y === year ? "on" : ""}" data-fin-year="${y}">${y}</button>`).join("");
    const t = c.tot, m = c.months[sel];
    const row = (x, label, cls = "") => `<tr class="${cls}" ${x.i != null ? `data-fin-month="${x.i}"` : ""}><td>${label}</td><td class="n">${money(r0(x.income))}</td>
      <td class="n">${c.hasCosts ? money(r0(x.cogs)) : "—"}</td><td class="n">${c.hasCosts ? signed(x.gross) : "—"}</td><td class="n">${money(r0(x.expenses))}</td><td class="n"><b>${c.hasCosts ? signed(x.net) : "—"}</b></td></tr>`;

    return `${modulesPanel(mods)}
      <div class="vt-bar-top">${chips}<button type="button" class="vt-chip vt-dl" id="finCsv" ${c.months.length ? "" : "disabled"}>⬇️ Descargar Excel</button></div>
      ${c.months.length ? `<div class="kpis">
        <div class="kpi"><small>Ingresos ${year}</small><strong>${money(r0(t.income))}</strong></div>
        <div class="kpi"><small>Ganancia bruta</small><strong>${c.hasCosts ? signed(t.gross) : "—"}</strong><span class="vt-delta">margen ${c.hasCosts ? pctOf(t.gross, t.income) : "—"}</span></div>
        <div class="kpi"><small>Gastos</small><strong>${money(r0(t.expenses))}</strong></div>
        <div class="kpi"><small>Resultado neto</small><strong>${c.hasCosts ? signed(t.net) : "—"}</strong><span class="vt-delta">${c.hasCosts ? pctOf(t.net, t.income) + " de los ingresos" : ""}</span></div>
      </div>
      ${t.noCost ? `<p class="notice info">⚠️ ${t.noCost} unidad${t.noCost === 1 ? "" : "es"} vendida${t.noCost === 1 ? "" : "s"} no tiene${t.noCost === 1 ? "" : "n"} costo cargado: el costo de lo vendido queda más bajo de lo real. Cargalo en <a href="#productos">Productos</a>.</p>` : ""}
      <div class="panel"><h3>Mes por mes</h3><div class="tbl-scroll"><table class="table fin-t">
        <tr><th>Mes</th><th class="n">Ingresos</th><th class="n">Costo de lo vendido</th><th class="n">Ganancia bruta</th><th class="n">Gastos</th><th class="n">Resultado</th></tr>
        ${c.months.map((x) => row(x, MES[x.i], x.i === sel ? "sel" : "")).join("")}
        ${row(t, `<b>Total ${year}</b>`, "fin-tot")}
      </table></div><p class="ed-hint">Tocá un mes para ver y cargar sus gastos.</p></div>
      <div class="panel" id="finMonth"><h3>Gastos de ${MES[m.i].toLowerCase()} ${year}</h3>
        <form class="fin-add" id="finAdd">
          <label class="field">Categoría<input name="category" list="finCats" maxlength="40" required placeholder="Ej: Publicidad"></label>
          <datalist id="finCats">${CATS.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
          <label class="field">Detalle (opcional)<input name="description" maxlength="200" placeholder="Ej: Instagram, Mercado Pago"></label>
          <label class="field">Monto ($)<input name="amount" inputmode="decimal" required placeholder="0"></label>
          <button class="btn" type="submit">Agregar gasto</button>
        </form>
        <p class="notice error" id="finErr" hidden></p>
        ${m.list.length ? `<div class="tbl-scroll"><table class="table"><tr><th>Categoría</th><th>Detalle</th><th class="n">Monto</th><th></th></tr>
          ${m.list.map((e) => `<tr><td>${esc(e.category)}</td><td>${esc(e.description || "—")}</td><td class="n">${money(e.amount)}</td><td><button type="button" class="link-btn" data-fin-del="${e.id}" aria-label="Borrar gasto ${esc(e.category)}">Borrar</button></td></tr>`).join("")}
          <tr class="fin-tot"><td colspan="2"><b>Total</b></td><td class="n"><b>${money(r0(m.expenses))}</b></td><td></td></tr></table></div>`
          : '<p class="ed-hint">Todavía no cargaste gastos de este mes.</p>'}
      </div>` : `<p class="ed-hint">Todavía no hay meses para mostrar en ${year}.</p>`}
      <p class="ed-hint">Ingresos = pedidos pagados del mes (por fecha de pago), con el envío cobrado. El costo de lo vendido usa el costo actual de cada producto (los costos en dólares se pasan con la cotización de hoy). Los gastos (publicidad, comisiones, envíos pagados, sueldos, impuestos…) se cargan a mano.</p>`;
  };

  A.views.resultados.after = () => {
    document.querySelectorAll("[data-fin-mod]").forEach((ch) => (ch.onchange = () => toggleModule(ch.dataset.finMod, ch.checked, ch)));
    document.querySelectorAll("[data-fin-year]").forEach((b) => (b.onclick = () => { year = Number(b.dataset.finYear); sel = null; A.route(); }));
    document.querySelectorAll("[data-fin-month]").forEach((tr) => (tr.onclick = () => { sel = Number(tr.dataset.finMonth); A.route().then(() => $("finMonth")?.scrollIntoView({ block: "nearest" })); }));
    document.querySelectorAll("[data-fin-del]").forEach((b) => (b.onclick = () => removeExpense(Number(b.dataset.finDel), b)));
    const f = $("finAdd"); if (f) f.onsubmit = (e) => { e.preventDefault(); addExpense(f); };
    const dl = $("finCsv"); if (dl) dl.onclick = download;
  };

  const fail = (msg) => { const e = $("finErr"); if (e) { e.hidden = false; e.textContent = msg; } };

  async function toggleModule(key, on, ch) {
    ch.disabled = true;
    try {
      if (A.demo) demo().modules[key] = on;
      else { const { error } = await sb().from("finance_modules").update({ enabled: on, updated_at: new Date().toISOString() }).eq("key", key); if (error) throw error; }
      await A.route();
    } catch (x) { ch.checked = !on; ch.disabled = false; A.alertView(x.message); }
  }

  async function addExpense(f) {
    const category = f.category.value.trim(), description = f.description.value.trim() || null, amount = num(f.amount.value);
    if (!category) return fail("Elegí o escribí una categoría.");
    if (!(amount > 0)) return fail("El monto tiene que ser mayor a 0.");
    const month = cache.c.months[sel].key + "-01";
    f.querySelector("button").disabled = true;
    try {
      if (A.demo) { const D = demo(); D.expenses.push({ id: Date.now(), month, category, description, amount }); }
      else { const { error } = await sb().from("expenses").insert({ month, category, description, amount }); if (error) throw error; }
      await A.route();
    } catch (x) { f.querySelector("button").disabled = false; fail(x.message); }
  }

  async function removeExpense(id, b) {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "¿Seguro? Tocá de nuevo"; return; }
    b.disabled = true;
    try {
      if (A.demo) { const D = demo(); D.expenses = D.expenses.filter((e) => e.id !== id); }
      else { const { error } = await sb().from("expenses").delete().eq("id", id); if (error) throw error; }
      await A.route();
    } catch (x) { b.disabled = false; fail(x.message); }
  }

  // Excel: archivo CSV con ";" (Excel en español lo abre directo con columnas separadas)
  function download() {
    if (!cache) return;
    const { c } = cache, q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const cats = [...new Set(c.months.flatMap((m) => Object.keys(m.byCat)))].sort();
    const head = ["Mes", "Ingresos", "Costo de lo vendido", "Ganancia bruta", ...cats.map((k) => `Gasto: ${k}`), "Total gastos", "Resultado neto"];
    const line = (label, x) => [label, r0(x.income), c.hasCosts ? r0(x.cogs) : "", c.hasCosts ? r0(x.gross) : "", ...cats.map((k) => r0((x.byCat || {})[k] || 0)), r0(x.expenses), c.hasCosts ? r0(x.net) : ""].map(q).join(";");
    const totCat = {}; c.months.forEach((m) => Object.entries(m.byCat).forEach(([k, v]) => (totCat[k] = (totCat[k] || 0) + v)));
    const rows = [head.map(q).join(";"), ...c.months.map((m) => line(`${MES[m.i]} ${year}`, m)), line(`Total ${year}`, { ...c.tot, byCat: totCat })];
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `estado-de-resultados-exe-${year}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
})();
