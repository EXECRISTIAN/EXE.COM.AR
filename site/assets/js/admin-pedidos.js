// Panel → Pedidos: listado, armar pedidos a mano (ej. los que llegan por WhatsApp), ficha del pedido
// con datos de envío, lista de armado (tildar lo que ya se juntó) y etiqueta 10×15 para la caja.
// Seguridad: crear/editar pasa por funciones de la base que verifican permisos (orders.create /
// orders.update_status); el precio lo pone la base salvo que el usuario tenga products.write.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, money, $ } = A;
  const sb = () => A.be.sb;
  const can = (p) => A.perms.has(p);
  const STATUS = { pending: "Pendiente de pago", paid: "Pagado", preparing: "En preparación", shipped: "Despachado", delivered: "Entregado", cancelled: "Cancelado" };
  const CARRIERS = ["Andreani", "Correo Argentino", "OCA", "Moto / cadete", "Retiro en el local"];
  const num = (v) => { const n = Number(String(v).replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const key = (it) => `${it.product_id}|${it.variant || ""}`;
  const SENDER = { name: "EXE", web: "exe.com.ar", phone: "11 3009-5254" };

  /* ---------- Datos (demo o Supabase) ---------- */
  const demo = () => {
    const d = A.DEMO;
    if (!d._orders) {
      d._orders = new Map([[1042, {
        id: 1042, created_at: "2026-09-20T15:00:00", status: "paid", source: "manual", total: 460500, shipping_cost: 8500, carrier: "Andreani", packages: 1,
        customer_name: "Juan Pérez", customer_phone: "11 5555-5555", customer_email: "juan@mail.com",
        ship_address: "Av. Rivadavia 1234, 3°B", ship_city: "CABA", ship_province: "Buenos Aires", ship_zip: "1406",
        note: "Entregar por la tarde", packed_items: [], packed_at: null,
        order_items: [
          { product_id: "demo-rtx-3060", variant: "", qty: 1, unit_price: 359100, products: { name: "Placa de Video RTX 3060 12GB (demo)", location: "Estante A2" } },
          { product_id: "demo-cooler", variant: "", qty: 2, unit_price: 46450, products: { name: "Cooler de ejemplo (demo)", location: "Estante B1" } },
        ],
      }]]);
    }
    return d._orders;
  };
  async function listOrders() {
    if (A.demo) return [...demo().values(), ...A.DEMO.orders.filter((o) => !demo().has(o.id))].sort((a, b) => b.id - a.id);
    const { data, error } = await sb().from("orders")
      .select("id, created_at, status, total, source, customer_name, packed_at, carrier, tracking_number, label_url, customer:profiles(full_name)")
      .order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    return data.map((o) => ({ ...o, customer: o.customer?.full_name || o.customer_name }));
  }
  async function getOrder(id) {
    if (A.demo) return demo().get(Number(id)) || null;
    const { data, error } = await sb().from("orders")
      .select("*, order_items(product_id, variant, qty, unit_price, products(name, location)), profile:profiles(full_name, email, phone)")
      .eq("id", id).maybeSingle();
    if (error) throw error;
    if (data && data.profile) {                     // pedidos de la web: completar con los datos de la cuenta
      data.customer_name = data.customer_name || data.profile.full_name;
      data.customer_email = data.customer_email || data.profile.email;
      data.customer_phone = data.customer_phone || data.profile.phone;
    }
    return data;
  }
  async function productList() {
    if (A.demo) return [{ id: "demo-rtx-3060", name: "Placa de Video RTX 3060 12GB (demo)", price: 450000, stock: 3 }, { id: "demo-cooler", name: "Cooler de ejemplo (demo)", price: 46450, stock: 9 }];
    const { data, error } = await sb().from("products").select("id, name, price, stock, active").order("name");
    if (error) throw error;
    return data;
  }
  const rpc = async (fn, args) => {
    if (A.demo) return null;
    const { data, error } = await sb().rpc(fn, args);
    if (error) throw error;
    return data;
  };

  /* ---------- Listado ---------- */
  A.views.pedidos = async function () {
    const rows = await listOrders();
    return `<div class="orders-bar">
        ${can("orders.create") ? `<a class="btn btn-primary" href="#pedido/nuevo">＋ Nuevo pedido</a>` : ""}
      </div>
      <div class="panel"><table class="table"><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Armado</th><th>Envío</th><th></th></tr>
      ${rows.length ? rows.map((o) => `<tr><td>${o.id}${o.source === "manual" ? ` <span class="tag-mini" title="Armado desde el panel">panel</span>` : ""}</td>
        <td>${esc(String(o.created_at).slice(0, 10))}</td><td>${esc(o.customer || "—")}</td>
        <td><span class="pill ${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span></td><td>${money(o.total)}</td>
        <td>${o.packed_at ? "✅ Embalado" : "—"}</td><td>${A.shipCell(o)}</td><td><a class="btn btn-outline btn-sm" href="#pedido/${o.id}">Abrir</a></td></tr>`).join("")
        : `<tr><td colspan="8">Todavía no hay pedidos.</td></tr>`}
      </table></div>
      <p class="notice info">"Pagado" lo marca solamente el sistema al recibir la confirmación de Mercado Pago (o un administrador con el permiso <b>orders.mark_paid</b>, quedando registrado quién y cuándo).</p>`;
  };

  /* ---------- Ficha / nuevo pedido ---------- */
  A.subviews.pedido = { perm: "orders.read", parent: "pedidos", title: (args) => (args[0] === "nuevo" ? "Nuevo pedido" : `Pedido #${args[0]}`) };
  let draft = [];                 // renglones del pedido nuevo
  let products = [];
  let current = null;             // pedido abierto

  const infoFields = (o = {}, ro = "") => `
    <div class="grid-2">
      <label class="field">Nombre y apellido *<input name="customer_name" maxlength="120" value="${esc(o.customer_name || "")}" ${ro}></label>
      <label class="field">Teléfono<input name="customer_phone" maxlength="40" inputmode="tel" value="${esc(o.customer_phone || "")}" ${ro}></label>
      <label class="field">Email<input name="customer_email" maxlength="160" type="email" value="${esc(o.customer_email || "")}" ${ro}></label>
      <label class="field">Transportista<input name="carrier" maxlength="60" list="carrierList" value="${esc(o.carrier || "")}" ${ro}></label>
      <label class="field wide">Dirección (calle, número, piso)<input name="ship_address" maxlength="200" value="${esc(o.ship_address || "")}" ${ro}></label>
      <label class="field">Localidad<input name="ship_city" maxlength="80" value="${esc(o.ship_city || "")}" ${ro}></label>
      <label class="field">Provincia<input name="ship_province" maxlength="80" value="${esc(o.ship_province || "")}" ${ro}></label>
      <label class="field">Código postal<input name="ship_zip" maxlength="12" value="${esc(o.ship_zip || "")}" ${ro}></label>
      <label class="field">Bultos<input name="packages" type="number" min="1" max="50" value="${o.packages || 1}" ${ro}></label>
    </div>
    <datalist id="carrierList">${CARRIERS.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>`;
  const readInfo = (f) => ({
    customer_name: f.customer_name.value, customer_phone: f.customer_phone.value, customer_email: f.customer_email.value,
    carrier: f.carrier.value, ship_address: f.ship_address.value, ship_city: f.ship_city.value,
    ship_province: f.ship_province.value, ship_zip: f.ship_zip.value,
  });

  A.views.pedido = async function (id) {
    if (id === "nuevo") {
      if (!can("orders.create")) return `<p class="notice error">No tenés permiso para armar pedidos.</p>`;
      products = await productList();
      draft = [];
      return `<form id="newOrder" class="panel order-form" autocomplete="off">
        <h3>Cliente y envío</h3>${infoFields()}
        <h3>Productos</h3>
        <div class="add-line">
          <input id="npSearch" list="npList" placeholder="Buscá un producto por nombre…">
          <datalist id="npList">${products.map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist>
          <input id="npQty" type="number" min="1" max="999" value="1" aria-label="Cantidad">
          <button type="button" class="btn btn-outline" id="npAdd">Agregar</button>
        </div>
        <div id="npLines"></div>
        <div class="grid-2">
          <label class="field">Costo de envío ($)<input name="shipping_cost" inputmode="numeric" value="0"></label>
          <label class="field">Nota interna<input name="note" maxlength="1000" placeholder="Ej: pagó con transferencia"></label>
        </div>
        <div class="order-total">Total: <b id="npTotal">$0</b></div>
        <button class="btn btn-primary" type="submit">Guardar pedido</button>
        <a class="btn btn-outline" href="#pedidos">Cancelar</a>
        <p class="notice info">El stock se descuenta al guardar. ${can("products.write") ? "Podés cambiar el precio de cada renglón (precio acordado con el cliente)." : "El precio es el de la tienda."}</p>
      </form>`;
    }
    current = await getOrder(id);
    if (!current) return `<p class="notice error">No encontré el pedido #${esc(id)}.</p>`;
    const o = current;
    const ro = can("orders.update_status") ? "" : "disabled";
    const packed = new Set(o.packed_items || []);
    const items = o.order_items || [];
    const sub = items.reduce((n, i) => n + i.qty * i.unit_price, 0);
    return `<div class="order-actions">
        <button class="btn btn-primary" id="printLabel">🖨 Etiqueta</button>
        <button class="btn btn-outline" id="printPick">📋 Lista de armado</button>
        <a class="btn btn-outline" href="#pedidos">← Volver</a>
      </div>
      <div class="order-cols">
        <div class="panel">
          <h3>Lista de armado ${o.packed_at ? `<span class="pill paid">Embalado</span>` : ""}</h3>
          <ul class="pick-list">${items.map((i) => `<li><label><input type="checkbox" data-pick="${esc(key(i))}" ${packed.has(key(i)) ? "checked" : ""} ${ro}>
            <span><b>${i.qty} ×</b> ${esc(i.products?.name || i.product_id)}${i.variant ? ` (${esc(i.variant)})` : ""}</span>
            <small>${esc(i.products?.location || "")}</small></label></li>`).join("")}</ul>
          <p class="pick-hint">Tildá cada producto cuando lo tengas. Con todo tildado, el pedido queda como <b>Embalado</b>.</p>
          <table class="table"><tr><td>Productos</td><td>${money(sub)}</td></tr>
            ${o.shipping_cost ? `<tr><td>Envío</td><td>${money(o.shipping_cost)}</td></tr>` : ""}
            <tr><td><b>Total</b></td><td><b>${money(o.total)}</b></td></tr></table>
          ${o.note ? `<p><b>Nota:</b> ${esc(o.note)}</p>` : ""}
          <label class="field">Estado
            <select id="orderStatus" ${can("orders.update_status") ? "" : "disabled"}>
              ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? "selected" : ""} ${k === "paid" && !can("orders.mark_paid") && o.status !== "paid" ? "disabled" : ""}>${v}</option>`).join("")}
            </select></label>
        </div>
        <form class="panel" id="orderInfo" autocomplete="off">
          <h3>Cliente y envío (sale en la etiqueta)</h3>
          ${infoFields(o, ro)}
          ${ro ? "" : `<button class="btn btn-primary" type="submit">Guardar datos</button>`}
        </form>
      </div>`;
  };

  A.views.pedido.after = (id) => {
    if (id === "nuevo") return bindNew();
    const o = current; if (!o) return;
    $("printLabel").onclick = () => printDoc(labelHtml(o));
    $("printPick").onclick = () => printDoc(pickHtml(o));
    const f = $("orderInfo");
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const info = readInfo(f);
        await rpc("admin_update_order_info", { p_order: o.id, p_info: info, p_packages: Number(f.packages.value) || 1 });
        Object.assign(o, info, { packages: Number(f.packages.value) || 1 });
        A.toast ? A.toast("Datos guardados") : alert("Datos guardados");
      } catch (err) { alert(err.message); }
    };
    document.querySelectorAll("[data-pick]").forEach((cb) => cb.onchange = async () => {
      const list = [...document.querySelectorAll("[data-pick]:checked")].map((x) => x.dataset.pick);
      try {
        const at = A.demo ? (list.length === (o.order_items || []).length ? new Date().toISOString() : null) : await rpc("admin_set_packed", { p_order: o.id, p_packed: list });
        o.packed_items = list; o.packed_at = at;
        A.route();
      } catch (err) { cb.checked = !cb.checked; alert(err.message); }
    });
    $("orderStatus").onchange = async (e) => {
      const to = e.target.value;
      if (!confirm(`¿Pasar el pedido #${o.id} a "${STATUS[to]}"?`)) { e.target.value = o.status; return; }
      try { await rpc("set_order_status", { p_order: o.id, p_status: to }); o.status = to; A.route(); }
      catch (err) { e.target.value = o.status; alert(err.message); }
    };
  };

  function bindNew() {
    const f = $("newOrder");
    const priceEditable = can("products.write");
    const render = () => {
      $("npLines").innerHTML = draft.length ? `<table class="table">${draft.map((d, i) => `<tr>
          <td>${esc(d.name)}</td>
          <td><input type="number" min="1" max="999" value="${d.qty}" data-q="${i}" aria-label="Cantidad" style="width:70px"></td>
          <td>${priceEditable ? `<input inputmode="numeric" value="${d.unit_price}" data-p="${i}" aria-label="Precio unitario" style="width:110px">` : money(d.unit_price)}</td>
          <td>${money(d.qty * d.unit_price)}</td>
          <td><button type="button" class="link-btn" data-rm="${i}" aria-label="Quitar">✕</button></td></tr>`).join("")}</table>`
        : `<p class="pick-hint">Todavía no agregaste productos.</p>`;
      const total = draft.reduce((n, d) => n + d.qty * d.unit_price, 0) + num(f.shipping_cost.value);
      $("npTotal").textContent = money(total);
      $("npLines").querySelectorAll("[data-q]").forEach((x) => x.onchange = () => { draft[x.dataset.q].qty = Math.max(1, Math.min(999, Number(x.value) || 1)); render(); });
      $("npLines").querySelectorAll("[data-p]").forEach((x) => x.onchange = () => { draft[x.dataset.p].unit_price = Math.max(0, num(x.value)); render(); });
      $("npLines").querySelectorAll("[data-rm]").forEach((x) => x.onclick = () => { draft.splice(Number(x.dataset.rm), 1); render(); });
    };
    $("npAdd").onclick = () => {
      const q = $("npSearch").value.trim().toLowerCase();
      const p = products.find((x) => x.name.toLowerCase() === q) || products.find((x) => x.name.toLowerCase().includes(q));
      if (!q || !p) return alert("Elegí un producto de la lista.");
      const qty = Math.max(1, Math.min(999, Number($("npQty").value) || 1));
      const same = draft.find((d) => d.product_id === p.id);
      if (same) same.qty += qty; else draft.push({ product_id: p.id, name: p.name, qty, unit_price: Number(p.price) || 0 });
      $("npSearch").value = ""; $("npQty").value = 1; render(); $("npSearch").focus();
    };
    $("npSearch").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("npAdd").click(); } };
    f.shipping_cost.oninput = render;
    render();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const info = readInfo(f);
      if (!info.customer_name.trim()) return alert("Falta el nombre del cliente.");
      if (!draft.length) return alert("Agregá al menos un producto.");
      const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try {
        const items = draft.map((d) => ({ product_id: d.product_id, variant: "", qty: d.qty, ...(priceEditable ? { unit_price: d.unit_price } : {}) }));
        let id;
        if (A.demo) {
          id = Math.max(...demo().keys(), 1044) + 1;
          const ship = num(f.shipping_cost.value);
          demo().set(id, { id, created_at: new Date().toISOString(), status: "pending", source: "manual", ...info, packages: Number(f.packages.value) || 1,
            shipping_cost: ship, note: f.note.value, packed_items: [], packed_at: null,
            total: draft.reduce((n, d) => n + d.qty * d.unit_price, 0) + ship,
            order_items: draft.map((d) => ({ product_id: d.product_id, variant: "", qty: d.qty, unit_price: d.unit_price, products: { name: d.name } })) });
        } else {
          id = await rpc("admin_create_order", { p_info: info, p_items: items, p_shipping_cost: num(f.shipping_cost.value),
            p_packages: Number(f.packages.value) || 1, p_note: f.note.value || null });
        }
        location.hash = `#pedido/${id}`;
      } catch (err) { btn.disabled = false; alert(err.message); }
    };
  }

  /* ---------- Impresión (iframe oculto: no la bloquea el navegador como a las ventanas emergentes) ---------- */
  function printDoc(html) {
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(fr);
    const d = fr.contentDocument;
    d.open(); d.write(html); d.close();
    const go = () => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); };
    const img = d.querySelector("img");
    if (img && !img.complete) { img.onload = go; img.onerror = go; } else setTimeout(go, 50);
  }

  // Código de barras Code 39 (solo dígitos, letras mayúsculas y "-"): lo leen todos los lectores.
  const C39 = { "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
    "8": "wnnwnnwnn", "9": "nnwwnnwnn", E: "wnnnnwnnw", X: "nnnwnwnnw", "-": "nwnnnnwnw", "*": "nwnnwnwnn" };
  function barcode(text) {
    const s = `*${text}*`; let x = 0; const bars = [];
    for (const ch of s) {
      const pat = C39[ch]; if (!pat) continue;
      [...pat].forEach((w, i) => { const width = w === "w" ? 3 : 1; if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="60"/>`); x += width; });
      x += 1;
    }
    return `<svg viewBox="0 0 ${x} 60" preserveAspectRatio="none" width="100%" height="60">${bars.join("")}</svg>`;
  }
  const logo = new URL("../assets/img/logo.png", location.href).href;
  const addr = (o) => [o.ship_address, [o.ship_city, o.ship_province].filter(Boolean).join(", "), o.ship_zip ? `CP ${o.ship_zip}` : ""].filter(Boolean);

  function labelHtml(o) {
    const n = Math.max(1, Number(o.packages) || 1);
    const one = (k) => `<section class="lab">
      <div class="top"><img src="${logo}" alt="EXE"><b class="num">#${o.id}</b></div>
      <div class="k">DESTINATARIO</div>
      <div class="to">${esc(o.customer_name || "")}</div>
      <div class="addr">${addr(o).map(esc).join("<br>") || "<i>Falta la dirección</i>"}${o.customer_phone ? `<br>Tel: ${esc(o.customer_phone)}` : ""}</div>
      <div class="k">REMITENTE</div>
      <div class="from">${SENDER.name} — ${SENDER.web}<br>Tel: ${SENDER.phone}</div>
      <div class="ship">Envío: <b>${esc(o.carrier || "a coordinar")}</b> · Bulto <b>${k} de ${n}</b></div>
      <div class="bar">${barcode(`EXE-${o.id}`)}</div><div class="cap">EXE-${o.id}</div>
    </section>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta pedido ${o.id}</title><style>
      @page { size: 100mm 150mm; margin: 0; }
      * { box-sizing: border-box; } body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
      .lab { width: 100mm; height: 150mm; padding: 7mm; page-break-after: always; display: flex; flex-direction: column; gap: 2.2mm; overflow: hidden; }
      .lab:last-child { page-break-after: auto; }
      .top { display: flex; justify-content: space-between; align-items: center; border-bottom: .6mm solid #000; padding-bottom: 3mm; }
      .top img { height: 11mm; } .num { font-size: 8mm; }
      .k { font-size: 3mm; letter-spacing: .3mm; margin-top: 1.5mm; }
      .to { font-size: 7mm; font-weight: 700; line-height: 1.1; } .addr { font-size: 4.6mm; line-height: 1.35; border-bottom: .6mm solid #000; padding-bottom: 3mm; }
      .from { font-size: 3.8mm; line-height: 1.35; border-bottom: .6mm solid #000; padding-bottom: 3mm; }
      .ship { font-size: 4mm; } .bar { margin-top: auto; } .bar svg { display: block; fill: #000; } .cap { text-align: center; font-size: 3.6mm; letter-spacing: .5mm; }
    </style></head><body>${Array.from({ length: n }, (_, i) => one(i + 1)).join("")}</body></html>`;
  }

  function pickHtml(o) {
    const packed = new Set(o.packed_items || []);
    return `<!doctype html><html><head><meta charset="utf-8"><title>Armado pedido ${o.id}</title><style>
      @page { size: A4; margin: 15mm; } body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 12pt; }
      h1 { font-size: 18pt; margin: 0 0 4pt; } .sub { color: #333; margin-bottom: 12pt; }
      table { width: 100%; border-collapse: collapse; } td, th { border-bottom: 1px solid #999; padding: 8pt 6pt; text-align: left; }
      .box { width: 14pt; height: 14pt; border: 1.5pt solid #000; display: inline-block; text-align: center; line-height: 13pt; }
      .sign { margin-top: 28pt; display: flex; gap: 40pt; } .sign div { border-top: 1px solid #000; padding-top: 4pt; width: 200pt; }
    </style></head><body>
      <h1>Pedido #${o.id} — lista de armado</h1>
      <div class="sub">${esc(o.customer_name || "")}${o.carrier ? ` · Envío: ${esc(o.carrier)}` : ""} · Bultos: ${Number(o.packages) || 1}${o.note ? `<br>Nota: ${esc(o.note)}` : ""}</div>
      <table><tr><th></th><th>Cant.</th><th>Producto</th><th>Ubicación</th></tr>
      ${(o.order_items || []).map((i) => `<tr><td><span class="box">${packed.has(key(i)) ? "✓" : ""}</span></td><td><b>${i.qty}</b></td>
        <td>${esc(i.products?.name || i.product_id)}${i.variant ? ` (${esc(i.variant)})` : ""}</td><td>${esc(i.products?.location || "")}</td></tr>`).join("")}
      </table>
      <div class="sign"><div>Armó</div><div>Controló</div></div>
    </body></html>`;
  }
})();
