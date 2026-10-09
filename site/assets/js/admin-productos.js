// Panel → Productos: listado con edición rápida, editor completo (fotos, descripción, especificaciones,
// costo / margen / precio, stock, referencias) y herramientas masivas.
// Seguridad: todo pasa por Supabase con la sesión del usuario; RLS decide qué puede leer/escribir
// (products.write = todo; stock.write = solo stock/visibilidad). Costos y referencias: solo products.write.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, money, $ } = A;
  const sb = () => A.be.sb;
  const can = (p) => A.perms.has(p);
  const BUCKET = "productos";
  const DEFAULT_MARGIN = 50;                                     // % sugerido para productos nuevos
  const round100 = (n) => Math.round(n / 100) * 100;
  const pct = (n) => (isFinite(n) ? `${Math.round(n)} %` : "—");
  const num = (v) => { const n = Number(String(v).replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const imgUrl = (src) => (!src ? "" : /^https?:/.test(src) ? src : `../${src}`);   // rutas relativas del sitio

  /* ---------- Datos ---------- */
  let cache = null;                      // { products, costs: Map, sources: Map }
  let fx = null;                         // fila de fx_settings (cotización vigente)
  const rate = () => (A.demo ? 1500 : Number(fx && fx.effective_rate) || 0);
  const usd = (n) => "US$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const demoStore = () => {
    const d = A.DEMO;
    if (!d._full) {
      d._full = {
        products: [
          { id: "demo-rtx-3060", name: "Placa de Video RTX 3060 12GB (demo)", brand: "MSI", category: "Placas de video", description: "Producto de ejemplo.", price: 450000, stock: 3, show_stock: true, active: true, outlet: false, condition: null, images: ["assets/img/products/asus-gtx1660-01.webp"], specs: [{ title: "Memoria", rows: [["Capacidad", "12 GB"]] }], weight_kg: 1, sort: 0 },
          { id: "demo-cooler", name: "Cooler de ejemplo (demo)", brand: "DeepCool", category: "Refrigeración", description: "", price: 0, stock: 999, show_stock: false, active: false, outlet: true, condition: "Sin caja", images: [], specs: [], weight_kg: 1, sort: 1 },
        ],
        costs: new Map([["demo-rtx-3060", { product_id: "demo-rtx-3060", cost: 300000, supplier: "Proveedor X", notes: "" }]]),
        sources: new Map(),
      };
    }
    return d._full;
  };
  async function loadAll(force) {
    if (A.demo) return (cache = demoStore());
    if (cache && !force) return cache;
    const cols = "id,name,brand,category,tags,description,price,price_usd,stock,show_stock,active,outlet,condition,image,images,specs,weight_kg,location,sort,variants,updated_at,ask_price,ask_stock,cart_ok,hide_no_stock";
    const fxr = await sb().from("fx_settings").select("*").eq("id", 1).maybeSingle();
    fx = fxr.data || null;
    const [p, c, s] = await Promise.all([
      sb().from("products").select(cols).order("sort").order("name"),
      can("products.write") ? sb().from("product_costs").select("*") : { data: [] },
      can("products.write") ? sb().from("product_sources").select("*").order("ref_price") : { data: [] },
    ]);
    if (p.error) throw p.error;
    const sources = new Map();
    (s.data || []).forEach((r) => { if (!sources.has(r.product_id)) sources.set(r.product_id, []); sources.get(r.product_id).push(r); });
    cache = { products: p.data, costs: new Map((c.data || []).map((r) => [r.product_id, r])), sources };
    return cache;
  }
  const margin = (price, cost) => (cost > 0 && price > 0 ? ((price - cost) / cost) * 100 : NaN);

  async function saveProduct(prod, cost) {
    if (A.demo) {
      const st = demoStore(); const i = st.products.findIndex((x) => x.id === prod.id);
      if (i >= 0) st.products[i] = { ...st.products[i], ...prod }; else st.products.push(prod);
      if (cost) st.costs.set(prod.id, { product_id: prod.id, ...cost });
      return;
    }
    const { error } = await sb().from("products").upsert({ ...prod, image: (prod.images || [])[0] || null, updated_at: new Date().toISOString() });
    if (error) throw error;
    if (cost && can("products.write")) {
      const r = await sb().from("product_costs").upsert({ product_id: prod.id, ...cost, updated_at: new Date().toISOString() });
      if (r.error) throw r.error;
    }
  }
  async function patchProduct(id, fields) {
    if (A.demo) { Object.assign(demoStore().products.find((x) => x.id === id), fields); return; }
    const { error } = await sb().from("products").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    const p = cache && cache.products.find((x) => x.id === id); if (p) Object.assign(p, fields);
  }

  // Opciones de venta por producto (se ven en la tabla, el editor y las acciones masivas)
  const FLAGS = [
    ["ask_price", "💲", "Consultar precio", "Muestra \"Consultar precio\" en vez del precio"],
    ["ask_stock", "📦", "Consultar stock", "Muestra \"Consultar stock\" en vez del stock (con los dos: \"Consultar precio y stock\")"],
    ["cart_ok", "🛒", "Carrito sin precio/stock", "Se puede agregar al carrito aunque no tenga precio o stock (si no, solo \"Consultar por WhatsApp\")"],
    ["hide_no_stock", "🙈", "Ocultar sin stock", "No se muestra en la tienda cuando el stock llega a 0"],
  ];
  // Acciones masivas agrupadas por tema (con buscador): fácil de encontrar para cualquier empleado
  const BULK_GROUPS = [
    { icon: "💲", name: "Precio", items: [
      ["pct", "Subir o bajar un %", "Ej: +10 sube 10 %, -5 baja 5 %"], ["amt", "Sumar o restar un monto", "En la moneda de cada producto"],
      ["set", "Fijar un precio", "El mismo precio para todos"], ["round", "Redondear precios", "A $100 o al número que elijas"],
      ["margin", "Aplicar margen sobre el costo", "Precio = costo + margen %"], ["ref", "Precio = referencia + %", "Desde el precio de compra de referencia"],
      ["consult", "Poner \"a consultar\"", "Precio 0: se consulta por WhatsApp"]] },
    { icon: "💱", name: "Moneda de venta", items: [
      ["toars", "Vender en pesos", "Convierte con la cotización vigente"], ["tousd", "Vender en dólares", "El precio en pesos sigue al dólar solo"]] },
    { icon: "👁", name: "Visibilidad", items: [
      ["on", "Mostrar en la tienda", "Activa los productos"], ["off", "Ocultar de la tienda", "Desactiva los productos"],
      ["hide_no_stock:1", "Ocultar cuando no hay stock", ""], ["hide_no_stock:0", "Mostrar aunque no haya stock", ""]] },
    { icon: "💬", name: "Consultas y carrito", items: [
      ["ask_price:1", "Mostrar \"Consultar precio\"", "En vez del precio"], ["ask_price:0", "Mostrar el precio", "Quita \"Consultar precio\""],
      ["ask_stock:1", "Mostrar \"Consultar stock\"", "En vez del stock"], ["ask_stock:0", "Mostrar el stock", "Quita \"Consultar stock\""],
      ["cart_ok:1", "Permitir carrito sin precio/stock", ""], ["cart_ok:0", "Solo \"Consultar por WhatsApp\"", "Si no tiene precio o stock"]] },
    { icon: "🏷", name: "Etiquetas", items: [["tagadd", "Agregar una etiqueta", ""], ["tagrm", "Quitar una etiqueta", ""]] },
  ];
  const bkItem = ([k, t, d]) => `<button type="button" role="menuitem" data-bulk="${k}"><b>${esc(t)}</b>${d ? `<small>${esc(d)}</small>` : ""}</button>`;
  const flagOn = (p, f) => (f === "cart_ok" ? p.cart_ok !== false : !!p[f]);

  /* ---------- Listado ---------- */
  const listState = { q: "", cat: "", filter: "", brand: "", tag: "", pmin: "", pmax: "", cur: "", sel: new Set() };
  A.subviews.editar = { perm: "products.read", parent: "productos", title: (args) => (args[0] === "nuevo" ? "Nuevo producto" : "Editar producto") };

  A.views.productos = async function () {
    const { products, costs } = await loadAll(true);
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    const w = can("products.write");
    const stats = {
      activos: products.filter((p) => p.active).length,
      inactivos: products.filter((p) => !p.active).length,
      sinFoto: products.filter((p) => !(p.images || []).length).length,
      sinPrecio: products.filter((p) => !(p.price > 0)).length,
      sinStock: products.filter((p) => p.show_stock && p.stock <= 0).length,
      valor: products.reduce((n, p) => n + (p.show_stock ? p.stock : 0) * ((costs.get(p.id) || {}).cost || 0), 0),
    };
    return `
      <div class="kpis">
        <div class="kpi"><small>Productos activos</small><strong>${stats.activos}</strong></div>
        <div class="kpi"><small>Inactivos</small><strong>${stats.inactivos}</strong></div>
        <div class="kpi"><small>Sin foto</small><strong>${stats.sinFoto}</strong></div>
        <div class="kpi"><small>A consultar (sin precio)</small><strong>${stats.sinPrecio}</strong></div>
        ${w ? `<div class="kpi"><small>Inventario a costo</small><strong>${money(stats.valor)}</strong></div>` : ""}
      </div>
      <div class="pr-toolbar">
        ${w ? `<a class="btn btn-primary" href="#editar/nuevo">＋ Nuevo producto</a>` : ""}
        <input type="search" id="prQ" placeholder="Buscar por nombre, marca, código o etiqueta…" value="${esc(listState.q)}">
        <select id="prCat"><option value="">Todas las categorías</option>${cats.map((c) => `<option ${c === listState.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="prFilter">
          ${[["", "Todos"], ["activos", "Activos"], ["inactivos", "Inactivos"], ["outlet", "Outlet"], ["sinfoto", "Sin foto"], ["sinprecio", "Sin precio"], ["sinstock", "Sin stock"], ["constock", "Con stock"], ["sincosto", "Sin costo cargado"], ["f:ask_price", "💲 Consultar precio"], ["f:ask_stock", "📦 Consultar stock"], ["nocart", "🛒 Sin carrito (solo WhatsApp)"], ["f:hide_no_stock", "🙈 Se ocultan sin stock"]]
            .map(([v, t]) => `<option value="${v}" ${v === listState.filter ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <button class="btn btn-outline" id="prCsv" type="button">⬇ Exportar CSV</button>
      </div>
      <details class="pr-adv" ${listState.brand || listState.tag || listState.pmin || listState.pmax || listState.cur ? "open" : ""}><summary>Más filtros</summary>
        <div class="pr-adv-grid">
          <select id="prBrand"><option value="">Todas las marcas</option>${[...new Set(products.map((p) => p.brand).filter(Boolean))].sort().map((b) => `<option ${b === listState.brand ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
          <select id="prTag"><option value="">Todas las etiquetas</option>${[...new Set(products.flatMap((p) => p.tags || []))].sort().map((t) => `<option ${t === listState.tag ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
          <select id="prCur"><option value="">Pesos y dólares</option><option value="ars" ${listState.cur === "ars" ? "selected" : ""}>Solo en pesos</option><option value="usd" ${listState.cur === "usd" ? "selected" : ""}>Solo en dólares</option></select>
          <input id="prPmin" inputmode="numeric" placeholder="Precio desde $" value="${esc(listState.pmin)}">
          <input id="prPmax" inputmode="numeric" placeholder="Precio hasta $" value="${esc(listState.pmax)}">
          <button class="link-btn" id="prClearF" type="button">Limpiar filtros</button>
        </div>
      </details>
      <div class="pr-selbar"><span id="prCount"></span> <button class="link-btn" id="prSelAll" type="button">Seleccionar todos los filtrados</button></div>
      <div class="pr-bulk" id="prBulk" hidden>
        <b id="prBulkN"></b>
        ${w ? `<input type="search" class="pr-in bk-search" id="bkSearch" placeholder="🔍 Buscar acción (ej: dólares, etiqueta, ocultar…)" aria-label="Buscar una acción para los seleccionados">
        ${BULK_GROUPS.map((g, i) => `<div class="bk-group"><button type="button" class="btn btn-outline bk-toggle" data-bk-open="${i}" aria-expanded="false" aria-haspopup="true">${g.icon} ${g.name} ▾</button>
          <div class="bk-menu" hidden role="menu">${g.items.map(bkItem).join("")}</div></div>`).join("")}
        <button class="btn btn-outline danger" data-bulk="delete">🗑 Eliminar</button>
        <div class="bk-menu bk-results" id="bkResults" hidden role="menu"></div>` : ""}
        <button class="link-btn" data-bulk="clear">Quitar selección</button>
      </div>
      <div class="panel pr-table-wrap"><table class="table pr-table">
        <thead><tr><th><input type="checkbox" id="prAll" aria-label="Seleccionar todos"></th><th></th><th>Producto</th><th>Categoría</th>
          ${w ? "<th>Costo</th>" : ""}<th>Venta</th>${w ? "<th>Margen</th>" : ""}<th>Stock</th><th>Activo</th><th title="Opciones de venta">Opciones</th><th></th></tr></thead>
        <tbody id="prRows"></tbody></table></div>
      <p class="notice info">Tip: el precio y el stock se editan directo en la tabla (se guarda al salir del campo). "0" en venta = <b>Consultar precio por WhatsApp</b>. El costo solo lo ven los administradores.</p>`;
  };
  A.views.productos.after = () => { renderRows(); bindList(); };

  function visible() {
    const { products, costs } = cache;
    const q = listState.q.toLowerCase();
    return products.filter((p) => {
      if (q && !`${p.name} ${p.brand || ""} ${p.id} ${(p.tags || []).join(" ")}`.toLowerCase().includes(q)) return false;
      if (listState.cat && p.category !== listState.cat) return false;
      if (listState.brand && p.brand !== listState.brand) return false;
      if (listState.tag && !(p.tags || []).includes(listState.tag)) return false;
      if (listState.cur === "usd" && p.price_usd == null) return false;
      if (listState.cur === "ars" && p.price_usd != null) return false;
      if (listState.pmin && !(p.price >= num(listState.pmin))) return false;
      if (listState.pmax && !(p.price > 0 && p.price <= num(listState.pmax))) return false;
      if (listState.filter.startsWith("f:")) return !!p[listState.filter.slice(2)];
      switch (listState.filter) {
        case "constock": return !p.show_stock || p.stock > 0; case "nocart": return p.cart_ok === false;
        case "activos": return p.active; case "inactivos": return !p.active; case "outlet": return p.outlet;
        case "sinfoto": return !(p.images || []).length; case "sinprecio": return !(p.price > 0);
        case "sinstock": return p.show_stock && p.stock <= 0; case "sincosto": return !((costs.get(p.id) || {}).cost > 0);
        default: return true;
      }
    });
  }
  function renderRows() {
    const w = can("products.write"), sw = w || can("stock.write");
    const rows = visible();
    $("prRows").innerHTML = rows.map((p) => {
      const c = (cache.costs.get(p.id) || {}).cost;
      const m = margin(p.price, c);
      return `<tr data-id="${esc(p.id)}" class="${p.active ? "" : "is-off"}">
        <td><input type="checkbox" data-sel ${listState.sel.has(p.id) ? "checked" : ""} aria-label="Seleccionar"></td>
        <td>${(p.images || [])[0] ? `<img class="pr-thumb" src="${esc(imgUrl(p.images[0]))}" alt="" loading="lazy">` : `<span class="pr-thumb pr-nophoto" title="Sin foto">📷</span>`}</td>
        <td><a href="#editar/${encodeURIComponent(p.id)}" class="pr-name">${esc(p.name)}</a>
          <small class="pr-meta">${esc(p.brand || "")}${p.outlet ? ` · <span class="pill pending">Outlet</span>` : ""}${p.condition ? ` · ${esc(p.condition)}` : ""}</small>
          ${(p.tags || []).length ? `<small class="pr-meta">🏷 ${p.tags.map(esc).join(", ")}</small>` : ""}</td>
        <td>${esc(p.category || "—")}</td>
        ${w ? `<td><input class="pr-in" data-f="cost" inputmode="numeric" value="${c ?? ""}" placeholder="—"></td>` : ""}
        <td>${p.price_usd != null
          ? (w ? `<input class="pr-in" data-f="price_usd" inputmode="decimal" value="${p.price_usd}" title="Precio en dólares"><small class="pr-meta">US$ → ${p.price ? money(p.price) : "sin cotización"}</small>` : `${usd(p.price_usd)}<small class="pr-meta">${money(p.price)}</small>`)
          : (w ? `<input class="pr-in" data-f="price" inputmode="numeric" value="${p.price || 0}">` : (p.price ? money(p.price) : "Consultar"))}
          ${w ? `<button type="button" class="pr-curbtn" data-curswap title="Cambiar la moneda de venta de este producto">${p.price_usd != null ? "US$ → $" : "$ → US$"}</button>` : ""}</td>
        ${w ? `<td class="${m < 15 ? "pr-low" : ""}">${pct(m)}</td>` : ""}
        <td>${sw ? `<input class="pr-in pr-in-sm" data-f="stock" inputmode="numeric" value="${p.show_stock ? p.stock : ""}" placeholder="∞" title="Vacío = sin control de stock">` : (p.show_stock ? p.stock : "∞")}</td>
        <td>${sw ? `<label class="switch"><input type="checkbox" data-f="active" ${p.active ? "checked" : ""}><span></span></label>` : (p.active ? "Sí" : "No")}</td>
        <td class="pr-flags">${FLAGS.map(([f, ic, n, d]) => `<button type="button" class="pr-flag ${flagOn(p, f) ? "on" : ""}" data-flag="${f}" title="${esc(n + ": " + d)}" aria-pressed="${flagOn(p, f)}" ${w ? "" : "disabled"}>${ic}</button>`).join("")}</td>
        <td class="pr-actions"><a href="#editar/${encodeURIComponent(p.id)}" title="Editar">✏️</a>${w ? `<button class="link-btn" data-dup title="Duplicar">⧉</button>` : ""}<a class="pr-view" href="../index.html#producto/${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="${p.active ? "Ver el producto como lo ve un cliente" : "Está oculto: los clientes no lo ven. Activalo para verlo en la tienda."}">👁 Ver</a></td>
      </tr>`;
    }).join("") || `<tr><td colspan="11" class="pr-empty">No hay productos con ese filtro.</td></tr>`;
    $("prCount").textContent = `${rows.length} de ${cache.products.length} productos`;
    updateBulk();
  }
  function updateBulk() {
    $("prBulk").hidden = !listState.sel.size;
    $("prBulkN").textContent = `${listState.sel.size} seleccionado${listState.sel.size === 1 ? "" : "s"}`;
    const all = $("prAll"); const vis = visible();
    if (all) all.checked = vis.length > 0 && vis.every((p) => listState.sel.has(p.id));
  }
  function flash(el, ok) { el.classList.remove("ok", "err"); void el.offsetWidth; el.classList.add(ok ? "ok" : "err"); }

  function bindList() {
    $("prQ").oninput = (e) => { listState.q = e.target.value; renderRows(); };
    $("prCat").onchange = (e) => { listState.cat = e.target.value; renderRows(); };
    $("prFilter").onchange = (e) => { listState.filter = e.target.value; renderRows(); };
    $("prAll").onchange = (e) => { visible().forEach((p) => (e.target.checked ? listState.sel.add(p.id) : listState.sel.delete(p.id))); renderRows(); };
    $("prCsv").onclick = exportCsv;
    [["prBrand", "brand"], ["prTag", "tag"], ["prCur", "cur"]].forEach(([i, k]) => ($(i).onchange = (e) => { listState[k] = e.target.value; renderRows(); }));
    [["prPmin", "pmin"], ["prPmax", "pmax"]].forEach(([i, k]) => ($(i).oninput = (e) => { listState[k] = e.target.value; renderRows(); }));
    $("prClearF").onclick = () => { Object.assign(listState, { q: "", cat: "", filter: "", brand: "", tag: "", pmin: "", pmax: "", cur: "" }); A.route(); };
    $("prSelAll").onclick = () => { visible().forEach((p) => listState.sel.add(p.id)); renderRows(); };
    const tbody = $("prRows");
    tbody.addEventListener("change", async (e) => {
      const tr = e.target.closest("tr[data-id]"); if (!tr) return;
      const id = tr.dataset.id, t = e.target;
      if (t.matches("[data-sel]")) { t.checked ? listState.sel.add(id) : listState.sel.delete(id); return updateBulk(); }
      const f = t.dataset.f; if (!f) return;
      try {
        if (f === "active") await patchProduct(id, { active: t.checked });
        if (f === "price") await patchProduct(id, { price: num(t.value) });
        if (f === "price_usd") { await patchProduct(id, { price_usd: Math.max(0, Number(String(t.value).replace(",", ".")) || 0) }); if (!A.demo) { const r = await sb().from("products").select("price").eq("id", id).single(); if (r.data) cache.products.find((x) => x.id === id).price = r.data.price; } }
        if (f === "stock") await patchProduct(id, t.value.trim() === "" ? { show_stock: false, stock: 999 } : { show_stock: true, stock: Math.max(0, Math.round(num(t.value))) });
        if (f === "cost") await saveCost(id, { cost: t.value.trim() === "" ? null : num(t.value) });
        flash(t, true); if (f !== "active") renderRows(); else tr.classList.toggle("is-off", !t.checked);
      } catch (err) { flash(t, false); A.alertView("No se pudo guardar: " + err.message); }
    });
    tbody.addEventListener("click", async (e) => {
      const fl = e.target.closest("[data-flag]");
      if (fl) { const id = fl.closest("tr").dataset.id, f = fl.dataset.flag, p = cache.products.find((x) => x.id === id), v = !flagOn(p, f);
        try { await patchProduct(id, { [f]: v }); fl.classList.toggle("on", v); fl.setAttribute("aria-pressed", v); flash(fl, true); } catch (err) { flash(fl, false); A.alertView("No se pudo guardar: " + err.message); } return; }
      const cs = e.target.closest("[data-curswap]");
      if (cs) { const id = cs.closest("tr").dataset.id, p = cache.products.find((x) => x.id === id), fx = rate();
        if (!fx) return A.alertView("Todavía no hay cotización del dólar: configurala en 💵 Dólar.");
        const patch = p.price_usd != null ? { price_usd: null, price: round100(p.price_usd * fx) } : { price_usd: p.price > 0 ? Math.round((p.price / fx) * 100) / 100 : 0 };
        try { await patchProduct(id, patch); if (patch.price_usd != null) p.price = p.price || 0; renderRows(); } catch (err) { A.alertView("No se pudo cambiar la moneda: " + err.message); } return; }
      const b = e.target.closest("[data-dup]"); if (b) duplicate(b.closest("tr").dataset.id); });
    const bar = $("prBulk");
    const closeMenus = () => bar.querySelectorAll(".bk-menu").forEach((m) => { m.hidden = true; const t = m.previousElementSibling; if (t) t.setAttribute("aria-expanded", "false"); });
    bar.addEventListener("click", (e) => {
      const t = e.target.closest("[data-bk-open]");
      if (t) { const m = t.nextElementSibling, open = m.hidden; closeMenus(); m.hidden = !open; t.setAttribute("aria-expanded", String(open)); return; }
      const b = e.target.closest("[data-bulk]"); if (b) { closeMenus(); if ($("bkSearch")) $("bkSearch").value = ""; bulk(b.dataset.bulk); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("#prBulk")) closeMenus(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
    if ($("bkSearch")) $("bkSearch").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); const box = $("bkResults");
      closeMenus();
      if (!q) return;
      const all = BULK_GROUPS.flatMap((g) => g.items.map((it) => [it, `${g.name} ${it[1]} ${it[2]}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")]));
      const hits = all.filter(([, txt]) => q.split(/\s+/).every((w) => txt.includes(w)));
      box.innerHTML = hits.length ? hits.map(([it]) => bkItem(it)).join("") : "<p class=\"bk-none\">No hay acciones con esas palabras.</p>";
      box.hidden = false;
    });
  }
  async function saveCost(id, fields) {
    const cur = cache.costs.get(id) || { product_id: id };
    const row = { ...cur, ...fields, product_id: id };
    if (!A.demo) { const r = await sb().from("product_costs").upsert({ ...row, updated_at: new Date().toISOString() }); if (r.error) throw r.error; }
    cache.costs.set(id, row);
  }
  async function duplicate(id) {
    const p = cache.products.find((x) => x.id === id);
    let nid = `${id}-copia`, k = 2; while (cache.products.some((x) => x.id === nid)) nid = `${id}-copia-${k++}`;
    const copy = { ...p, id: nid, name: `${p.name} (copia)`, active: false, sort: (p.sort || 0) + 1 };
    delete copy.updated_at;
    try { await saveProduct(copy, cache.costs.get(id) ? { cost: cache.costs.get(id).cost, supplier: cache.costs.get(id).supplier, notes: cache.costs.get(id).notes } : null); location.hash = `#editar/${encodeURIComponent(nid)}`; }
    catch (err) { A.alertView("No se pudo duplicar: " + err.message); }
  }
  async function bulk(action) {
    const ids = [...listState.sel];
    if (action === "clear") { listState.sel.clear(); return renderRows(); }
    let fn;
    if (action === "on" || action === "off") fn = (p) => patchProduct(p.id, { active: action === "on" });
    if (action === "consult") fn = (p) => patchProduct(p.id, { price: 0, price_usd: null });
    if (action === "tagadd" || action === "tagrm") {
      const v = await ask(action === "tagadd" ? "Agregar etiqueta" : "Quitar etiqueta", "Nombre de la etiqueta (ej: Oferta, Gamer, Oficina).", "");
      if (!v || !v.trim()) return; const tag = v.trim();
      fn = (p) => { const t = new Set(p.tags || []); action === "tagadd" ? t.add(tag) : t.delete(tag); return patchProduct(p.id, { tags: [...t] }); };
    }
    const flagM = action.match(/^(ask_price|ask_stock|cart_ok|hide_no_stock):([01])$/);
    if (flagM) fn = (p) => patchProduct(p.id, { [flagM[1]]: flagM[2] === "1" });
    // Cambia el precio en su moneda: dólares (2 decimales) o pesos (redondeo a $100 salvo "round")
    const setPrice = (p, calc) => p.price_usd != null
      ? patchProduct(p.id, { price_usd: Math.max(0, Math.round(calc(Number(p.price_usd)) * 100) / 100) })
      : (p.price > 0 ? patchProduct(p.id, { price: Math.max(0, round100(calc(p.price))) }) : null);
    if (action === "ref") {
      const v = await ask("Precio según referencia de compra", "Precio = (compra + envío) de la referencia más barata, en pesos (las de dólares se pasan con la cotización actual) × (1 + %). Ej: 50.", String(DEFAULT_MARGIN));
      if (v === null) return; const f = 1 + num(v) / 100;
      const fx = A.demo ? 1550 : (await sb().from("fx_settings").select("effective_rate").eq("id", 1).single()).data?.effective_rate || 0;
      const ars = (v, c) => (c === "USD" ? (fx > 0 ? v * fx : NaN) : v);
      fn = (p) => { const refs = (cache.sources.get(p.id) || []).map((r) => ars(Number(r.ref_price), r.currency) + (r.ship_cost ? ars(Number(r.ship_cost), r.ship_currency) : 0)).filter((x) => x > 0); return refs.length ? patchProduct(p.id, { price: round100(Math.min(...refs) * f), price_usd: null }) : null; };
    }
    if (action === "tousd" || action === "toars") {
      const fx = A.demo ? 1550 : (await sb().from("fx_settings").select("effective_rate").eq("id", 1).single()).data?.effective_rate;
      if (!(fx > 0)) return A.alertView("No hay cotización del dólar cargada (sección 💵 Dólar).");
      fn = action === "tousd"
        ? (p) => (p.price_usd == null && p.price > 0 ? patchProduct(p.id, { price_usd: Math.round((p.price / fx) * 100) / 100 }) : null)
        : (p) => (p.price_usd != null ? patchProduct(p.id, { price_usd: null, price: round100(p.price_usd * fx) }) : null);
    }
    if (action === "amt") {
      const v = await ask("Sumar o restar un monto", "Monto en la moneda de cada producto (ej: 5000 suma $5.000; -2000 resta; en productos en dólares: 5 = US$ 5). Solo cambia los que tienen precio.", "5000");
      if (v === null) return; const d = num(v); fn = (p) => setPrice(p, (x) => x + d);
    }
    if (action === "set") {
      const v = await ask("Fijar precio", "Precio nuevo para todos los seleccionados (en su moneda: pesos o dólares). 0 = a consultar.", "");
      if (v === null || v === "") return; const d = num(v);
      fn = (p) => (p.price_usd != null ? patchProduct(p.id, { price_usd: Math.max(0, d) }) : patchProduct(p.id, { price: Math.max(0, Math.round(d)) }));
    }
    if (action === "round") {
      const v = await ask("Redondear precios", "Redondear a (ej: 100, 1000, 500). Termina en 999: escribí 999 (ej: $45.999).", "1000");
      if (v === null) return; const r = Math.max(1, Math.round(num(v)));
      const rnd = r === 999 ? (x) => Math.ceil(x / 1000) * 1000 - 1 : (x) => Math.round(x / r) * r;
      fn = (p) => (p.price_usd == null && p.price > 0 ? patchProduct(p.id, { price: rnd(p.price) }) : null);
    }
    if (action === "pct") {
      const v = await ask("Subir o bajar el precio de venta", "Porcentaje (ej: 10 para subir 10 %, -5 para bajar 5 %). Se redondea a $100.", "10");
      if (v === null) return; const f = 1 + num(v) / 100;
      fn = (p) => setPrice(p, (x) => x * f);
    }
    if (action === "margin") {
      const v = await ask("Aplicar margen sobre el costo", "Margen en % (precio = costo × (1 + margen)). Solo cambia los que tienen costo cargado.", String(DEFAULT_MARGIN));
      if (v === null) return; const f = 1 + num(v) / 100;
      fn = (p) => { const c = (cache.costs.get(p.id) || {}).cost; return c > 0 ? patchProduct(p.id, { price: round100(c * f) }) : null; };
    }
    if (action === "delete") {
      if (!(await confirmBox(`¿Eliminar ${ids.length} producto(s)?`, "Se borran de la tienda y del panel. No se puede deshacer. Si solo querés ocultarlos, usá Desactivar."))) return;
      fn = async (p) => { if (A.demo) { const st = demoStore(); st.products = st.products.filter((x) => x.id !== p.id); cache = st; return; } const r = await sb().from("products").delete().eq("id", p.id); if (r.error) throw r.error; };
    }
    if (!fn) return;
    let ok = 0, fail = 0;
    for (const id of ids) { const p = cache.products.find((x) => x.id === id); if (!p) continue; try { await fn(p); ok++; } catch { fail++; } }
    listState.sel.clear();
    await A.route();
    A.alertView(`Listo: ${ok} producto(s) actualizados${fail ? `, ${fail} con error (¿permisos?)` : ""}.`);
  }
  function exportCsv() {
    const w = can("products.write");
    const head = ["codigo", "nombre", "marca", "categoria", "estado", "outlet", ...(w ? ["costo"] : []), "venta", ...(w ? ["margen_%"] : []), "stock", "activo", "fotos"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = visible().map((p) => { const c = (cache.costs.get(p.id) || {}).cost; return [p.id, p.name, p.brand, p.category, p.condition, p.outlet ? "si" : "no", ...(w ? [c ?? ""] : []), p.price, ...(w ? [isFinite(margin(p.price, c)) ? Math.round(margin(p.price, c)) : ""] : []), p.show_stock ? p.stock : "", p.active ? "si" : "no", (p.images || []).length].map(q).join(";"); });
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `productos-exe-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------- Diálogos propios (confirmar / pedir un valor) ---------- */
  function dialog(title, text, input) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog"); d.className = "confirm";
      d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p>${input !== undefined ? `<input class="pr-in pr-dialog-in" value="${esc(input)}" autofocus>` : ""}
        <div class="confirm-actions"><button class="btn btn-outline" value="cancel">Volver</button><button class="btn btn-primary" value="ok">Aceptar</button></div></form>`;
      document.body.appendChild(d); d.showModal();
      d.addEventListener("close", () => { const v = d.querySelector("input"); resolve(d.returnValue === "ok" ? (v ? v.value : true) : null); d.remove(); });
    });
  }
  const confirmBox = (t, x) => dialog(t, x).then((v) => v === true);
  const ask = (t, x, def) => dialog(t, x, def);

  /* ---------- Editor ---------- */
  let ed = null;   // estado del producto en edición
  A.views.editar = async function (id) {
    const { products, costs, sources } = await loadAll(true);
    const isNew = id === "nuevo";
    const p = isNew ? { id: "", name: "", brand: "", category: "", tags: [], description: "", price: 0, stock: 1, show_stock: true, active: true, outlet: false, condition: "", images: [], specs: [], weight_kg: 1, sort: products.length } : products.find((x) => x.id === id);
    if (!p) return `<p class="notice error">No existe el producto "${esc(id)}".</p>`;
    const c = costs.get(p.id) || {};
    ed = { isNew, orig: p.id, images: [...(p.images || [])], specs: JSON.parse(JSON.stringify(p.specs || [])), sources: [...(sources.get(p.id) || [])], removedSources: [] };
    const w = can("products.write");
    const brands = [...new Set(products.map((x) => x.brand).filter(Boolean))].sort();
    const cats = [...new Set(products.map((x) => x.category).filter(Boolean))].sort();
    const m = margin(p.price, c.cost);
    const ro = w ? "" : "disabled";
    return `
      <form id="edForm" class="ed" autocomplete="off">
        <div class="ed-bar">
          <a class="btn btn-outline" href="#productos">← Volver a productos</a>
          ${isNew ? "" : `<a class="btn btn-outline" href="../index.html#producto/${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="${p.active ? "Abre la ficha tal como la ve un cliente" : "Está oculto: guardalo como visible para verlo en la tienda"}">👁 Ver como cliente${p.active ? "" : " (oculto)"}</a>`}
          <span class="ed-spacer"></span>
          ${w && !isNew ? `<button class="btn btn-outline danger" type="button" id="edDelete">Eliminar</button>` : ""}
          ${w ? `<button class="btn btn-outline" type="submit" data-next="new">Guardar y crear otro</button>` : ""}
          <button class="btn btn-primary" type="submit">Guardar</button>
        </div>
        <p class="notice" id="edMsg" hidden></p>

        <section class="panel ed-sec"><h3>1. Datos básicos</h3>
          <div class="ed-grid">
            <label class="field ed-wide">Nombre del producto *<input name="name" required value="${esc(p.name)}" placeholder="Ej: Placa de Video MSI GeForce RTX 3060 12GB" ${ro}></label>
            <label class="field">Código (para el link)<input name="id" value="${esc(p.id)}" ${isNew ? "" : "readonly"} placeholder="se genera solo desde el nombre" pattern="[a-z0-9\-]+"><small>${isNew ? "Solo minúsculas, números y guiones." : "No se puede cambiar (lo usan los links y pedidos)."}</small></label>
            <label class="field">Marca<input name="brand" list="edBrands" value="${esc(p.brand || "")}" ${ro}></label>
            <label class="field">Categoría<input name="category" list="edCats" value="${esc(p.category || "")}" placeholder="Elegí o escribí una nueva" ${ro}></label>
            <label class="field ed-wide">Etiquetas (separadas por coma)<input name="tags" list="edTags" value="${esc((p.tags || []).join(", "))}" placeholder="Ej: Gamer, Oferta, Oficina" ${ro}><small>Se muestran en la tienda y sirven para filtrar. Existentes: ${[...new Set(products.flatMap((x) => x.tags || []))].sort().map(esc).join(", ") || "ninguna"}</small></label>
            <label class="field ed-check"><input type="checkbox" name="outlet" ${p.outlet ? "checked" : ""} ${ro}> Es producto outlet</label>
            <label class="field">Estado / condición<input name="condition" value="${esc(p.condition || "")}" placeholder="Ej: Sin caja, con cooler" ${ro}></label>
          </div>
          <datalist id="edBrands">${brands.map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
          <datalist id="edCats">${cats.map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
        </section>

        <section class="panel ed-sec"><h3>2. Precio</h3>
          ${w ? `<p class="ed-hint" id="edFx">${rate() ? `Cotización vigente: ${money(rate())} por dólar. El costo y la venta pueden estar en monedas distintas: el margen y la ganancia se calculan convirtiendo con esta cotización.` : "Todavía no hay cotización: configurala en 💵 Dólar."}</p>` : ""}
          <div class="ed-grid ed-grid-4">
            ${w ? `<div class="field"><span data-cur-label="Costo de compra" data-cur-of="costcur">Costo de compra ($)</span><input name="cost" inputmode="decimal" value="${c.cost_usd != null ? c.cost_usd : (c.cost ?? "")}" placeholder="Solo lo ven admins" aria-label="Costo de compra">
              <span class="ed-curpick" role="radiogroup" aria-label="Moneda del costo"><label><input type="radio" name="costcur" value="ARS" ${c.cost_usd == null ? "checked" : ""}> Pesos</label><label><input type="radio" name="costcur" value="USD" ${c.cost_usd != null ? "checked" : ""}> Dólares</label></span></div>
            <label class="field">Margen (%)<input name="margin" inputmode="decimal" value="${isFinite(m) ? Math.round(m) : DEFAULT_MARGIN}"></label>` : ""}
            <div class="field"><span data-cur-label="Precio de venta" data-cur-of="cur">Precio de venta ($)</span><input name="price" inputmode="decimal" value="${p.price_usd != null ? p.price_usd : p.price || 0}" ${ro} aria-label="Precio de venta">
              ${w ? `<span class="ed-curpick" role="radiogroup" aria-label="Moneda de venta"><label><input type="radio" name="cur" value="ARS" ${p.price_usd == null ? "checked" : ""}> Pesos</label><label><input type="radio" name="cur" value="USD" ${p.price_usd != null ? "checked" : ""}> Dólares</label></span>` : ""}
              <small id="edArs">0 = "Consultar precio por WhatsApp"</small></div>
            ${w ? `<label class="field ed-check"><input type="checkbox" name="round" checked> Redondear a $100</label>` : ""}
          </div>
          ${w ? `<p class="ed-hint" id="edProfit"></p>
          <div class="ed-grid"><label class="field">Proveedor<input name="supplier" value="${esc(c.supplier || "")}" placeholder="Solo lo ven admins"></label>
          <label class="field">Notas internas<input name="notes" value="${esc(c.notes || "")}" placeholder="Solo lo ven admins"></label></div>` : ""}
        </section>

        <section class="panel ed-sec"><h3>3. Stock y visibilidad</h3>
          <div class="ed-grid ed-grid-4">
            <label class="field ed-check"><input type="checkbox" name="show_stock" ${p.show_stock ? "checked" : ""}> Controlar stock</label>
            <label class="field">Unidades<input name="stock" inputmode="numeric" value="${p.show_stock ? p.stock : ""}"></label>
            <label class="field ed-check"><input type="checkbox" name="active" ${p.active ? "checked" : ""}> Visible en la tienda</label>
            <label class="field">Peso (kg, para envíos)<input name="weight_kg" inputmode="decimal" value="${p.weight_kg ?? 1}" ${ro}></label>
            <label class="field">Ubicación en depósito (sale en la lista de armado)<input name="location" maxlength="40" placeholder="Ej: Estante A2" value="${esc(p.location || "")}" ${ro}></label>
          </div>
          <div class="ed-flags">${FLAGS.map(([f, ic, n, d]) => `<label class="ed-flag"><input type="checkbox" name="${f}" ${flagOn(p, f) ? "checked" : ""} ${ro}><span><b>${ic} ${n}</b><small>${d}</small></span></label>`).join("")}</div>
        </section>

        <section class="panel ed-sec"><h3>4. Fotos</h3>
          <p class="ed-hint">La primera es la principal. Arrastrá fotos acá, pegalas (Ctrl+V) o elegilas. Se achican y convierten solas (WebP, máx. 1200 px) para que la web cargue rápido.</p>
          <div class="ed-photos" id="edPhotos"></div>
          ${w ? `<div class="ed-drop" id="edDrop"><input type="file" id="edFile" accept="image/*" multiple hidden>
            <button class="btn btn-outline" type="button" id="edPick">📷 Subir fotos</button>
            <span>o arrastralas / pegalas acá</span>
            <span class="ed-spacer"></span><input id="edImgUrl" placeholder="…o pegá el link de una imagen" class="pr-in ed-url"><button class="btn btn-outline" type="button" id="edAddUrl">Agregar</button></div>
            <label class="field ed-check"><input type="checkbox" id="edWhite" checked> Poner fondo blanco (para PNG con fondo transparente)</label>
            <div class="ed-maker"><div class="ed-maker-row"><button class="btn btn-outline" type="button" id="edMakerBtn">🏭 Traer fotos y ficha del fabricante</button>
              <input id="edMakerUrl" class="pr-in" placeholder="(opcional) link de la página oficial del fabricante"></div>
              <small>Solo sitios oficiales de fabricantes certificados (intel.com, asus.com, gigabyte.com, msi.com…). Nunca de tiendas. Se compara el modelo con la página antes de traer nada.</small>
              <div id="edMakerOut"></div></div>` : ""}
        </section>

        <section class="panel ed-sec"><h3>5. Descripción</h3>
          <label class="field"><textarea name="description" rows="6" placeholder="Para qué sirve, qué incluye, con qué combina…" ${ro}>${esc(p.description || "")}</textarea></label>
          ${w ? `<div class="ed-quick"><span>Frases rápidas:</span>
            <button type="button" class="link-btn" data-snip="Producto outlet: funciona perfecto y está probado. Puede tener detalles en la caja o alguna marca estética mínima que no afecta el funcionamiento.">Outlet</button>
            <button type="button" class="link-btn" data-snip="Producto nuevo, sellado, con garantía oficial.">Nuevo con garantía</button>
            <button type="button" class="link-btn" data-snip="Envíos a todo el país. Consultá disponibilidad por WhatsApp.">Envíos</button></div>` : ""}
        </section>

        <section class="panel ed-sec"><h3>6. Especificaciones</h3>
          <div id="edSpecs"></div>
          ${w ? `<div class="ed-row-btns"><button class="btn btn-outline" type="button" id="edAddSec">＋ Agregar sección</button>
            <button class="btn btn-outline" type="button" id="edPasteSpecs">📋 Pegar ficha técnica como texto</button></div>` : ""}
        </section>

        ${w ? `<section class="panel ed-sec"><h3>7. Precio de referencia (solo admins)</h3>
          <p class="ed-hint">Dónde lo comprás y a cuánto. Se ve en la ficha solo con sesión de administrador.</p>
          <div id="edSources"></div>
          <button class="btn btn-outline" type="button" id="edAddSrc">＋ Agregar referencia</button>
        </section>` : ""}
        <div class="ed-bar ed-bar-bottom"><span class="ed-spacer"></span>${w ? `<button class="btn btn-outline" type="submit" data-next="new">Guardar y crear otro</button>` : ""}<button class="btn btn-primary" type="submit">Guardar</button></div>
      </form>`;
  };
  A.views.editar.after = () => { renderPhotos(); renderSpecs(); renderSources(); bindEditor(); };

  function renderPhotos() {
    const w = can("products.write");
    $("edPhotos").innerHTML = ed.images.map((src, i) => `<figure class="ed-photo" data-i="${i}">
      <img src="${esc(imgUrl(src))}" alt="">${i === 0 ? `<span class="ed-main">Principal</span>` : ""}
      ${w ? `<div class="ed-photo-btns"><button type="button" data-mv="-1" title="Mover a la izquierda" ${i === 0 ? "disabled" : ""}>◀</button><button type="button" data-first title="Hacer principal" ${i === 0 ? "disabled" : ""}>★</button><button type="button" data-mv="1" title="Mover a la derecha" ${i === ed.images.length - 1 ? "disabled" : ""}>▶</button><button type="button" data-rm title="Quitar">✕</button></div>` : ""}
    </figure>`).join("") || `<p class="ed-hint">Sin fotos todavía.</p>`;
  }
  function renderSpecs() {
    const ro = can("products.write") ? "" : "disabled";
    $("edSpecs").innerHTML = ed.specs.map((s, i) => `<div class="ed-spec" data-s="${i}">
      <div class="ed-spec-head"><input class="pr-in" data-st value="${esc(s.title)}" placeholder="Título de la sección (ej: Memoria)" ${ro}>${ro ? "" : `<button type="button" class="link-btn" data-srm>Quitar sección</button>`}</div>
      ${s.rows.map((r, j) => `<div class="ed-spec-row" data-r="${j}"><input class="pr-in" data-k value="${esc(r[0])}" placeholder="Dato (ej: Capacidad)" ${ro}><input class="pr-in" data-v value="${esc(r[1])}" placeholder="Valor (ej: 16 GB)" ${ro}>${ro ? "" : `<button type="button" class="link-btn" data-rrm title="Quitar fila">✕</button>`}</div>`).join("")}
      ${ro ? "" : `<button type="button" class="link-btn" data-radd>＋ Agregar fila</button>`}
    </div>`).join("") || `<p class="ed-hint">Sin especificaciones. Agregá una sección o pegá la ficha técnica como texto.</p>`;
  }
  // Envío de la referencia: vacío = a consultar, 0 = gratis, > 0 = con costo
  const shipMode = (s) => s.ship_mode || (s.ship_cost == null || s.ship_cost === "" ? "ask" : Number(s.ship_cost) === 0 ? "free" : "cost");
  function renderSources() {
    const box = $("edSources"); if (!box) return;
    box.innerHTML = ed.sources.map((s, i) => `<div class="ed-src" data-x="${i}">
      <input class="pr-in" data-sf="store" value="${esc(s.store || "")}" placeholder="Tienda (ej: CompraGamer)">
      <input class="pr-in" data-sf="url" value="${esc(s.url || "")}" placeholder="https://… link del producto">
      <span class="ed-src-money"><input class="pr-in" data-sf="ref_price" inputmode="decimal" value="${s.ref_price ?? ""}" placeholder="Precio de compra" title="Precio de compra del producto"><select class="pr-in pr-cur" data-sf="currency" title="Moneda">${["ARS", "USD"].map((c) => `<option ${(s.currency || "ARS") === c ? "selected" : ""}>${c}</option>`).join("")}</select></span>
      <span class="ed-src-money"><select class="pr-in pr-ship" data-sf="ship_mode" title="Envío">${[["ask", "Envío: a consultar"], ["free", "Envío gratis"], ["cost", "Envío con costo"]].map(([v, t]) => `<option value="${v}" ${shipMode(s) === v ? "selected" : ""}>${t}</option>`).join("")}</select></span>
      <span class="ed-src-money" ${shipMode(s) === "cost" ? "" : "hidden"} data-shipbox><input class="pr-in" data-sf="ship_cost" inputmode="decimal" value="${s.ship_cost > 0 ? s.ship_cost : ""}" placeholder="Costo de envío" title="Costo del envío"><select class="pr-in pr-cur" data-sf="ship_currency" title="Moneda">${["ARS", "USD"].map((c) => `<option ${(s.ship_currency || "ARS") === c ? "selected" : ""}>${c}</option>`).join("")}</select></span>
      <input class="pr-in" data-sf="delivery_note" value="${esc(s.delivery_note || "")}" placeholder="Demora (ej: 48 h)">
      ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="Abrir">↗</a>` : ""}<button type="button" class="link-btn" data-xrm title="Quitar">✕</button></div>`).join("") || `<p class="ed-hint">Sin referencias.</p>`;
  }
  // Toma los valores escritos en las especificaciones antes de re-dibujar
  function readSpecs() {
    document.querySelectorAll(".ed-spec").forEach((el) => {
      const s = ed.specs[+el.dataset.s]; if (!s) return;
      s.title = el.querySelector("[data-st]").value;
      s.rows = [...el.querySelectorAll(".ed-spec-row")].map((r) => [r.querySelector("[data-k]").value, r.querySelector("[data-v]").value]);
    });
  }
  function readSources() {
    document.querySelectorAll(".ed-src").forEach((el) => { const s = ed.sources[+el.dataset.x]; el.querySelectorAll("[data-sf]").forEach((i) => (s[i.dataset.sf] = i.value)); });
  }
  // "Clave: valor" por línea; una línea sin ":" (o que termina en ":") empieza una sección nueva
  function parseSpecs(text) {
    const out = []; let cur = null;
    text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => {
      const m = l.match(/^(.+?)\s*[:\t]\s*(.+)$/);
      if (m && !l.endsWith(":")) { if (!cur) out.push((cur = { title: "Características", rows: [] })); cur.rows.push([m[1].trim(), m[2].trim()]); }
      else out.push((cur = { title: l.replace(/:$/, ""), rows: [] }));
    });
    return out.filter((s) => s.rows.length);
  }

  // Foto → WebP liviano (máx. 1200 px, fondo blanco opcional) y subida a Supabase Storage
  async function toWebp(file, white) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const ctx = cv.getContext("2d");
    if (white) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    return new Promise((ok) => cv.toBlob(ok, "image/webp", 0.85));
  }
  async function uploadFiles(files) {
    const idInput = document.querySelector("#edForm [name=id]");
    const folder = slug(idInput.value || document.querySelector("#edForm [name=name]").value || "producto") || "producto";
    const white = $("edWhite") ? $("edWhite").checked : true;
    for (const f of [...files].filter((x) => x.type.startsWith("image/"))) {
      msg(`Subiendo ${f.name}…`, "info");
      try {
        const blob = await toWebp(f, white);
        if (A.demo) { ed.images.push(URL.createObjectURL(blob)); renderPhotos(); continue; }
        const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.webp`;
        const up = await sb().storage.from(BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
        if (up.error) throw up.error;
        ed.images.push(sb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
        renderPhotos();
      } catch (err) { return msg("No se pudo subir la foto: " + err.message, "error"); }
    }
    msg("Fotos listas. Acordate de Guardar.", "ok");
  }
  function msg(text, kind) { const m = $("edMsg"); m.hidden = false; m.className = `notice ${kind}`; m.textContent = text; }

  /* ---------- Importar del fabricante (función "fabricante": sin IA, solo sitios oficiales certificados) ---------- */
  const MAKER_DEMO = { maker: "GIGABYTE", page: "https://www.gigabyte.com/Motherboard/B460M-DS3H-V2-rev-10", title: "B460M DS3H V2 (rev. 1.0) | GIGABYTE",
    tokens: ["b460m", "ds3h", "v2"], match: { ok: true, found: ["b460m", "ds3h", "v2"], missing: [] },
    images: ["../assets/img/products/muestra/outlet-gigabyte-b460m-ds3h-v2.webp"],
    specs: [{ title: "CPU", rows: [["Socket", "LGA1200"], ["Procesadores", "Intel Core 10.ª y 11.ª gen"]] }, { title: "Memoria", rows: [["Zócalos", "4 x DDR4"], ["Máximo", "128 GB"]] }] };
  async function makerCall(body, raw) {
    if (A.demo) {
      if (body.action === "image") return fetch(body.url).then((r) => r.blob());
      return new Promise((ok) => setTimeout(() => ok(MAKER_DEMO), 300));
    }
    const { data: { session } } = await sb().auth.getSession();
    const r = await fetch(`${window.SITE_CONFIG.supabaseUrl}/functions/v1/fabricante`, { method: "POST",
      headers: { "Content-Type": "application/json", apikey: window.SITE_CONFIG.supabaseAnonKey, Authorization: `Bearer ${session ? session.access_token : ""}` }, body: JSON.stringify(body) });
    if (raw) { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`); return r.blob(); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }
  let makerRes = null, makerBusy = false;
  async function makerLookup(auto) {
    const f = $("edForm"); if (!f || makerBusy) return;
    const name = f.elements.name.value.trim(), brand = f.elements.brand.value.trim(), url = ($("edMakerUrl").value || "").trim();
    const out = $("edMakerOut");
    if (!name) { if (!auto) out.innerHTML = '<p class="notice error">Escribí el nombre del producto con el modelo.</p>'; return; }
    makerBusy = true; out.innerHTML = '<p class="notice info">Buscando en el sitio del fabricante…</p>';
    try {
      const d = await makerCall({ action: "lookup", brand, name, url });
      makerRes = d && !d.error ? d : null;
      if (!d || d.error) { out.innerHTML = `<p class="notice ${auto ? "info" : "error"}">${esc((d && d.error) || "Sin resultados")}</p>`; return; }
      renderMaker(d);
      // Automático (producto nuevo sin fotos): si el modelo coincide, se traen solas las fotos y la ficha
      if (auto && d.match.ok) {
        if (!ed.images.length && d.images.length) await makerImages(d.images.slice(0, 4));
        if (!ed.specs.length && d.specs.length) makerSpecs(d.specs);
        msg(`Fotos y ficha traídas de ${d.maker} (${new URL(d.page).hostname}). Revisalas y tocá Guardar.`, "ok");
      }
    } catch (e) { out.innerHTML = `<p class="notice error">No se pudo consultar al fabricante: ${esc(e.message)}</p>`; }
    finally { makerBusy = false; }
  }
  function renderMaker(d) {
    const ok = d.match.ok;
    $("edMakerOut").innerHTML = `<div class="ed-maker-res">
      <p class="notice ${ok ? "ok" : "error"}">${ok ? "✔ El modelo coincide" : "⚠ El modelo NO coincide del todo"} con <a href="${esc(d.page)}" target="_blank" rel="noopener">${esc(d.title || d.page)}</a> (${esc(d.maker)}).
        ${ok ? "" : `Falta en la página: <b>${esc(d.match.missing.join(", "))}</b>. Revisá que sea el producto correcto antes de usar nada.`}</p>
      ${d.images.length ? `<div class="ed-maker-imgs">${d.images.map((u, i) => `<label><input type="checkbox" data-mimg="${i}" ${ok && i < 4 ? "checked" : ""}><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"></label>`).join("")}</div>` : '<p class="ed-hint">No se encontraron fotos del fabricante en esa página.</p>'}
      <p class="ed-hint">${d.specs.length ? `Ficha técnica: ${d.specs.length} secciones, ${d.specs.reduce((n, s) => n + s.rows.length, 0)} datos.` : "No se encontró ficha técnica en la página."}</p>
      <div class="ed-row-btns">${d.images.length ? '<button class="btn btn-outline" type="button" id="edMakerUseImgs">Usar fotos marcadas</button>' : ""}${d.specs.length ? '<button class="btn btn-outline" type="button" id="edMakerUseSpecs">Usar ficha técnica</button>' : ""}</div></div>`;
    const ui = $("edMakerUseImgs"); if (ui) ui.onclick = () => makerImages([...document.querySelectorAll("[data-mimg]:checked")].map((c) => d.images[+c.dataset.mimg]));
    const us = $("edMakerUseSpecs"); if (us) us.onclick = () => { makerSpecs(d.specs); msg("Ficha técnica cargada. Revisala y tocá Guardar.", "ok"); };
  }
  // Las fotos pasan por la función (solo dominios del fabricante) y se suben como WebP igual que una foto propia
  async function makerImages(urls) {
    if (!urls.length) return;
    const files = [];
    for (const u of urls) {
      try { const b = await makerCall({ action: "image", url: u }, true); files.push(new File([b], (u.split("/").pop() || "foto").split("?")[0] || "foto", { type: b.type || "image/jpeg" })); }
      catch (e) { msg("No se pudo traer una foto: " + e.message, "error"); }
    }
    if (files.length) await uploadFiles(files);
  }
  function makerSpecs(list) {
    const have = new Set(ed.specs.map((s) => s.title.toLowerCase()));
    list.forEach((s) => { if (!have.has(String(s.title).toLowerCase())) ed.specs.push({ title: String(s.title).slice(0, 60), rows: s.rows.slice(0, 50).map((r) => [String(r[0]).slice(0, 80), String(r[1]).slice(0, 300)]) }); });
    renderSpecs();
  }

  function bindEditor() {
    const f = $("edForm"); const w = can("products.write");
    const el = (n) => f.elements[n];
    // Nombre → código automático (solo productos nuevos)
    if (ed.isNew) el("name").addEventListener("input", () => { if (!el("id").dataset.touched) el("id").value = slug(el("name").value); });
    if (ed.isNew) el("id").addEventListener("input", () => (el("id").dataset.touched = "1"));
    // Costo / margen / precio enlazados
    // Cada campo con su moneda: el costo en pesos o dólares y la venta en pesos o dólares, por separado
    const isUsd = () => w && el("cur") && f.querySelector("[name=cur]:checked").value === "USD";
    const costUsd = () => w && el("costcur") && f.querySelector("[name=costcur]:checked").value === "USD";
    const dec = (v) => Number(String(v).replace(",", ".")) || 0;          // USD con decimales
    const raw = (n, usd) => (usd ? dec(el(n).value) : num(el(n).value));
    const toArs = (v, usd) => (usd ? (rate() ? v * rate() : NaN) : v);
    const costArs = () => toArs(raw("cost", costUsd()), costUsd());
    const priceArs = () => toArs(raw("price", isUsd()), isUsd());
    const val = (n) => raw(n, n === "cost" ? costUsd() : isUsd());
    const profit = () => { const p = $("edProfit"); if (!p) return; const c = costArs(), v = priceArs();
      p.textContent = c > 0 && v > 0 ? `Ganancia por unidad: ${money(v - c)}${isUsd() && rate() ? ` (≈ ${usd((v - c) / rate())})` : ""} · margen ${Math.round(margin(v, c))}%` : (costUsd() !== isUsd() && !rate() ? "Para calcular la ganancia con monedas distintas hace falta la cotización del dólar." : ""); };
    const curUi = () => {
      f.querySelectorAll("[data-cur-label]").forEach((s) => (s.textContent = `${s.dataset.curLabel} (${(s.dataset.curOf === "costcur" ? costUsd() : isUsd()) ? "US$" : "$"})`));
      const ars = $("edArs"); if (!ars) return;
      ars.textContent = isUsd() ? (rate() ? `≈ ${money(Math.round(raw("price", true) * rate() / 100) * 100)} en la tienda (se actualiza solo con el dólar)` : "Sin cotización todavía") : '0 = "Consultar precio por WhatsApp"';
    };
    // Precio = costo × (1 + margen), pasado a la moneda de venta
    const fromMargin = () => { const c = costArs(); if (c > 0) { const vArs = c * (1 + num(el("margin").value) / 100);
      if (isUsd()) { if (rate()) el("price").value = Math.round((vArs / rate()) * 100) / 100; }
      else el("price").value = el("round").checked ? round100(vArs) : Math.round(vArs); } profit(); curUi(); };
    if (w) {
      el("cost").addEventListener("input", fromMargin);
      el("margin").addEventListener("input", fromMargin);
      el("price").addEventListener("input", () => { const c = costArs(), v = priceArs(); if (c > 0 && v > 0) el("margin").value = Math.round(margin(v, c)); profit(); curUi(); });
      // Cambiar la moneda del costo solo cambia cómo se lee ese número; cambiar la de venta recalcula el precio desde el costo y el margen
      f.querySelectorAll("[name=costcur]").forEach((r) => r.addEventListener("change", fromMargin));
      f.querySelectorAll("[name=cur]").forEach((r) => r.addEventListener("change", () => { if (costArs() > 0) fromMargin(); else { profit(); curUi(); } }));
      profit(); curUi();
    }
    el("show_stock").addEventListener("change", () => { el("stock").disabled = !el("show_stock").checked; });
    el("stock").disabled = !el("show_stock").checked;

    // Fotos
    $("edPhotos").addEventListener("click", (e) => {
      const fig = e.target.closest(".ed-photo"); if (!fig) return; const i = +fig.dataset.i;
      if (e.target.closest("[data-rm]")) ed.images.splice(i, 1);
      else if (e.target.closest("[data-first]")) ed.images.unshift(...ed.images.splice(i, 1));
      else if (e.target.closest("[data-mv]")) { const j = i + +e.target.closest("[data-mv]").dataset.mv; [ed.images[i], ed.images[j]] = [ed.images[j], ed.images[i]]; }
      else return;
      renderPhotos();
    });
    if (w) {
      $("edPick").onclick = () => $("edFile").click();
      $("edFile").onchange = (e) => uploadFiles(e.target.files);
      const drop = $("edDrop");
      ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
      ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
      drop.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
      f.addEventListener("paste", (e) => { const files = [...(e.clipboardData || {}).files || []]; if (files.length) { e.preventDefault(); uploadFiles(files); } });
      $("edMakerBtn").onclick = () => makerLookup(false);
      // Producto nuevo: al completar nombre y marca se busca solo en el fabricante
      if (ed.isNew) { let t; const kick = () => { clearTimeout(t); t = setTimeout(() => { if (!ed.images.length && f.elements.name.value.trim().length > 6 && f.elements.brand.value.trim()) makerLookup(true); }, 1200); };
        f.elements.name.addEventListener("change", kick); f.elements.brand.addEventListener("change", kick); }
      $("edAddUrl").onclick = () => { const u = $("edImgUrl").value.trim(); if (/^https:\/\//.test(u)) { ed.images.push(u); $("edImgUrl").value = ""; renderPhotos(); } else msg("El link tiene que empezar con https://", "error"); };
      // Frases rápidas
      f.querySelectorAll("[data-snip]").forEach((b) => (b.onclick = () => { const t = el("description"); t.value = (t.value.trim() ? t.value.trim() + "\n\n" : "") + b.dataset.snip; }));
      // Especificaciones
      $("edAddSec").onclick = () => { readSpecs(); ed.specs.push({ title: "", rows: [["", ""]] }); renderSpecs(); };
      $("edPasteSpecs").onclick = async () => {
        const t = await pasteBox(); if (!t) return;
        const parsed = parseSpecs(t); if (!parsed.length) return msg('No encontré filas "Dato: valor". Probá con una por línea.', "error");
        readSpecs(); ed.specs.push(...parsed); renderSpecs(); msg(`Se agregaron ${parsed.reduce((n, s) => n + s.rows.length, 0)} datos en ${parsed.length} sección(es).`, "ok");
      };
      $("edSpecs").addEventListener("click", (e) => {
        const box = e.target.closest(".ed-spec"); if (!box) return; readSpecs(); const s = ed.specs[+box.dataset.s];
        if (e.target.closest("[data-srm]")) ed.specs.splice(+box.dataset.s, 1);
        else if (e.target.closest("[data-radd]")) s.rows.push(["", ""]);
        else if (e.target.closest("[data-rrm]")) s.rows.splice(+e.target.closest(".ed-spec-row").dataset.r, 1);
        else return;
        renderSpecs();
      });
      // Referencias
      $("edSources").addEventListener("change", (e) => { if (e.target.dataset.sf !== "ship_mode") return; const row = e.target.closest(".ed-src"); row.querySelector("[data-shipbox]").hidden = e.target.value !== "cost"; if (e.target.value === "cost") row.querySelector("[data-sf=ship_cost]").focus(); });
      $("edAddSrc").onclick = () => { readSources(); ed.sources.push({ store: "", url: "", ref_price: "", currency: "ARS", ship_cost: "", ship_mode: "ask", ship_currency: "ARS", delivery_note: "" }); renderSources(); };
      $("edSources").addEventListener("click", (e) => { const b = e.target.closest("[data-xrm]"); if (!b) return; readSources(); const [x] = ed.sources.splice(+b.closest(".ed-src").dataset.x, 1); if (x && x.id) ed.removedSources.push(x.id); renderSources(); });
      if ($("edDelete")) $("edDelete").onclick = async () => {
        if (!(await confirmBox("¿Eliminar este producto?", "Se borra de la tienda y del panel. No se puede deshacer. Si solo querés ocultarlo, destildá \"Visible en la tienda\"."))) return;
        try { if (!A.demo) { const r = await sb().from("products").delete().eq("id", ed.orig); if (r.error) throw r.error; } else { const st = demoStore(); st.products = st.products.filter((x) => x.id !== ed.orig); } location.hash = "#productos"; }
        catch (err) { msg("No se pudo eliminar: " + err.message, "error"); }
      };
    }

    // Guardar
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const next = e.submitter && e.submitter.dataset.next;
      readSpecs(); readSources();
      const id = slug(el("id").value || el("name").value);
      if (!el("name").value.trim()) return msg("Falta el nombre del producto.", "error");
      if (!id) return msg("Falta el código.", "error");
      if (ed.isNew && cache.products.some((x) => x.id === id)) return msg(`Ya existe un producto con el código "${id}". Cambialo.`, "error");
      const prod = {
        id, name: el("name").value.trim(), brand: el("brand").value.trim() || null, category: el("category").value.trim() || null,
        outlet: el("outlet").checked, condition: el("condition").value.trim() || null,
        ...(isUsd() ? { price_usd: Math.max(0, val("price")) } : { price: Math.max(0, num(el("price").value)), price_usd: null }),
        ...Object.fromEntries(FLAGS.map(([f]) => [f, el(f).checked])),
        show_stock: el("show_stock").checked, stock: el("show_stock").checked ? Math.max(0, Math.round(num(el("stock").value))) : 999,
        tags: [...new Set(el("tags").value.split(",").map((t) => t.trim()).filter(Boolean))],
        active: el("active").checked, weight_kg: Math.max(0.01, num(el("weight_kg").value) || 1), location: el("location").value.trim().slice(0, 40) || null, description: el("description").value.trim() || null,
        images: ed.images, specs: ed.specs.map((s) => ({ title: s.title.trim() || "Características", rows: s.rows.filter((r) => r[0].trim() && r[1].trim()).map((r) => [r[0].trim(), r[1].trim()]) })).filter((s) => s.rows.length),
      };
      if (ed.isNew) prod.sort = cache.products.length;
      if (!w) { delete prod.name; }   // moderador (stock.write): solo stock / visibilidad
      const costV = el("cost").value.trim() === "" ? null : val("cost");
      const cost = w ? { ...(costUsd() ? { cost_usd: costV, cost: costV != null && rate() ? Math.round(costV * rate()) : null } : { cost: costV, cost_usd: null }), supplier: el("supplier").value.trim() || null, notes: el("notes").value.trim() || null } : null;
      // Referencias de compra: precio obligatorio (con decimales), link opcional pero válido
      const dec = (v) => { const x = Number(String(v ?? "").replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return isFinite(x) ? x : 0; };
      const bad = ed.sources.find((s) => (s.store || "").trim() && !(dec(s.ref_price) > 0));
      if (bad) return msg(`Falta el precio de compra en la referencia "${bad.store}".`, "error");
      const noShip = ed.sources.find((s) => (s.store || "").trim() && shipMode(s) === "cost" && !(dec(s.ship_cost) > 0));
      if (noShip) return msg(`Poné el costo de envío de "${noShip.store}" o elegí "a consultar" / "gratis".`, "error");
      const badUrl = ed.sources.find((s) => (s.url || "").trim() && !/^https?:\/\//i.test(s.url.trim()));
      if (badUrl) return msg(`El link de "${badUrl.store || "la referencia"}" tiene que empezar con https://`, "error");
      try {
        msg("Guardando…", "info");
        if (w) await saveProduct(prod, cost);
        else await patchProduct(ed.orig, { show_stock: prod.show_stock, stock: prod.stock, active: prod.active });
        if (w && !A.demo) {
          for (const sid of ed.removedSources) await sb().from("product_sources").delete().eq("id", sid);
          for (const s of ed.sources.filter((s) => (s.store || "").trim() && dec(s.ref_price) > 0)) {
            const u = (s.url || "").trim();
            const row = { product_id: id, store: s.store.trim(), url: u || null, ref_price: dec(s.ref_price), currency: s.currency || "ARS",
              ship_cost: shipMode(s) === "free" ? 0 : shipMode(s) === "cost" && dec(s.ship_cost) > 0 ? dec(s.ship_cost) : null, ship_currency: s.ship_currency || "ARS",
              delivery_note: s.delivery_note || null, checked_at: new Date().toISOString() };
            const r = s.id ? await sb().from("product_sources").update(row).eq("id", s.id) : await sb().from("product_sources").upsert(row, { onConflict: "product_id,store" });
            if (r.error) throw r.error;
          }
        }
        cache = null;
        if (next === "new") { location.hash = "#editar/nuevo"; if (!ed.isNew) return; await A.route(); return msg("Guardado. Cargá el siguiente.", "ok"); }
        if (ed.isNew) { location.hash = `#editar/${encodeURIComponent(id)}`; return; }
        await A.route(); msg("Guardado ✔ Ya se ve en la tienda.", "ok");
      } catch (err) { msg("No se pudo guardar: " + err.message, "error"); }
    });
  }
  function pasteBox() {
    return new Promise((resolve) => {
      const d = document.createElement("dialog"); d.className = "confirm ed-paste";
      d.innerHTML = `<form method="dialog"><h2>Pegar ficha técnica</h2><p>Una línea por dato, "Dato: valor". Una línea sin ":" empieza una sección.</p>
        <textarea rows="10" placeholder="Memoria\nCapacidad: 16 GB\nVelocidad: 3200 MHz\nEnergía\nConsumo: 75 W"></textarea>
        <div class="confirm-actions"><button class="btn btn-outline" value="cancel">Volver</button><button class="btn btn-primary" value="ok">Agregar</button></div></form>`;
      document.body.appendChild(d); d.showModal();
      d.addEventListener("close", () => { resolve(d.returnValue === "ok" ? d.querySelector("textarea").value : null); d.remove(); });
    });
  }

  /* ---------- Dólar: cotización manual o automática (cada 10 min, con máximo del día) ---------- */
  const FX_SOURCES = [["max", "Automático (el más alto)"], ["mid", "Automático (punto medio)"], ["min", "Automático (el más bajo)"], ["oficial", "Oficial"], ["blue", "Blue"], ["bolsa", "MEP (bolsa)"], ["contadoconliqui", "CCL (contado con liqui)"], ["mayorista", "Mayorista"], ["cripto", "Cripto"], ["tarjeta", "Tarjeta"]];
  A.views.dolar = async function () {
    const r = A.demo ? { data: { mode: "auto", manual_rate: null, source: "oficial", round_to: 100, last_auto_rate: 1545, last_auto_at: new Date().toISOString(), day_max_rate: 1550, day_date: "2026-09-28", effective_rate: 1550, day_max_by_source: { oficial: 1545, blue: 1560, bolsa: 1557.3, contadoconliqui: 1616.6, mayorista: 1525.5, cripto: 1613.92, tarjeta: 2008.5 }, max_sources: ["oficial", "blue", "bolsa", "contadoconliqui", "mayorista", "cripto"], vol_up_on: true, vol_up_pts: 100, vol_down_on: false, vol_down_pts: 100, day_open_rate: 1545, vol_state: null } } : await sb().from("fx_settings").select("*").eq("id", 1).single();
    if (r.error) throw r.error;
    const s = r.data;
    const nUsd = A.demo ? 1 : (await sb().from("products").select("id", { count: "exact", head: true }).not("price_usd", "is", null)).count;
    const t = (d) => (d ? new Date(d).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—");
    return `
      <div class="kpis">
        <div class="kpi"><small>Cotización en uso</small><strong>${s.effective_rate ? money(s.effective_rate) : "—"}</strong></div>
        <div class="kpi"><small>Modo</small><strong>${s.mode === "manual" ? "Manual" : "Automático"}</strong></div>
        <div class="kpi"><small>Productos en dólares</small><strong>${nUsd ?? 0}</strong></div>
      </div>
      <form class="panel ed-sec" id="fxForm">
        <h3>Cómo se calcula el precio en pesos</h3>
        <div class="fx-modes">
          <label class="fx-mode"><input type="radio" name="mode" value="manual" ${s.mode === "manual" ? "checked" : ""}>
            <span><b>Manual</b> — uso el valor que pongo yo.</span></label>
          <label class="fx-mode"><input type="radio" name="mode" value="auto" ${s.mode === "auto" ? "checked" : ""}>
            <span><b>Automático</b> — se actualiza cada 10 minutos con la fuente elegida (al lado de cada una, su valor más alto de hoy; "Automático" usa la más alta, la más baja o el punto medio entre ambas). <b>Durante el día nunca baja</b>: se usa el valor más alto del día; al día siguiente arranca de nuevo.</span></label>
        </div>
        <div class="ed-grid ed-grid-4">
          <label class="field">Mi valor (manual, $ por US$ 1)<input name="manual" inputmode="decimal" value="${s.manual_rate ?? ""}" placeholder="Ej: 1550"></label>
          <label class="field">Fuente automática<select name="source">${FX_SOURCES.map(([v, n]) => { const mx = s.day_max_by_source || {}; const ms = s.max_sources || []; const vs = ms.map((k) => Number(mx[k])).filter((x) => x > 0), hi = vs.length ? Math.max(...vs) : 0, lo = vs.length ? Math.min(...vs) : 0; const val = v === "max" ? hi : v === "min" ? lo : v === "mid" ? Math.round((hi + lo) * 50) / 100 : Number(mx[v]); return `<option value="${v}" ${v === s.source ? "selected" : ""}>${n}${val ? " — " + money(val) : ""}</option>`; }).join("")}</select></label>
          <label class="field">Redondear precios a<select name="round">${[1, 10, 100, 1000].map((v) => `<option value="${v}" ${v === s.round_to ? "selected" : ""}>$${v}</option>`).join("")}</select></label>
        </div>
        <div class="fx-maxsrc"><small>Cotizaciones que tienen en cuenta los modos <b>Automático</b> (más alto, punto medio y más bajo) — tocá para activar o desactivar:</small>
          <div class="fx-chips">${FX_SOURCES.filter(([v]) => !["max", "mid", "min"].includes(v)).map(([v, n]) => `<label class="fx-chip"><input type="checkbox" name="maxsrc" value="${v}" ${(s.max_sources || []).includes(v) ? "checked" : ""}><span>${n}</span></label>`).join("")}</div></div>
        <div class="fx-vol">
          <small>Días de mucha fluctuación (se compara con el primer valor del día de la fuente elegida):</small>
          <label class="fx-vol-row"><input type="checkbox" name="volUp" ${s.vol_up_on ? "checked" : ""}> Si <b>sube</b> <input name="volUpPts" inputmode="decimal" value="${s.vol_up_pts ?? 100}"> pesos o más → usar la cotización <b>más alta</b></label>
          <label class="fx-vol-row"><input type="checkbox" name="volDown" ${s.vol_down_on ? "checked" : ""}> Si <b>baja</b> <input name="volDownPts" inputmode="decimal" value="${s.vol_down_pts ?? 100}"> pesos o más → usar la cotización <b>más baja</b> (ese día el precio sí puede bajar)</label>
          ${s.vol_state ? `<p class="notice ${s.vol_state === "sube" ? "error" : "info"}">Hoy se activó: ${s.vol_state === "sube" ? "subió" : "bajó"} más de lo indicado desde la apertura (${money(s.day_open_rate)}).</p>` : ""}
        </div>
        <p class="ed-hint">Automático — último valor leído: <b>${s.last_auto_rate ? money(s.last_auto_rate) : "—"}</b> (${t(s.last_auto_at)}) · máximo de hoy: <b>${s.day_max_rate ? money(s.day_max_rate) : "—"}</b>${s.last_error ? ` · <span class="pr-low">último error: ${esc(s.last_error)}</span>` : ""}</p>
        <div class="ed-row-btns"><button class="btn btn-primary" type="submit">Guardar y recalcular precios</button></div>
        <p class="notice" id="fxMsg" hidden></p>
      </form>
      <div class="panel fx-hist"><h3>Historial de cotizaciones</h3>
        <div class="fx-hist-bar">
          <div class="fx-chips" id="fxRange">${[[1, "24 h"], [7, "7 días"], [30, "30 días"], [90, "3 meses"], [365, "1 año"], [730, "2 años"]].map(([d, n]) => `<button type="button" class="fx-rbtn ${d === 30 ? "on" : ""}" data-d="${d}">${n}</button>`).join("")}</div>
          <label class="fx-pct"><input type="checkbox" id="fxPct"> Comparar en % (desde el inicio del período)</label>
        </div>
        <div class="fx-hist-bar">
          <div class="fx-chips" id="fxStep"><small class="fx-lbl">Ver cada:</small><span id="fxQuick" class="fx-chips">${quickBtns(s.quick_steps)}</span><button type="button" class="fx-rbtn" id="fxCustomBtn" aria-expanded="false">Personalizado ▾</button></div>
        </div>
        <div class="fx-custom" id="fxCustom" hidden>
          <label class="field">Cada<input id="fxCN" type="number" min="1" value="2" inputmode="numeric"></label>
          <label class="field">&nbsp;<select id="fxCU"><option value="1">minutos</option><option value="60" selected>horas</option><option value="1440">días</option></select></label>
          <label class="field">Desde<input id="fxFrom" type="datetime-local"></label>
          <label class="field">Hasta<input id="fxTo" type="datetime-local"></label>
          <button type="button" class="btn btn-primary" id="fxCApply">Aplicar</button>
          <button type="button" class="btn btn-outline" id="fxCSave" title="Agrega este intervalo a los botones de acceso rápido">＋ Guardar como acceso rápido</button>
          <div class="fx-qedit"><small>Accesos rápidos (tocá ✕ para quitar):</small><div class="fx-chips" id="fxQEdit"></div>
            <button type="button" class="link-btn" id="fxQReset">Restaurar los predefinidos</button></div>
        </div>
        <p class="ed-hint" id="fxNote"></p>
        <div class="fx-chips" id="fxSeries">${FX_SOURCES.filter(([v]) => !["max", "mid", "min"].includes(v)).map(([v, n]) => `<label class="fx-chip"><input type="checkbox" value="${v}" ${["oficial", "blue", "bolsa", "tarjeta"].includes(v) ? "checked" : ""}><span>${n}</span></label>`).join("")}</div>
        <div class="fx-chart"><canvas id="fxChart" aria-label="Gráfico histórico del dólar"></canvas></div>
        <div id="fxStats"></div>
      </div>
      <div class="panel"><h3>Cotizaciones de hoy (dolarapi.com)</h3><div id="fxLive" class="fx-live">Cargando…</div></div>
      <p class="notice info">Para poner un producto en dólares: editalo y en <b>2. Precio</b> elegí <b>Dólares (USD)</b>. El precio en pesos de la tienda se recalcula solo cada vez que cambia la cotización.</p>`;
  };
  /* Gráfico histórico (Chart.js se carga solo al abrir esta sección) */
  const FX_COLORS = { oficial: "#0084d6", blue: "#2563eb", bolsa: "#16a34a", contadoconliqui: "#9333ea", mayorista: "#64748b", cripto: "#f59e0b", tarjeta: "#dc2626" };
  const loadChart = () => window.Chart ? Promise.resolve() : new Promise((ok, ko) => { const sc = document.createElement("script"); sc.src = "../assets/vendor/chart-4.4.4.umd.min.js"; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
  let fxChart = null;
  // Accesos rápidos de "Ver cada" (se guardan en fx_settings.quick_steps, iguales para todos los administradores)
  const QDEF = [0, 10, 30, 60, 360, 720, 1440];
  const stepName = (m) => (m === 0 ? "⏱ Tiempo real" : m % 1440 === 0 ? `${m / 1440} día${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);
  const quickBtns = (arr) => (arr && arr.length ? arr : QDEF).map((m) => `<button type="button" class="fx-rbtn" data-m="${m}">${stepName(m)}</button>`).join("");
  let quick = null;
  async function saveQuick(arr) {
    if (!A.demo) { const r = await sb().rpc("fx_quick_steps", { p_steps: arr }); if (r.error) throw r.error; arr = r.data; }
    quick = [...arr].sort((a, b) => a - b);
    $("fxQuick").innerHTML = quickBtns(quick); renderQEdit();
  }
  function renderQEdit() { $("fxQEdit").innerHTML = quick.map((m) => `<span class="fx-qchip">${stepName(m)}<button type="button" data-qrm="${m}" aria-label="Quitar ${stepName(m)}">✕</button></span>`).join("") || "<small>Sin accesos rápidos.</small>"; }
  // Estado del historial: rango (días), intervalo (min; 0 = cada lectura / tiempo real) y fechas personalizadas
  const fxv = { days: 30, step: null, from: null, to: null, live: false };
  const autoStep = (d) => (d <= 1 ? 10 : d <= 7 ? 60 : d <= 30 ? 360 : 1440);
  let fxTimer = null;
  async function fxHistory(from, to, step) {
    if (A.demo) { const out = []; const base = { oficial: 1545, blue: 1560, bolsa: 1557, contadoconliqui: 1616, mayorista: 1525, cripto: 1613, tarjeta: 2008 };
      const st = Math.max(10, step || 10, Math.ceil((to - from) / 6e4 / 3000)) * 6e4, n = Math.floor((to - from) / st);
      for (let i = n; i >= 0; i--) for (const [k, b] of Object.entries(base)) { const v = +(b * (1 - i / n * 0.05) + Math.sin(i / 5) * 6).toFixed(2); out.push({ ts: new Date(to - i * st).toISOString(), casa: k, venta: v, venta_max: v + 2, venta_min: v - 2 }); }
      return out; }
    const all = [];
    for (let i = 0; ; i += 1000) { const r = await sb().rpc("fx_history_bucket", { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(), p_bucket_min: step }).range(i, i + 999); if (r.error) throw r.error; all.push(...r.data); if (r.data.length < 1000) break; }
    return all;
  }
  async function drawFx() {
    const pct = $("fxPct").checked;
    const to = fxv.to || Date.now(), from = fxv.from || to - fxv.days * 864e5, days = (to - from) / 864e5;
    const step = fxv.live ? 0 : fxv.step ?? autoStep(days);
    document.querySelectorAll("#fxStep [data-m]").forEach((b) => b.classList.toggle("on", !fxv.custom && (fxv.live ? b.dataset.m === "0" : +b.dataset.m === step && fxv.step != null)));
    $("fxCustomBtn").classList.toggle("on", !!fxv.custom);
    const eff = Math.max(step, Math.ceil((to - from) / 6e4 / 3000));
    const lbl = (m) => (m === 0 ? "cada lectura" : m % 1440 === 0 ? `${m / 1440} día(s)` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);
    $("fxNote").textContent = fxv.live ? "Tiempo real: se agrega un punto por minuto con la cotización en vivo mientras esta pantalla esté abierta. Las lecturas guardadas son cada 10 minutos."
      : `Mostrando un punto cada ${lbl(eff)}${eff > step ? ` (ajustado por la cantidad de datos del período; elegí un período más corto para ver más detalle)` : ""}. Las lecturas se guardan cada 10 minutos (antes del 28/09: una por día).`;
    const sel = [...document.querySelectorAll("#fxSeries input:checked")].map((c) => c.value);
    $("fxStats").innerHTML = "<small>Cargando…</small>";
    try { await loadChart(); } catch { $("fxStats").textContent = "No se pudo cargar el gráfico."; return; }
    const rows = await fxHistory(from, to, step);
    const by = {}; rows.forEach((r) => (by[r.casa] ||= []).push({ x: new Date(r.ts).getTime(), y: Number(r.venta), hi: Number(r.venta_max), lo: Number(r.venta_min) }));
    fxv.by = by;
    const name = Object.fromEntries(FX_SOURCES);
    const fmtD = (t) => new Date(t).toLocaleString("es-AR", days <= 14 ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" });
    const datasets = sel.filter((k) => by[k]?.length).map((k) => { const d = by[k], y0 = d[0].y;
      return { key: k, y0, label: name[k], borderColor: FX_COLORS[k], backgroundColor: FX_COLORS[k], borderWidth: 2, pointRadius: d.length < 80 ? 2 : 0, tension: 0.2, data: d.map((p) => ({ x: p.x, y: pct ? +((p.y / y0 - 1) * 100).toFixed(2) : p.y, hi: p.hi, lo: p.lo })) }; });
    const css = getComputedStyle(document.body), tc = css.color, gc = "rgba(128,128,128,.18)";
    fxChart?.destroy();
    fxChart = new Chart($("fxChart"), { type: "line", data: { datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "nearest", axis: "x", intersect: false }, parsing: false,
        scales: { x: { type: "linear", ticks: { color: tc, maxTicksLimit: 8, callback: (v) => fmtD(v) }, grid: { color: gc } },
                  y: { ticks: { color: tc, callback: (v) => (pct ? v + " %" : money(v)) }, grid: { color: gc } } },
        plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { title: (it) => fmtD(it[0].parsed.x), label: (c) => { const r = c.raw; return `${c.dataset.label}: ${pct ? c.parsed.y + " %" : money(c.parsed.y)}${!pct && r.hi && r.hi !== r.lo ? ` (mín ${money(r.lo)} · máx ${money(r.hi)})` : ""}`; } } } } } });
    fxv.pct = pct;
    const st = sel.filter((k) => by[k]?.length).map((k) => { const v = by[k].map((p) => p.y), a = v[0], z = v[v.length - 1], mn = Math.min(...v), mx = Math.max(...v);
      return `<tr><td><span class="fx-dot" style="background:${FX_COLORS[k]}"></span>${esc(name[k])}</td><td><b>${money(z)}</b></td><td>${money(mn)}</td><td>${money(mx)}</td><td>${money(Math.round(v.reduce((s, x) => s + x, 0) / v.length * 100) / 100)}</td><td class="${z >= a ? "pr-up" : "pr-low"}">${z >= a ? "▲" : "▼"} ${money(Math.round((z - a) * 100) / 100)} (${((z / a - 1) * 100).toFixed(1)} %)</td><td>${money(Math.round((mx - mn) * 100) / 100)}</td></tr>`; }).join("");
    $("fxStats").innerHTML = st ? `<div class="table-wrap"><table class="table"><tr><th>Cotización</th><th>Última</th><th>Mínimo</th><th>Máximo</th><th>Promedio</th><th>Variación del período</th><th>Rango</th></tr>${st}</table></div>` : "<small>Elegí al menos una cotización.</small>";
  }

  A.views.dolar.after = () => {
    quick = [...document.querySelectorAll("#fxQuick [data-m]")].map((b) => +b.dataset.m); renderQEdit();
    const customStep = () => Math.max(1, Math.round(+$("fxCN").value || 1)) * +$("fxCU").value;
    $("fxCSave").onclick = () => { const m = customStep(); if (quick.includes(m)) return ($("fxNote").textContent = `"${stepName(m)}" ya está en los accesos rápidos.`);
      saveQuick([...quick, m]).then(() => ($("fxNote").textContent = `Listo: "${stepName(m)}" agregado a los accesos rápidos.`)).catch((e) => ($("fxNote").textContent = "No se pudo guardar: " + e.message)); };
    $("fxQEdit").addEventListener("click", (e) => { const b = e.target.closest("[data-qrm]"); if (!b) return; saveQuick(quick.filter((m) => m !== +b.dataset.qrm)).catch((er) => ($("fxNote").textContent = "No se pudo guardar: " + er.message)); });
    $("fxQReset").onclick = () => saveQuick(QDEF).catch((e) => ($("fxNote").textContent = "No se pudo guardar: " + e.message));
    const setLive = (on) => { fxv.live = on; clearInterval(fxTimer); fxTimer = null; if (on) fxTimer = setInterval(liveTick, 60000); };
    $("fxRange").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (!b) return; document.querySelectorAll("#fxRange .on").forEach((x) => x.classList.remove("on")); b.classList.add("on");
      Object.assign(fxv, { days: +b.dataset.d, from: null, to: null, custom: false }); setLive(false); drawFx(); });
    $("fxStep").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; const m = +b.dataset.m; fxv.custom = false; fxv.from = fxv.to = null;
      if (m === 0) { fxv.days = 1; document.querySelectorAll("#fxRange .fx-rbtn").forEach((x) => x.classList.toggle("on", x.dataset.d === "1")); setLive(true); } else { fxv.step = m; setLive(false); }
      drawFx(); });
    $("fxCustomBtn").onclick = () => { const c = $("fxCustom"); c.hidden = !c.hidden; $("fxCustomBtn").setAttribute("aria-expanded", String(!c.hidden)); };
    $("fxCApply").onclick = () => {
      const m = customStep();
      const f = $("fxFrom").value ? new Date($("fxFrom").value).getTime() : null, t = $("fxTo").value ? new Date($("fxTo").value).getTime() : null;
      if (f && t && t <= f) return ($("fxNote").textContent = "La fecha \"Hasta\" tiene que ser posterior a \"Desde\".");
      Object.assign(fxv, { step: m, from: f, to: t, custom: true }); if (f && !t) fxv.to = Date.now(); setLive(false);
      if (f || t) document.querySelectorAll("#fxRange .on").forEach((x) => x.classList.remove("on"));
      drawFx(); };
    // Tiempo real: suma un punto por minuto con dolarapi.com (se detiene al salir de la sección)
    async function liveTick() {
      if (!$("fxChart") || !fxChart) return setLive(false);
      try { const rows = await (await fetch("https://dolarapi.com/v1/dolares")).json(); const x = Date.now();
        fxChart.data.datasets.forEach((ds) => { const r = rows.find((q) => q.casa === ds.key); if (!r) return; const y = fxv.pct ? +((r.venta / ds.y0 - 1) * 100).toFixed(2) : r.venta; ds.data.push({ x, y, hi: r.venta, lo: r.venta }); });
        fxChart.update("none"); } catch { /* sin conexión: se reintenta en el próximo minuto */ }
    }
    $("fxSeries").addEventListener("change", drawFx); $("fxPct").addEventListener("change", drawFx);
    drawFx();
    fetch("https://dolarapi.com/v1/dolares").then((r) => r.json()).then((rows) => {
      $("fxLive").innerHTML = `<table class="table"><tr><th>Tipo</th><th>Compra</th><th>Venta</th><th>Actualizado</th><th></th></tr>${rows.map((r) => `<tr><td>${esc(r.nombre)}</td><td>${money(r.compra)}</td><td><b>${money(r.venta)}</b></td><td>${new Date(r.fechaActualizacion).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</td>
        <td><button type="button" class="link-btn" data-use="${r.venta}">Usar como mi valor</button></td></tr>`).join("")}</table>`;
    }).catch(() => ($("fxLive").textContent = "No se pudieron cargar las cotizaciones en vivo."));
    $("fxLive").addEventListener("click", (e) => { const b = e.target.closest("[data-use]"); if (!b) return; const f = $("fxForm"); f.elements.manual.value = b.dataset.use; f.querySelector("[value=manual]").checked = true; });
    $("fxForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = e.target; const m = $("fxMsg");
      const mode = f.querySelector("[name=mode]:checked").value, manual = Number(String(f.elements.manual.value).replace(",", ".")) || null;
      if (mode === "manual" && !manual) { m.hidden = false; m.className = "notice error"; return (m.textContent = "Poné tu valor del dólar."); }
      if (!f.querySelector("[name=maxsrc]:checked")) { m.hidden = false; m.className = "notice error"; return (m.textContent = "Dejá al menos una cotización activada para el modo Automático."); }
      if (A.demo) { m.hidden = false; m.className = "notice info"; return (m.textContent = "Modo demo: acá se guardaría y se recalcularían los precios."); }
      const r = await sb().rpc("fx_save", { p_mode: mode, p_manual: manual, p_source: f.elements.source.value, p_round: Number(f.elements.round.value), p_max_sources: [...f.querySelectorAll("[name=maxsrc]:checked")].map((c) => c.value),
        p_vol_up_on: f.elements.volUp.checked, p_vol_up_pts: Number(String(f.elements.volUpPts.value).replace(",", ".")) || 100,
        p_vol_down_on: f.elements.volDown.checked, p_vol_down_pts: Number(String(f.elements.volDownPts.value).replace(",", ".")) || 100 });
      if (r.error) { m.hidden = false; m.className = "notice error"; return (m.textContent = r.error.message); }
      await A.route();
      const m2 = $("fxMsg"); m2.hidden = false; m2.className = "notice ok";
      m2.textContent = `Guardado. Cotización en uso: ${money(r.data.rate)} · ${r.data.productos_actualizados} precio(s) actualizados.${r.data.error ? " Error de la fuente: " + r.data.error : ""}`;
    });
  };

  A.start();
})();
