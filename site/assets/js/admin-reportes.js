// Panel → Reportes (permiso finance.manage; se prende en Estado de resultados → Módulos financieros).
// Dos reportes, a mano o automáticos (semanal / mensual, con email):
// · Resumen del negocio: ventas, ganancia bruta, gastos, resultado, lo más vendido, stock bajo y visitas.
// · Para ARCA: lo cobrado por mes y por día y por medio de pago; monotributo: últimos 12 meses contra el tope de
//   la categoría; responsable inscripto: neto e IVA débito estimados (21 %). Ayuda para el contador, no reemplaza facturas.
// Los datos los arma la base (report_generate); el email lo manda la función "reportes".
(() => {
  const A = window.EXE_ADMIN;
  const { esc, money, $ } = A;
  const sb = () => A.be.sb;
  const KINDS = { resumen: "📊 Resumen del negocio", arca: "🏛️ Ventas para ARCA" };
  const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const iso = (d) => d.toLocaleDateString("sv");
  const fdate = (s) => String(s).slice(0, 10).split("-").reverse().join("/");
  const r0 = (n) => Math.round(Number(n || 0));
  const num = (v) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  let kind = "resumen", period = "mes-pasado", from = "", to = "", shown = null, msg = "";

  function range() {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    if (period === "mes-pasado") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (period === "mes") return [iso(new Date(y, m, 1)), iso(now)];
    if (period === "semana") { const d = (now.getDay() + 6) % 7; return [iso(new Date(y, m, now.getDate() - d - 7)), iso(new Date(y, m, now.getDate() - d - 1))]; }
    if (period === "12m") return [iso(new Date(y, m - 11, 1)), iso(now)];
    return [from || iso(new Date(y, m, 1)), to || iso(now)];
  }

  /* ---------- Datos ---------- */
  function demo() {
    const D = A.DEMO;
    if (!D._rep) {
      const days = Array.from({ length: 14 }, (_, i) => ({ id: 2100 + i, d: `2026-09-${String(2 + i * 2).padStart(2, "0")}`, customer: ["Juan Pérez", "Ana Gómez", "Leo Díaz"][i % 3], total: 45000 + (i * 37000) % 300000, mp: i % 3 !== 2 }));
      D._rep = {
        modules: () => D._fin?.modules || { resultados: true, reportes: true },
        settings: [{ kind: "resumen", enabled: true, frequency: "semanal", recipients: ["ventas@exe.com.ar"], arca_regime: "monotributo", monotributo_limit: null },
          { kind: "arca", enabled: true, frequency: "mensual", recipients: ["ventas@exe.com.ar", "contador@mail.com"], arca_regime: "monotributo", monotributo_limit: 26000000 }],
        sample: {
          resumen: { income: 2350000, orders: 18, cogs: 1610000, no_cost_units: 1, expenses: 260000, expenses_by_cat: { Publicidad: 180000, "Comisiones de cobro": 80000 },
            top: [{ name: "Smartwatch S8", qty: 6, sale: 594000 }, { name: "Auriculares inalámbricos Pro", qty: 7, sale: 490000 }], low_stock: [{ name: "Cooler DeepCool AG400 PLUS", stock: 0 }], visits: 1240, people: 830 },
          arca: { regime: "monotributo", limit: 26000000, income: days.reduce((s, x) => s + x.total, 0), orders: days.length, mp: days.filter((x) => x.mp).reduce((s, x) => s + x.total, 0),
            manual: days.filter((x) => !x.mp).reduce((s, x) => s + x.total, 0), by_month: [{ m: "2026-09", n: days.length, t: days.reduce((s, x) => s + x.total, 0) }], days, last12: 21400000 },
        },
        reports: [],
      };
      D._rep.reports.push({ id: 1, kind: "arca", period_from: "2026-09-01", period_to: "2026-09-30", auto: true, emailed_at: "2026-10-01T12:05:00Z", created_at: "2026-10-01T12:05:00Z", data: D._rep.sample.arca },
        { id: 2, kind: "resumen", period_from: "2026-10-13", period_to: "2026-10-19", auto: true, email_error: "Falta configurar el envío de emails (clave de Resend)", created_at: "2026-10-20T12:05:00Z", data: D._rep.sample.resumen });
    }
    return D._rep;
  }

  async function load() {
    if (A.demo) { const d = demo(); return { mods: d.modules(), settings: d.settings, reports: [...d.reports].sort((a, b) => b.id - a.id) }; }
    const [m, s, r] = await Promise.all([
      sb().from("finance_modules").select("key, enabled"),
      sb().from("report_settings").select("*").order("kind"),
      sb().from("reports").select("*").order("created_at", { ascending: false }).limit(30),
    ]);
    for (const x of [m, s, r]) if (x.error) throw x.error;
    return { mods: Object.fromEntries((m.data || []).map((x) => [x.key, x.enabled])), settings: s.data || [], reports: r.data || [] };
  }

  /* ---------- Cómo se ve un reporte ---------- */
  function view(r) {
    const d = r.data || {}, row = (k, v, b) => `<tr><td>${k}</td><td class="n">${b ? `<b>${v}</b>` : v}</td></tr>`;
    let html;
    if (r.kind === "resumen") {
      const gross = d.income - d.cogs, net = gross - d.expenses;
      html = `<div class="vt-grid"><div class="panel"><h3>Números</h3><table class="table">${row("Ventas (pedidos pagados)", money(r0(d.income)))}${row("Pedidos", d.orders)}
          ${row("Costo de lo vendido", money(r0(d.cogs)))}${row("Ganancia bruta", money(r0(gross)))}${row("Gastos cargados", money(r0(d.expenses)))}${row("Resultado", money(r0(net)), true)}
          ${row("Visitas / personas", `${d.visits} / ${d.people}`)}</table>
          ${d.no_cost_units ? `<p class="notice info">⚠️ ${d.no_cost_units} unidad${d.no_cost_units === 1 ? "" : "es"} vendida${d.no_cost_units === 1 ? "" : "s"} sin costo cargado.</p>` : ""}</div>
        <div class="panel"><h3>Lo más vendido</h3>${(d.top || []).length ? `<ul class="rp-list">${d.top.map((t) => `<li>${esc(t.name)} — ${t.qty} u. · ${money(r0(t.sale))}</li>`).join("")}</ul>` : '<p class="ed-hint">Sin ventas.</p>'}
          <h3>Stock bajo</h3>${(d.low_stock || []).length ? `<ul class="rp-list">${d.low_stock.map((p) => `<li>${esc(p.name)} — ${p.stock > 0 ? `quedan ${p.stock}` : "sin stock"}</li>`).join("")}</ul>` : '<p class="ed-hint">Todo con stock.</p>'}</div></div>`;
    } else {
      const mono = d.regime === "monotributo", used = d.limit ? Math.round((d.last12 / d.limit) * 100) : null;
      html = `<div class="vt-grid"><div class="panel"><h3>${mono ? "Monotributo" : "Responsable inscripto"}</h3><table class="table">${row("Total cobrado", money(r0(d.income)), true)}${row("Operaciones", d.orders)}
          ${row("Por Mercado Pago", money(r0(d.mp)))}${row("Transferencia / efectivo", money(r0(d.manual)))}
          ${mono ? row("Últimos 12 meses", money(r0(d.last12))) + (d.limit ? row("Tope de tu categoría", `${money(r0(d.limit))} · usado ${used}%`) : "")
            : row("Neto gravado (estimado, IVA 21%)", money(r0(d.income / 1.21))) + row("IVA débito (estimado)", money(r0(d.income - d.income / 1.21)))}</table>
          ${mono && used != null && used >= 80 ? `<p class="notice info">⚠️ Usaste el ${used}% del tope de tu categoría en los últimos 12 meses: revisá la recategorización con tu contador.</p>` : ""}
          ${mono && !d.limit ? '<p class="ed-hint">Cargá el tope anual de tu categoría abajo, en "Automáticos", para ver cuánto usaste.</p>' : ""}</div>
        <div class="panel"><h3>Por mes</h3>${(d.by_month || []).length ? `<table class="table">${d.by_month.map((m) => row(`${MES[Number(m.m.slice(5)) - 1]} ${m.m.slice(0, 4)} (${m.n} op.)`, money(r0(m.t)))).join("")}</table>` : '<p class="ed-hint">Sin ventas.</p>'}
          <p class="ed-hint">El detalle día por día (libro de ventas) está en "Descargar Excel".</p></div></div>
        <p class="ed-hint">Ayuda para tu contador: no reemplaza facturas ni declaraciones juradas. Cuenta pedidos pagados por fecha de pago, con el envío cobrado.</p>`;
    }
    return `<div class="panel rp-show" id="rpShow"><h3>${KINDS[r.kind]} · ${fdate(r.period_from)} al ${fdate(r.period_to)}</h3>
      <div class="vt-bar-top"><button type="button" class="vt-chip" data-rp-csv="${r.id}">⬇️ Descargar Excel</button><button type="button" class="vt-chip" data-rp-mail="${r.id}">✉️ Enviar por email</button></div>${html}</div>`;
  }

  const state = (r) => r.emailed_at ? `✔ Enviado ${fdate(r.emailed_at)}` : r.email_error ? `<span class="fin-neg" title="${esc(r.email_error)}">✖ ${esc(r.email_error)}</span>` : r.auto ? "Pendiente de envío" : "No enviado";

  A.views.reportes = async function () {
    const { mods, settings, reports } = await load();
    if (!mods.reportes) return `<p class="notice info">Los reportes están apagados. Prendelos en <a href="#resultados">📒 Estado de resultados</a> → Módulos financieros.</p>`;
    const [f, t] = range();
    const chips = [["mes-pasado", "Mes pasado"], ["mes", "Este mes"], ["semana", "Semana pasada"], ["12m", "Últimos 12 meses"]]
      .map(([k, v]) => `<button type="button" class="vt-chip ${period === k ? "on" : ""}" data-rp-period="${k}">${v}</button>`).join("");
    const cur = shown && reports.find((r) => r.id === shown);
    const S = (k) => settings.find((s) => s.kind === k) || { kind: k, recipients: [] };
    const auto = (k) => { const s = S(k); return `<form class="panel rp-auto" data-rp-set="${k}"><h3>${KINDS[k]}</h3>
      <label class="ed-check"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> <b>Automático</b></label>
      <div class="fin-add"><label class="field">Cada<select name="frequency"><option value="semanal" ${s.frequency === "semanal" ? "selected" : ""}>Semana (los lunes, la semana anterior)</option><option value="mensual" ${s.frequency !== "semanal" ? "selected" : ""}>Mes (el día 1, el mes anterior)</option></select></label>
        <label class="field">Enviar a (hasta 5, separados por coma)<input name="recipients" value="${esc((s.recipients || []).join(", "))}" placeholder="Si lo dejás vacío: ventas@exe.com.ar"></label>
        ${k === "arca" ? `<label class="field">Régimen<select name="arca_regime"><option value="monotributo" ${s.arca_regime !== "responsable_inscripto" ? "selected" : ""}>Monotributo</option><option value="responsable_inscripto" ${s.arca_regime === "responsable_inscripto" ? "selected" : ""}>Responsable inscripto</option></select></label>
        <label class="field">Tope anual de tu categoría ($, monotributo)<input name="monotributo_limit" inputmode="numeric" value="${esc(s.monotributo_limit ?? "")}" placeholder="Ej: 26000000"></label>` : ""}
        <button class="btn" type="submit">Guardar</button></div></form>`; };

    return `<p class="ed-hint" style="margin-top:0">Generá un reporte cuando quieras o dejalo automático: se arma solo y se manda por email. Todos quedan en el historial.</p>
      ${msg ? `<p class="notice info">${esc(msg)}</p>` : ""}
      <div class="panel"><h3>Generar ahora</h3>
        <div class="vt-bar-top">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="vt-chip ${kind === k ? "on" : ""}" data-rp-kind="${k}">${v}</button>`).join("")}</div>
        <div class="vt-bar-top">${chips}<button type="button" class="vt-chip ${period === "fechas" ? "on" : ""}" data-rp-period="fechas">📅 Elegir fechas</button>
          <span class="vt-dates" ${period === "fechas" ? "" : "hidden"}><label>Desde <input type="date" id="rpFrom" value="${f}"></label><label>Hasta <input type="date" id="rpTo" value="${t}"></label></span></div>
        <p class="ed-hint">Período: ${fdate(f)} al ${fdate(t)}</p>
        <button type="button" class="btn" id="rpGo">Generar reporte</button></div>
      ${cur ? view(cur) : ""}
      <h3 class="rp-h">Automáticos</h3><div class="vt-grid">${auto("resumen")}${auto("arca")}</div>
      <p class="ed-hint">Se arman a las 9 de la mañana. Para que lleguen por email tiene que estar configurado Resend en Supabase; si no, quedan igual en el historial.</p>
      <div class="panel"><h3>Historial</h3>${reports.length ? `<div class="tbl-scroll"><table class="table"><tr><th>Creado</th><th>Reporte</th><th>Período</th><th>Cómo</th><th>Email</th><th></th></tr>
        ${reports.map((r) => `<tr><td>${fdate(r.created_at)}</td><td>${KINDS[r.kind]}</td><td>${fdate(r.period_from)} al ${fdate(r.period_to)}</td><td>${r.auto ? "Automático" : "A mano"}</td><td>${state(r)}</td>
          <td><button type="button" class="link-btn" data-rp-show="${r.id}">Ver</button></td></tr>`).join("")}</table></div>` : '<p class="ed-hint">Todavía no hay reportes.</p>'}</div>`;
  };

  A.views.reportes.after = () => {
    msg = "";
    document.querySelectorAll("[data-rp-kind]").forEach((b) => (b.onclick = () => { kind = b.dataset.rpKind; A.route(); }));
    document.querySelectorAll("[data-rp-period]").forEach((b) => (b.onclick = () => { if (b.dataset.rpPeriod === "fechas") [from, to] = range(); period = b.dataset.rpPeriod; A.route(); }));
    const f = $("rpFrom"), t = $("rpTo"); if (f && t) f.onchange = t.onchange = () => { from = f.value; to = t.value; A.route(); };
    const go = $("rpGo"); if (go) go.onclick = () => generate(go);
    document.querySelectorAll("[data-rp-show]").forEach((b) => (b.onclick = () => { shown = Number(b.dataset.rpShow); A.route().then(() => $("rpShow")?.scrollIntoView({ block: "start" })); }));
    document.querySelectorAll("[data-rp-csv]").forEach((b) => (b.onclick = () => download(Number(b.dataset.rpCsv))));
    document.querySelectorAll("[data-rp-mail]").forEach((b) => (b.onclick = () => mail(Number(b.dataset.rpMail), b)));
    document.querySelectorAll("[data-rp-set]").forEach((fm) => (fm.onsubmit = (e) => { e.preventDefault(); save(fm); }));
  };

  async function generate(btn) {
    const [f, t] = range();
    if (f > t) return A.alertView("La fecha \"desde\" es posterior a \"hasta\".");
    btn.disabled = true;
    try {
      if (A.demo) { const D = demo(); const id = Date.now(); D.reports.push({ id, kind, period_from: f, period_to: t, auto: false, created_at: new Date().toISOString(), data: D.sample[kind] }); shown = id; }
      else { const { data, error } = await sb().rpc("report_generate", { p_kind: kind, p_from: f, p_to: t }); if (error) throw error; shown = data; }
      await A.route(); $("rpShow")?.scrollIntoView({ block: "start" });
    } catch (x) { btn.disabled = false; A.alertView(x.message); }
  }

  async function mail(id, btn) {
    btn.disabled = true; btn.textContent = "Enviando…";
    try {
      if (A.demo) { msg = "Modo demo: acá se mandaría el reporte por email."; }
      else {
        const { data: { session } } = await sb().auth.getSession();
        const r = await fetch(`${window.SITE_CONFIG.supabaseUrl}/functions/v1/reportes`, { method: "POST",
          headers: { "Content-Type": "application/json", apikey: window.SITE_CONFIG.supabaseAnonKey, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "send", id }) });
        const d = await r.json().catch(() => ({}));
        msg = r.ok ? "Reporte enviado por email." : `No se pudo enviar: ${d.error || r.status}`;
      }
      await A.route();
    } catch (x) { btn.disabled = false; btn.textContent = "✉️ Enviar por email"; A.alertView(x.message); }
  }

  async function save(fm) {
    const k = fm.dataset.rpSet;
    const recipients = fm.recipients.value.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (recipients.length > 5) return A.alertView("Hasta 5 destinatarios.");
    const bad = recipients.find((x) => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x)); if (bad) return A.alertView(`"${bad}" no es un email válido.`);
    const row = { enabled: fm.enabled.checked, frequency: fm.frequency.value, recipients };
    if (k === "arca") { row.arca_regime = fm.arca_regime.value; const l = num(fm.monotributo_limit.value); row.monotributo_limit = l > 0 ? l : null; }
    fm.querySelector("button").disabled = true;
    try {
      if (A.demo) Object.assign(demo().settings.find((s) => s.kind === k), row);
      else { const { error } = await sb().from("report_settings").update(row).eq("kind", k); if (error) throw error; }
      msg = `Guardado: ${KINDS[k]}${row.enabled ? ` automático cada ${row.frequency === "semanal" ? "semana" : "mes"}` : " (automático apagado)"}.`;
      await A.route();
    } catch (x) { fm.querySelector("button").disabled = false; A.alertView(x.message); }
  }

  // Excel: archivo CSV con ";" (Excel en español lo abre directo con columnas separadas)
  async function download(id) {
    const r = A.demo ? demo().reports.find((x) => x.id === id) : (await sb().from("reports").select("*").eq("id", id).single()).data;
    if (!r) return;
    const d = r.data || {}, q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`, rows = [];
    if (r.kind === "arca") {
      rows.push(["Fecha", "Pedido", "Cliente", "Medio de pago", "Total cobrado", ...(d.regime === "responsable_inscripto" ? ["Neto gravado (est.)", "IVA 21% (est.)"] : [])]);
      for (const x of d.days || []) rows.push([fdate(x.d), x.id, x.customer, x.mp ? "Mercado Pago" : "Transferencia / efectivo", r0(x.total), ...(d.regime === "responsable_inscripto" ? [r0(x.total / 1.21), r0(x.total - x.total / 1.21)] : [])]);
      rows.push([], ["Total", "", "", "", r0(d.income)]);
    } else {
      rows.push(["Concepto", "Monto"], ["Ventas", r0(d.income)], ["Pedidos", d.orders], ["Costo de lo vendido", r0(d.cogs)], ["Ganancia bruta", r0(d.income - d.cogs)],
        ...Object.entries(d.expenses_by_cat || {}).map(([k, v]) => [`Gasto: ${k}`, r0(v)]), ["Gastos", r0(d.expenses)], ["Resultado", r0(d.income - d.cogs - d.expenses)], ["Visitas", d.visits], ["Personas", d.people]);
    }
    const blob = new Blob(["﻿" + rows.map((x) => x.map(q).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${r.kind === "arca" ? "ventas-arca" : "resumen"}-exe-${r.period_from}-al-${r.period_to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
})();
