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
    const cols = "id,name,brand,category,tags,description,price,price_usd,stock,show_stock,active,outlet,condition,image,images,specs,weight_kg,sort,variants,updated_at";
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

  /* ---------- Listado ---------- */
  const listState = { q: "", cat: "", filter: "", sel: new Set() };
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
          ${[["", "Todos"], ["activos", "Activos"], ["inactivos", "Inactivos"], ["outlet", "Outlet"], ["sinfoto", "Sin foto"], ["sinprecio", "Sin precio"], ["sinstock", "Sin stock"], ["sincosto", "Sin costo cargado"]]
            .map(([v, t]) => `<option value="${v}" ${v === listState.filter ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <button class="btn btn-outline" id="prCsv" type="button">⬇ Exportar CSV</button>
      </div>
      <div class="pr-bulk" id="prBulk" hidden>
        <b id="prBulkN"></b>
        ${w ? `<button class="btn btn-outline" data-bulk="on">Activar</button>
        <button class="btn btn-outline" data-bulk="off">Desactivar</button>
        <button class="btn btn-outline" data-bulk="pct">Subir/bajar precio %</button>
        <button class="btn btn-outline" data-bulk="margin">Aplicar margen sobre costo</button>
        <button class="btn btn-outline" data-bulk="consult">Poner "a consultar"</button>
        <button class="btn btn-outline" data-bulk="tagadd">🏷 Agregar etiqueta</button>
        <button class="btn btn-outline" data-bulk="tagrm">Quitar etiqueta</button>
        <button class="btn btn-outline danger" data-bulk="delete">Eliminar</button>` : ""}
        <button class="link-btn" data-bulk="clear">Quitar selección</button>
      </div>
      <div class="panel pr-table-wrap"><table class="table pr-table">
        <thead><tr><th><input type="checkbox" id="prAll" aria-label="Seleccionar todos"></th><th></th><th>Producto</th><th>Categoría</th>
          ${w ? "<th>Costo</th>" : ""}<th>Venta</th>${w ? "<th>Margen</th>" : ""}<th>Stock</th><th>Activo</th><th></th></tr></thead>
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
      switch (listState.filter) {
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
          : (w ? `<input class="pr-in" data-f="price" inputmode="numeric" value="${p.price || 0}">` : (p.price ? money(p.price) : "Consultar"))}</td>
        ${w ? `<td class="${m < 15 ? "pr-low" : ""}">${pct(m)}</td>` : ""}
        <td>${sw ? `<input class="pr-in pr-in-sm" data-f="stock" inputmode="numeric" value="${p.show_stock ? p.stock : ""}" placeholder="∞" title="Vacío = sin control de stock">` : (p.show_stock ? p.stock : "∞")}</td>
        <td>${sw ? `<label class="switch"><input type="checkbox" data-f="active" ${p.active ? "checked" : ""}><span></span></label>` : (p.active ? "Sí" : "No")}</td>
        <td class="pr-actions"><a href="#editar/${encodeURIComponent(p.id)}" title="Editar">✏️</a>${w ? `<button class="link-btn" data-dup title="Duplicar">⧉</button>` : ""}<a href="../index.html#producto/${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="Ver en la tienda">↗</a></td>
      </tr>`;
    }).join("") || `<tr><td colspan="10" class="pr-empty">No hay productos con ese filtro.</td></tr>`;
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
    tbody.addEventListener("click", (e) => { const b = e.target.closest("[data-dup]"); if (b) duplicate(b.closest("tr").dataset.id); });
    $("prBulk").addEventListener("click", (e) => { const b = e.target.closest("[data-bulk]"); if (b) bulk(b.dataset.bulk); });
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
    if (action === "pct") {
      const v = await ask("Subir o bajar el precio de venta", "Porcentaje (ej: 10 para subir 10 %, -5 para bajar 5 %). Se redondea a $100.", "10");
      if (v === null) return; const f = 1 + num(v) / 100;
      fn = (p) => (p.price > 0 ? patchProduct(p.id, { price: round100(p.price * f) }) : null);
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
          ${isNew ? "" : `<a class="btn btn-outline" href="../index.html#producto/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Ver en la tienda ↗</a>`}
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
          ${w ? `<div class="ed-cur"><span>Moneda del precio:</span>
            <label><input type="radio" name="cur" value="ARS" ${p.price_usd == null ? "checked" : ""}> Pesos (ARS)</label>
            <label><input type="radio" name="cur" value="USD" ${p.price_usd != null ? "checked" : ""}> Dólares (USD)</label>
            <small id="edFx">${rate() ? `Cotización vigente: ${money(rate())} por dólar` : "Todavía no hay cotización: configurala en 💵 Dólar."}</small></div>` : ""}
          <div class="ed-grid ed-grid-4">
            ${w ? `<label class="field"><span data-cur-label="Costo de compra">Costo de compra ($)</span><input name="cost" inputmode="decimal" value="${p.price_usd != null ? (c.cost_usd ?? "") : (c.cost ?? "")}" placeholder="Solo lo ven admins"></label>
            <label class="field">Margen (%)<input name="margin" inputmode="decimal" value="${isFinite(m) ? Math.round(m) : DEFAULT_MARGIN}"></label>` : ""}
            <label class="field"><span data-cur-label="Precio de venta">Precio de venta ($)</span><input name="price" inputmode="decimal" value="${p.price_usd != null ? p.price_usd : p.price || 0}" ${ro}><small id="edArs">0 = "Consultar precio por WhatsApp"</small></label>
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
          </div>
        </section>

        <section class="panel ed-sec"><h3>4. Fotos</h3>
          <p class="ed-hint">La primera es la principal. Arrastrá fotos acá, pegalas (Ctrl+V) o elegilas. Se achican y convierten solas (WebP, máx. 1200 px) para que la web cargue rápido.</p>
          <div class="ed-photos" id="edPhotos"></div>
          ${w ? `<div class="ed-drop" id="edDrop"><input type="file" id="edFile" accept="image/*" multiple hidden>
            <button class="btn btn-outline" type="button" id="edPick">📷 Subir fotos</button>
            <span>o arrastralas / pegalas acá</span>
            <span class="ed-spacer"></span><input id="edImgUrl" placeholder="…o pegá el link de una imagen" class="pr-in ed-url"><button class="btn btn-outline" type="button" id="edAddUrl">Agregar</button></div>
            <label class="field ed-check"><input type="checkbox" id="edWhite" checked> Poner fondo blanco (para PNG con fondo transparente)</label>` : ""}
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
  function renderSources() {
    const box = $("edSources"); if (!box) return;
    box.innerHTML = ed.sources.map((s, i) => `<div class="ed-src" data-x="${i}">
      <input class="pr-in" data-sf="store" value="${esc(s.store || "")}" placeholder="Tienda (ej: CompraGamer)">
      <input class="pr-in" data-sf="url" value="${esc(s.url || "")}" placeholder="https://… link del producto">
      <input class="pr-in" data-sf="ref_price" inputmode="numeric" value="${s.ref_price ?? ""}" placeholder="Precio ref. $">
      <input class="pr-in" data-sf="delivery_note" value="${esc(s.delivery_note || "")}" placeholder="Envío (ej: 48 h)">
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

  function bindEditor() {
    const f = $("edForm"); const w = can("products.write");
    const el = (n) => f.elements[n];
    // Nombre → código automático (solo productos nuevos)
    if (ed.isNew) el("name").addEventListener("input", () => { if (!el("id").dataset.touched) el("id").value = slug(el("name").value); });
    if (ed.isNew) el("id").addEventListener("input", () => (el("id").dataset.touched = "1"));
    // Costo / margen / precio enlazados
    const profit = () => { const p = $("edProfit"); if (!p) return; const c = val("cost"), v = val("price"); p.textContent = c > 0 && v > 0 ? `Ganancia por unidad: ${isUsd() ? usd(v - c) + (rate() ? ` (≈ ${money((v - c) * rate())})` : "") : money(v - c)} · margen ${pct(margin(v, c))} sobre costo` : "Cargá el costo para ver la ganancia."; };
    const isUsd = () => w && el("cur") && f.querySelector("[name=cur]:checked").value === "USD";
    const dec = (v) => Number(String(v).replace(",", ".")) || 0;          // USD con decimales
    const val = (n) => (isUsd() ? dec(el(n).value) : num(el(n).value));
    const curUi = () => {
      f.querySelectorAll("[data-cur-label]").forEach((s) => (s.textContent = `${s.dataset.curLabel} (${isUsd() ? "US$" : "$"})`));
      const ars = $("edArs"); if (!ars) return;
      ars.textContent = isUsd() ? (rate() ? `≈ ${money(Math.round(val("price") * rate() / 100) * 100)} en la tienda (se actualiza solo con el dólar)` : "Sin cotización todavía") : '0 = "Consultar precio por WhatsApp"';
    };
    const fromMargin = () => { const c = val("cost"); if (c > 0) { const v = c * (1 + num(el("margin").value) / 100); el("price").value = isUsd() ? Math.round(v * 100) / 100 : el("round").checked ? round100(v) : Math.round(v); } profit(); curUi(); };
    if (w) {
      el("cost").addEventListener("input", fromMargin);
      el("margin").addEventListener("input", fromMargin);
      el("price").addEventListener("input", () => { const c = val("cost"), v = val("price"); if (c > 0 && v > 0) el("margin").value = Math.round(margin(v, c)); profit(); curUi(); });
      f.querySelectorAll("[name=cur]").forEach((r) => r.addEventListener("change", () => { profit(); curUi(); }));
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
      $("edAddSrc").onclick = () => { readSources(); ed.sources.push({ store: "", url: "", ref_price: "", delivery_note: "" }); renderSources(); };
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
        show_stock: el("show_stock").checked, stock: el("show_stock").checked ? Math.max(0, Math.round(num(el("stock").value))) : 999,
        tags: [...new Set(el("tags").value.split(",").map((t) => t.trim()).filter(Boolean))],
        active: el("active").checked, weight_kg: Math.max(0.01, num(el("weight_kg").value) || 1), description: el("description").value.trim() || null,
        images: ed.images, specs: ed.specs.map((s) => ({ title: s.title.trim() || "Características", rows: s.rows.filter((r) => r[0].trim() && r[1].trim()).map((r) => [r[0].trim(), r[1].trim()]) })).filter((s) => s.rows.length),
      };
      if (ed.isNew) prod.sort = cache.products.length;
      if (!w) { delete prod.name; }   // moderador (stock.write): solo stock / visibilidad
      const costV = el("cost").value.trim() === "" ? null : val("cost");
      const cost = w ? { ...(isUsd() ? { cost_usd: costV, cost: costV != null && rate() ? Math.round(costV * rate()) : null } : { cost: costV, cost_usd: null }), supplier: el("supplier").value.trim() || null, notes: el("notes").value.trim() || null } : null;
      try {
        msg("Guardando…", "info");
        if (w) await saveProduct(prod, cost);
        else await patchProduct(ed.orig, { show_stock: prod.show_stock, stock: prod.stock, active: prod.active });
        if (w && !A.demo) {
          for (const sid of ed.removedSources) await sb().from("product_sources").delete().eq("id", sid);
          for (const s of ed.sources.filter((s) => s.url && s.store && num(s.ref_price) > 0)) {
            const row = { product_id: id, store: s.store.trim(), url: s.url.trim(), ref_price: num(s.ref_price), delivery_note: s.delivery_note || null, checked_at: new Date().toISOString() };
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

  /* ---------- Dólar: cotización manual o automática (cada 30 min, con máximo del día) ---------- */
  const FX_SOURCES = [["max", "Automático (el más alto)"], ["oficial", "Oficial"], ["blue", "Blue"], ["bolsa", "MEP (bolsa)"], ["contadoconliqui", "CCL (contado con liqui)"], ["mayorista", "Mayorista"], ["cripto", "Cripto"], ["tarjeta", "Tarjeta"]];
  A.views.dolar = async function () {
    const r = A.demo ? { data: { mode: "auto", manual_rate: null, source: "oficial", round_to: 100, last_auto_rate: 1545, last_auto_at: new Date().toISOString(), day_max_rate: 1550, day_date: "2026-09-28", effective_rate: 1550, day_max_by_source: { oficial: 1545, blue: 1560, bolsa: 1557.3, contadoconliqui: 1616.6, mayorista: 1525.5, cripto: 1613.92, tarjeta: 2008.5 }, max_sources: ["oficial", "blue", "bolsa", "contadoconliqui", "mayorista", "cripto"] } } : await sb().from("fx_settings").select("*").eq("id", 1).single();
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
            <span><b>Automático</b> — se actualiza cada 30 minutos con la fuente elegida (al lado de cada una, su valor más alto de hoy; "Automático" usa la más alta de todas). <b>Durante el día nunca baja</b>: se usa el valor más alto del día; al día siguiente arranca de nuevo.</span></label>
        </div>
        <div class="ed-grid ed-grid-4">
          <label class="field">Mi valor (manual, $ por US$ 1)<input name="manual" inputmode="decimal" value="${s.manual_rate ?? ""}" placeholder="Ej: 1550"></label>
          <label class="field">Fuente automática<select name="source">${FX_SOURCES.map(([v, n]) => { const mx = s.day_max_by_source || {}; const ms = s.max_sources || []; const val = v === "max" ? Math.max(0, ...ms.map((k) => Number(mx[k]) || 0)) : Number(mx[v]); return `<option value="${v}" ${v === s.source ? "selected" : ""}>${n}${val ? " — " + money(val) : ""}</option>`; }).join("")}</select></label>
          <label class="field">Redondear precios a<select name="round">${[1, 10, 100, 1000].map((v) => `<option value="${v}" ${v === s.round_to ? "selected" : ""}>$${v}</option>`).join("")}</select></label>
        </div>
        <div class="fx-maxsrc"><small>Cotizaciones que tiene en cuenta <b>Automático (el más alto)</b> — tocá para activar o desactivar:</small>
          <div class="fx-chips">${FX_SOURCES.filter(([v]) => v !== "max").map(([v, n]) => `<label class="fx-chip"><input type="checkbox" name="maxsrc" value="${v}" ${(s.max_sources || []).includes(v) ? "checked" : ""}><span>${n}</span></label>`).join("")}</div></div>
        <p class="ed-hint">Automático — último valor leído: <b>${s.last_auto_rate ? money(s.last_auto_rate) : "—"}</b> (${t(s.last_auto_at)}) · máximo de hoy: <b>${s.day_max_rate ? money(s.day_max_rate) : "—"}</b>${s.last_error ? ` · <span class="pr-low">último error: ${esc(s.last_error)}</span>` : ""}</p>
        <div class="ed-row-btns"><button class="btn btn-primary" type="submit">Guardar y recalcular precios</button></div>
        <p class="notice" id="fxMsg" hidden></p>
      </form>
      <div class="panel"><h3>Cotizaciones de hoy (dolarapi.com)</h3><div id="fxLive" class="fx-live">Cargando…</div></div>
      <p class="notice info">Para poner un producto en dólares: editalo y en <b>2. Precio</b> elegí <b>Dólares (USD)</b>. El precio en pesos de la tienda se recalcula solo cada vez que cambia la cotización.</p>`;
  };
  A.views.dolar.after = () => {
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
      const r = await sb().rpc("fx_save", { p_mode: mode, p_manual: manual, p_source: f.elements.source.value, p_round: Number(f.elements.round.value), p_max_sources: [...f.querySelectorAll("[name=maxsrc]:checked")].map((c) => c.value) });
      if (r.error) { m.hidden = false; m.className = "notice error"; return (m.textContent = r.error.message); }
      await A.route();
      const m2 = $("fxMsg"); m2.hidden = false; m2.className = "notice ok";
      m2.textContent = `Guardado. Cotización en uso: ${money(r.data.rate)} · ${r.data.productos_actualizados} precio(s) actualizados.${r.data.error ? " Error de la fuente: " + r.data.error : ""}`;
    });
  };

  A.start();
})();
