(() => {
  const cfg = window.SITE_CONFIG;
  const STORAGE_KEY = "exe-cart";
  const PLACEHOLDER = "assets/img/placeholder.svg";
  const $ = (id) => document.getElementById(id);
  const money = (n) =>
    new Intl.NumberFormat(cfg.locale, { style: "currency", currency: cfg.currency, maximumFractionDigits: 0 }).format(n);
  // Sin foto real: imagen ilustrativa del producto (assets/img/products/muestra/<id>.webp, la genera
  // tools/imagenes_muestra.py); si tampoco existe, el dibujo genérico. Al subir una foto real la reemplaza sola.
  const sampleImg = (p) => `assets/img/products/muestra/${encodeURIComponent(p.id)}.webp`;
  const mainImg = (p) => (p.images && p.images[0]) || p.image || sampleImg(p);
  const priceLabel = (p) => (p.price > 0 ? money(p.price) : p.askStock ? "Consultar precio y stock" : "Consultar precio por WhatsApp");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const waLink = (text) => `https://wa.me/${cfg.whatsappNumber}?text=${encodeURIComponent(text)}`;

  let products = [];
  let filter = "Todos";
  let query = "";
  let sortBy = "";
  const fp = { brands: new Set(), tags: new Set(), min: null, max: null, stock: false, logo: null, ids: null };   // panel "Filtros" (+ logo de marca elegido abajo)
  // Marca por logo: busca sus palabras en la marca o el nombre (ej. el logo NVIDIA encuentra las placas "GeForce" de MSI)
  const brandMatches = (p, bf) => {
    const hay = ` ${`${p.brand || ""} ${p.name || ""}`.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, " ")} `;
    return bf.match.some((m) => hay.includes(` ${m} `));
  };
  let cart = load();

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch {}
  }

  /* ---------- Stock ---------- */
  // stock undefined = sin control de stock (siempre disponible, sin límite)
  const tracksStock = (p) => typeof p.stock === "number";
  const showsStock = (p) => tracksStock(p) && (p.showStock ?? cfg.showStock);
  const inCart = (id) => cart.filter((l) => l.id === id).reduce((n, l) => n + l.qty, 0);
  const available = (p) => (tracksStock(p) ? Math.max(0, p.stock - inCart(p.id)) : Infinity);

  // ¿Se puede agregar al carrito? (cartOk = false: si no hay precio o stock, solo se consulta por WhatsApp)
  const needsAsk = (p) => !(p.price > 0) || p.askStock || p.noStock || (tracksStock(p) && p.stock <= 0);
  const blocked = (p) => p.cartOk === false && needsAsk(p);
  const addBtn = (p, attr) => {
    if (blocked(p)) return `<a class="btn btn-primary" href="${esc(waLink(`Hola EXE! Quería consultar precio y disponibilidad de: ${p.name}`))}" target="_blank" rel="noopener">Consultar por WhatsApp</a>`;
    const out = tracksStock(p) && p.stock <= 0;
    return `<button class="btn btn-primary" ${attr}="${esc(p.id)}" ${out ? "disabled" : ""}>${out ? "Sin stock" : "Agregar al carrito"}</button>`;
  };

  function stockBadge(p) {
    if (p.askStock) return p.price > 0 ? `<span class="stock ask">Consultar stock</span>` : "";
    if (p.noStock) return `<span class="stock low">Sin stock · a pedido</span>`;
    if (!tracksStock(p)) return "";
    if (p.stock <= 0) return `<span class="stock out">Sin stock</span>`;
    if (!showsStock(p)) return `<span class="stock ok">En stock</span>`;
    const cls = p.stock <= cfg.lowStockThreshold ? "low" : "ok";
    return `<span class="stock ${cls}">${p.stock <= cfg.lowStockThreshold ? (p.stock === 1 ? "¡Última unidad!" : "¡Últimas " + p.stock + " unidades!") : p.stock + " disponibles"}</span>`;
  }

  /* ---------- Catálogo ---------- */
  function renderFilters() {
    const cats = ["Todos", ...new Set(products.map((p) => p.category).filter(Boolean))];
    $("filters").innerHTML = cats
      .map((c) => `<button class="chip${c === filter ? " active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join("");
  }

  // Gabinetes: se venden vacíos salvo que la descripción diga que incluye componentes
  const caseOnly = (p) => /gabinete/i.test(p.category || "") && !/(^|[^o]\s)incluye\s+(componentes|fuente|placa|procesador)/i.test(p.description || "");
  const CASE_NOTE = "el gabinete solo no incluye componentes dentro";
  function renderProducts() {
    const q = query.toLowerCase();
    const list = products.filter(
      (p) => (filter === "Todos" || p.category === filter) &&
        (!q || `${p.name} ${p.brand || ""} ${p.category || ""} ${(p.tags || []).join(" ")}`.toLowerCase().includes(q)) &&
        (!fp.brands.size || fp.brands.has(p.brand)) &&
        (!fp.tags.size || (p.tags || []).some((t) => fp.tags.has(t))) &&
        (fp.min == null || (p.price > 0 && p.price >= fp.min)) &&
        (fp.max == null || (p.price > 0 && p.price <= fp.max)) &&
        (!fp.stock || (tracksStock(p) && available(p) > 0)) &&
        (!fp.logo || brandMatches(p, fp.logo)) &&
        (!fp.ids || fp.ids.has(p.id))
    );
    const byPrice = (p) => (p.price > 0 ? p.price : Infinity);   // "Consultar" siempre al final
    if (sortBy === "price-asc") list.sort((a, b) => byPrice(a) - byPrice(b));
    if (sortBy === "price-desc") list.sort((a, b) => (b.price || -1) - (a.price || -1));
    if (sortBy === "name-asc") list.sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (sortBy === "name-desc") list.sort((a, b) => b.name.localeCompare(a.name, "es"));
    $("productGrid").innerHTML = list.length
      ? list.map((p, i) => {
          const out = tracksStock(p) && p.stock <= 0;
          return `
          <article class="card reveal" style="--d:${(i % 4) * 0.08}s">
            <a class="card-media" href="#producto/${encodeURIComponent(p.id)}" aria-label="Ver detalles de ${esc(p.name)}">
              <img src="${esc(mainImg(p))}" alt="${esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
              ${p.images && p.images[1] ? `<img class="alt" src="${esc(p.images[1])}" alt="" loading="lazy">` : ""}
              ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ""}
              ${p.outlet ? `<span class="tag tag-outlet">Outlet</span>` : ""}
              ${p.images && p.images.length > 1 ? `<span class="img-count" aria-hidden="true">${p.images.length} fotos</span>` : ""}
            </a>
            <div class="card-body">
              ${p.brand ? `<button class="tag-brand" type="button" data-brand-tag="${esc(p.brand)}" title="Ver todos los productos ${esc(p.brand)}">Marca: ${esc(p.brand)}</button>` : ""}
              <h3><a href="#producto/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
              <div class="price${p.price > 0 ? "" : " price-ask"}">${priceLabel(p)}</div>
              ${p.price > 0 ? `<span class="price-note">Consultar precio final</span>` : ""}
              ${p.condition ? `<span class="condition">Estado: ${esc(p.condition)}</span>` : ""}
              ${(p.tags || []).length ? `<div class="p-tags">${p.tags.filter((t) => t !== "Outlet").map((t) => `<button type="button" class="p-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
              ${stockBadge(p)}
              ${p.variants ? `<select data-variant="${esc(p.id)}" aria-label="Variante">${p.variants.map((v) => `<option>${esc(v)}</option>`).join("")}</select>` : ""}
              ${addBtn(p, "data-add")}
              <a class="card-more" href="#producto/${encodeURIComponent(p.id)}">Ver detalles${p.specs ? " y especificaciones" : ""}</a>
            </div>
          </article>`;
        }).join("")
      : fp.logo
        ? `<p class="empty-state">Todavía no tenemos productos ${esc(fp.logo.brand)} publicados.<br><a href="${esc(waLink(`Hola EXE! Busco productos ${fp.logo.brand}. ¿Qué tienen disponible?`))}" target="_blank" rel="noopener">Consultanos por WhatsApp</a> y te conseguimos lo que buscás.</p>`
        : `<p class="empty-state">No encontramos productos con ese criterio.</p>`;
    observeReveals();
  }

  /* ---------- Ficha de producto: galería + especificaciones ---------- */
  // Se abre con #producto/<id> (se puede compartir el link). Esc, la X o el fondo la cierran.
  let pdProduct = null, pdIndex = 0, pdOpenedByClick = false;
  const pdImages = (p) => (p.images && p.images.length ? p.images : [p.image || sampleImg(p)]);
  function pdSetImage(i) {
    const imgs = pdImages(pdProduct);
    pdIndex = (i + imgs.length) % imgs.length;
    const main = $("pdMain");
    main.src = imgs[pdIndex];
    main.alt = `${pdProduct.name} — foto ${pdIndex + 1} de ${imgs.length}`;
    document.querySelectorAll(".pd-thumbs button").forEach((b, k) => b.setAttribute("aria-current", String(k === pdIndex)));
    const c = $("pdCounter"); if (c) c.textContent = `${pdIndex + 1} / ${imgs.length}`;
  }
  function openProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    pdProduct = p;
    const imgs = pdImages(p), out = tracksStock(p) && p.stock <= 0;
    const waAsk = waLink(`Hola EXE! Quería consultar por: ${p.name}`);
    $("pd").innerHTML = `
      <button class="pd-close icon-btn" id="pdClose" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="pd-gallery">
        <div class="pd-stage">
          <img id="pdMain" src="${esc(imgs[0])}" alt="" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
          ${imgs.length > 1 ? `
            <button class="pd-nav prev" data-pd-step="-1" aria-label="Foto anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg></button>
            <button class="pd-nav next" data-pd-step="1" aria-label="Foto siguiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 5l7 7-7 7"/></svg></button>
            <span class="pd-counter" id="pdCounter"></span>` : ""}
        </div>
        ${imgs.length > 1 ? `<div class="pd-thumbs">${imgs.map((src, k) => `<button data-pd-img="${k}" aria-label="Ver foto ${k + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      </div>
      <div class="pd-info">
        ${p.brand ? `<button class="tag-brand" type="button" data-brand-tag="${esc(p.brand)}" title="Ver todos los productos ${esc(p.brand)}">Marca: ${esc(p.brand)}</button>` : ""}
        <h2 id="pdName">${esc(p.name)}</h2>
        <div class="price${p.price > 0 ? "" : " price-ask"}">${priceLabel(p)}</div>
        ${p.price > 0 ? `<span class="price-note">Consultá el precio final actualizado</span>` : ""}
        ${p.outlet ? `<p class="pd-condition"><span class="tag-outlet">Outlet</span> ${esc(p.condition || "")}</p>` : ""}
        ${(p.tags || []).length ? `<div class="p-tags">${p.tags.map((t) => `<button type="button" class="p-tag" data-tag="${esc(t)}" data-close-pd>${esc(t)}</button>`).join("")}</div>` : ""}
        <div class="pd-admin" id="pdAdmin" hidden></div>
        ${stockBadge(p)}
        ${p.variants ? `<label class="field">Variante<select id="pdVariant">${p.variants.map((v) => `<option>${esc(v)}</option>`).join("")}</select></label>` : ""}
        <div class="pd-actions">
          ${out || blocked(p) ? "" : `<div class="pd-qty-row"><label for="pdQty">Cantidad</label>
            <div class="qty-stepper">
              <button type="button" data-pd-qty="-1" aria-label="Restar una unidad">−</button>
              <input id="pdQty" type="number" inputmode="numeric" min="1" max="${Math.min(99, available(p))}" value="1" aria-label="Cantidad de unidades">
              <button type="button" data-pd-qty="1" aria-label="Sumar una unidad">+</button>
            </div></div>`}
          ${addBtn(p, "data-pd-add")}
          <a class="btn btn-outline" href="${esc(waAsk)}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
          <button type="button" class="btn btn-outline btn-share" data-share-product="${esc(p.id)}">${SHARE_ICON} Compartir</button>
        </div>
        ${caseOnly(p) ? `<p class="pd-note">⚠️ Se vende solo el gabinete: ${CASE_NOTE}.</p>` : ""}
        ${p.description ? `<div class="pd-desc">${esc(p.description)}</div>` : ""}
        <p class="pd-illus">Las imágenes presentadas son puramente ilustrativas.</p>
        <h3 class="pd-specs-title">Especificaciones</h3>
        ${p.specs && p.specs.length
          ? p.specs.map((s, k) => `<details class="pd-spec"${k === 0 ? " open" : ""}><summary>${esc(s.title)}</summary>
              <table>${s.rows.map(([key, val]) => `<tr><th>${esc(key)}</th><td>${esc(val)}</td></tr>`).join("")}</table></details>`).join("")
          : `<p class="pd-nospecs">La ficha técnica de este producto está en revisión. Consultanos por WhatsApp y te pasamos todos los datos.</p>`}
      </div>`;
    pdSetImage(0); pdSetQty(1); adminSources(p.id);
    $("pdOverlay").hidden = false;
    requestAnimationFrame(() => $("pdOverlay").classList.add("show"));
    document.body.classList.add("no-scroll");
    $("pdClose").focus();
  }
  function closeProduct(fromHash) {
    if ($("pdOverlay").hidden) return;
    $("pdOverlay").classList.remove("show");
    document.body.classList.remove("no-scroll");
    setTimeout(() => { $("pdOverlay").hidden = true; }, 250);
    pdProduct = null;
    if (!fromHash) {
      if (pdOpenedByClick) history.back();
      else history.replaceState(null, "", location.pathname + location.search + "#productos");
    }
    pdOpenedByClick = false;
  }
  function routeProduct() {
    const m = location.hash.match(/^#producto\/(.+)$/);
    if (m) openProduct(decodeURIComponent(m[1])); else closeProduct(true);
  }
  window.addEventListener("hashchange", routeProduct);
  // Links desde otras páginas (ej. la 404): #buscar/<texto> filtra el catálogo y #carrito abre el pedido.
  function routeSearch() {
    const m = location.hash.match(/^#buscar\/(.*)$/);
    if (m) {
      query = decodeURIComponent(m[1]).trim(); $("search").value = query; renderProducts();
      history.replaceState(null, "", location.pathname + location.search + "#productos");
      $("productos").scrollIntoView();
    } else if (location.hash === "#carrito") {
      history.replaceState(null, "", location.pathname + location.search);
      $("cartOpen").click();
    }
  }
  window.addEventListener("hashchange", routeSearch);

  /* ---------- Solo administradores: precio de referencia y link de compra ----------
     Los links NO están en products.json (es público): viven en Supabase (tabla product_sources, RLS products.write).
     Supabase solo se carga si hay una sesión iniciada en este navegador. */
  let adminApi = null;
  const hasSession = (() => { try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch { return false; } })();
  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  const adminReady = hasSession && cfg.supabaseUrl
    ? loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js")
        .then(() => loadScript("assets/js/backend.js"))
        .then(async () => {
          const be = window.EXE_BACKEND; if (!be) return;
          const perms = await be.permissions();
          if (perms.has("products.write")) adminApi = be.sb;
        }).catch(() => {})
    : Promise.resolve();
  async function adminSources(id) {
    await adminReady;
    const cur = (v, c) => (c === "USD" ? "US$ " + Number(v).toLocaleString("es-AR") : money(v));
    const box = $("pdAdmin"); if (!box || !adminApi) return;
    const { data } = await adminApi.from("product_sources").select("store,url,ref_price,currency,ship_cost,ship_currency,margin,sale_price,delivery_note,checked_at").eq("product_id", id).order("ref_price");
    if (!data || !data.length) { box.innerHTML = `<b>Solo admins</b> · Sin precio de referencia cargado todavía.`; box.hidden = false; return; }
    box.innerHTML = `<b>Solo admins · precio de referencia</b>` + data.map((d) =>
      `<div class="pd-admin-row">${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.store)}</a>` : `<b>${esc(d.store)}</b>`}
        <span>Compra ${cur(d.ref_price, d.currency)}${d.ship_cost == null ? " · envío a consultar" : Number(d.ship_cost) === 0 ? " · envío gratis" : ` + envío ${cur(d.ship_cost, d.ship_currency)}`}${d.sale_price ? ` → venta ${money(d.sale_price)} (+${Math.round(d.margin * 100)} %)` : ""}</span>
        <small>${d.delivery_note ? esc(d.delivery_note) + " · " : ""}revisado ${new Date(d.checked_at).toLocaleDateString("es-AR")}</small></div>`).join("");
    box.hidden = false;
  }

  // Cantidad en la ficha: entre 1 y el stock disponible (máx. 99)
  const pdQty = () => { const i = $("pdQty"); return i ? Math.max(1, parseInt(i.value, 10) || 1) : 1; };
  function pdSetQty(n) {
    const i = $("pdQty"); if (!i) return;
    const max = Number(i.max) || 99;
    i.value = Math.min(max, Math.max(1, Math.round(n) || 1));
    i.previousElementSibling.disabled = i.value <= 1;
    i.nextElementSibling.disabled = i.value >= max;
  }
  $("pdOverlay").addEventListener("change", (e) => { if (e.target.id === "pdQty") pdSetQty(pdQty()); });
  $("pdOverlay").addEventListener("click", (e) => {
    if (e.target === $("pdOverlay") || e.target.closest("#pdClose")) return closeProduct();
    const step = e.target.closest("[data-pd-step]"); if (step) return pdSetImage(pdIndex + Number(step.dataset.pdStep));
    const th = e.target.closest("[data-pd-img]"); if (th) return pdSetImage(Number(th.dataset.pdImg));
    const q = e.target.closest("[data-pd-qty]"); if (q) return pdSetQty(pdQty() + Number(q.dataset.pdQty));
    const addBtn = e.target.closest("[data-pd-add]");
    if (addBtn) { add(addBtn.dataset.pdAdd, $("pdVariant") ? $("pdVariant").value : null, pdQty()); pdSetQty(1); renderProducts(); }
  });
  document.addEventListener("keydown", (e) => {
    if ($("pdOverlay").hidden) return;
    if (e.key === "Escape") closeProduct();
    else if (e.key === "ArrowRight") pdSetImage(pdIndex + 1);
    else if (e.key === "ArrowLeft") pdSetImage(pdIndex - 1);
  });
  // Deslizar con el dedo entre fotos
  let pdTouchX = null;
  $("pdOverlay").addEventListener("touchstart", (e) => { if (e.target.closest(".pd-stage")) pdTouchX = e.touches[0].clientX; }, { passive: true });
  $("pdOverlay").addEventListener("touchend", (e) => {
    if (pdTouchX === null) return;
    const dx = e.changedTouches[0].clientX - pdTouchX; pdTouchX = null;
    if (Math.abs(dx) > 40) pdSetImage(pdIndex + (dx < 0 ? 1 : -1));
  });
  document.addEventListener("click", (e) => { if (e.target.closest('a[href^="#producto/"]')) pdOpenedByClick = true; }, true);

  /* ---------- Carrito ---------- */
  function add(id, variant, qty = 1) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (available(p) <= 0) return toast("No hay más stock disponible de este producto");
    const n = Math.min(qty, available(p));
    const line = cart.find((l) => l.id === id && l.variant === variant);
    if (line) line.qty += n;
    else cart.push({ id, variant, qty: n });
    if (n < qty) { save(); renderCart(); return toast(`Solo había ${n} disponible${n > 1 ? "s" : ""}: se agregó${n > 1 ? "ron" : ""} al carrito`); }
    save(); renderCart();
    const badge = $("cartCount");
    badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump");
    toast(n > 1 ? `${n} unidades agregadas al carrito` : "Agregado al carrito");
  }

  function renderCart() {
    // Descarta líneas de productos que ya no existen y recorta cantidades que superen el stock actual.
    cart = cart.filter((l) => products.some((p) => p.id === l.id));
    const lines = cart.map((l) => ({ ...l, product: products.find((p) => p.id === l.id) }));
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const total = lines.reduce((n, l) => n + l.qty * (l.product.price || 0), 0);
    const hasConsult = lines.some((l) => !(l.product.price > 0));
    $("cartCount").textContent = count;
    $("cartTotal").textContent = total ? money(total) + (hasConsult ? " + a consultar" : "") : hasConsult ? "A consultar" : money(0);
    $("sendWa").disabled = count === 0;
    $("cartItems").innerHTML = lines.length
      ? lines.map((l, i) => `
        <li>
          <img src="${esc(mainImg(l.product))}" alt="" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
          <div class="info">${esc(l.product.name)}
            <small>${l.variant ? esc(l.variant) + " · " : ""}${priceLabel(l.product)}${l.product.noStock ? " · a pedido" : l.product.askStock ? " · stock a consultar" : ""}${caseOnly(l.product) ? ` · ${CASE_NOTE}` : ""}</small>
          </div>
          <div class="qty">
            <button data-dec="${i}" aria-label="Restar">−</button>
            <span>${l.qty}</span>
            <button data-inc="${i}" aria-label="Sumar" ${available(l.product) <= 0 ? "disabled" : ""}>+</button>
          </div>
        </li>`).join("")
      : `<li class="cart-empty">Tu carrito está vacío</li>`;
    return { lines, total, hasConsult };
  }

  // ---------- Envío (Envia.com) ----------
  let shipping = null; // { carrier, service, label, cp, cost, sig }
  let shipOptions = [];
  const shipOn = cfg.shipping?.enabled && cfg.supabaseUrl && cfg.supabaseAnonKey;
  if (shipOn) $("ship").hidden = false;
  async function shipApi(payload) {
    const r = await fetch(`${cfg.supabaseUrl}/functions/v1/envios`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error al cotizar");
    return data;
  }
  function renderShip() {
    $("shipOpts").innerHTML = shipOptions.length
      ? shipOptions.map((o, i) => `<label><input type="radio" name="ship" value="${i}"> ${esc(o.carrier)} · ${esc(o.descripcion)}${o.dias ? ` <small>(${esc(o.dias)})</small>` : ""} <b>${money(o.precio)}</b></label>`).join("")
      : `<small>No hay tarifas para ese código postal. Te cotizamos por WhatsApp.</small>`;
  }
  if (shipOn) {
    $("shipQuote").onclick = async () => {
      const cp = $("shipCp").value.trim();
      if (!/^\d{4}$/.test(cp)) return toast("Ingresá un código postal de 4 dígitos");
      if (!cart.length) return toast("Agregá productos al carrito");
      $("shipQuote").disabled = true; shipping = null;
      $("shipOpts").innerHTML = "<small>Cotizando…</small>";
      try { shipOptions = (await shipApi({ action: "quote", cp, items: cart.map((l) => ({ id: l.id, qty: l.qty })) })).options || []; renderShip(); }
      catch (e) { $("shipOpts").innerHTML = `<small>${esc(e.message)}</small>`; }
      finally { $("shipQuote").disabled = false; }
    };
    $("shipOpts").onchange = (e) => {
      const o = shipOptions[Number(e.target.value)];
      shipping = { carrier: o.carrier, service: o.service, label: `${o.carrier} · ${o.descripcion}`, cp: $("shipCp").value.trim(), cost: o.precio, sig: cartSig() };
    };
  }

  const cartSig = () => cart.map((l) => `${l.id}:${l.variant || ""}:${l.qty}`).join("|");

  function buildMessage() {
    const { lines, total, hasConsult } = renderCart();
    // Si el carrito cambió después de cotizar, la tarifa ya no vale.
    if (shipping && shipping.sig !== cartSig()) { shipping = null; $("shipOpts").innerHTML = "<small>El carrito cambió: volvé a calcular el envío.</small>"; }
    const name = $("customerName").value.trim();
    const note = $("customerNote").value.trim();
    const rows = lines.map((l) => {
      const sub = l.product.price > 0 ? money(l.qty * l.product.price) : "a consultar";
      const tag = l.product.noStock ? " (a pedido)" : l.product.askStock ? " (consultar stock)" : "";
      const empty = caseOnly(l.product) ? ` (${CASE_NOTE})` : "";
      return `• ${l.qty} x ${l.product.name}${l.variant ? ` (${l.variant})` : ""}${tag}${empty} — ${sub}`;
    });
    return [
      `Hola EXE! ${name ? `Soy ${name}. ` : ""}Quiero hacer este pedido:`,
      "",
      ...rows,
      "",
      total ? `*Total estimado: ${money(total)}*${hasConsult ? " (+ productos a consultar)" : ""}` : "*Precio a consultar*",
      shipping ? `Envío ${shipping.label} (CP ${shipping.cp}): ${money(shipping.cost)} — cotización estimada` : "",
      note ? `\nNota: ${note}` : "",
    ].join("\n").trim();
  }

  function toggleCart(open) {
    $("cart").classList.toggle("open", open);
    $("cart").setAttribute("aria-hidden", String(!open));
    $("overlay").classList.toggle("show", open);
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  /* ---------- Compartir (producto y presupuesto) ----------
     Si el dispositivo tiene menú nativo de compartir (Android, iPhone/iPad, Mac, Windows con Chrome/Edge) se usa ese:
     muestra las apps que la persona tiene instaladas. Si no (ej. Linux o Firefox de escritorio), se abre un menú propio. */
  const siteBase = () => location.origin + location.pathname.replace(/[^/]*$/, "");
  function sharePlatform() {
    const ua = navigator.userAgent || "", pf = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(pf) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Mac/.test(pf)) return "mac";
    if (/Android/.test(ua)) return "android";
    if (/Win/.test(pf)) return "windows";
    return "linux";
  }
  const PLATFORM = sharePlatform();
  document.documentElement.dataset.platform = PLATFORM;
  // Ícono de compartir de cada sistema: Apple (caja con flecha arriba), Windows (caja con flecha curva), Android/Linux (3 nodos)
  const SHARE_ICON = `<svg class="share-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    PLATFORM === "ios" || PLATFORM === "mac" ? '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>'
    : PLATFORM === "windows" ? '<path d="M14 5l5 4-5 4"/><path d="M19 9h-6a6 6 0 0 0-6 6v1"/><path d="M4 11v9h14v-3"/>'
    : '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>'}</svg>`;

  function shareMenu(data) {
    let dlg = $("shareDlg");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "shareDlg"; dlg.className = "share-dlg";
      document.body.appendChild(dlg);
      dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-share-close]")) dlg.close(); });
    }
    const t = encodeURIComponent(data.text), u = encodeURIComponent(data.url), both = encodeURIComponent(`${data.text}\n${data.url}`);
    const opts = [
      ["WhatsApp", `https://wa.me/?text=${both}`, "#25d366"],
      ["Telegram", `https://t.me/share/url?url=${u}&text=${t}`, "#229ed9"],
      ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`, "#1877f2"],
      ["X", `https://x.com/intent/post?text=${t}&url=${u}`, "#111"],
      ["Email", `mailto:?subject=${encodeURIComponent(data.title)}&body=${both}`, "#6b7280"],
    ];
    dlg.innerHTML = `<div class="share-box" role="document">
        <div class="share-head"><b>${esc(data.title)}</b><button type="button" class="icon-btn" data-share-close aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class="share-grid">${opts.map(([n, href, c]) => `<a href="${esc(href)}" target="_blank" rel="noopener" style="--c:${c}"><span>${esc(n[0])}</span>${esc(n)}</a>`).join("")}
          <button type="button" data-copy style="--c:#0084d6"><span>⧉</span>Copiar</button></div>
        <input class="share-url" readonly value="${esc(data.url)}" aria-label="Link para compartir">
      </div>`;
    dlg.querySelector("[data-copy]").onclick = async () => {
      const txt = `${data.text}\n${data.url}`;
      try { await navigator.clipboard.writeText(txt); toast("Copiado: pegalo donde quieras"); }
      catch (e) { const i = dlg.querySelector(".share-url"); i.select(); document.execCommand && document.execCommand("copy"); toast("Link seleccionado para copiar"); }
    };
    dlg.showModal();
  }
  async function share(data) {
    if (navigator.share) {
      try { await navigator.share({ title: data.title, text: data.text, url: data.url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }   // la persona canceló: no hacer nada
    }
    shareMenu(data);
  }
  function shareProduct(id) {
    const p = products.find((x) => x.id === id); if (!p) return;
    share({ title: p.name, text: `Mirá este producto en EXE: ${p.name} — ${priceLabel(p)}`, url: `${siteBase()}#producto/${encodeURIComponent(p.id)}` });
  }
  // Presupuesto: el link lleva los productos del carrito; quien lo abre los puede cargar en su carrito con un toque.
  function shareBudget() {
    if (!cart.length) return toast("Agregá productos al carrito para compartir el presupuesto");
    const { lines, total, hasConsult } = renderCart();
    const code = cart.map((l) => [l.id, l.qty, l.variant || ""].map(encodeURIComponent).join("~")).join(".");
    const rows = lines.map((l) => `• ${l.qty} x ${l.product.name}${l.variant ? ` (${l.variant})` : ""} — ${l.product.price > 0 ? money(l.qty * l.product.price) : "a consultar"}`);
    const text = ["Presupuesto EXE:", ...rows, total ? `Total estimado: ${money(total)}${hasConsult ? " (+ productos a consultar)" : ""}` : "Precio a consultar"].join("\n");
    share({ title: "Presupuesto EXE", text, url: `${siteBase()}#presupuesto/${code}` });
  }
  function routeBudget() {
    const m = location.hash.match(/^#presupuesto\/(.+)$/);
    if (!m || !products.length) return;
    const items = m[1].split(".").slice(0, 50).map((x) => x.split("~").map((v) => { try { return decodeURIComponent(v); } catch (e) { return ""; } }))
      .map(([id, q, v]) => ({ id, qty: Math.max(1, Math.min(99, parseInt(q, 10) || 1)), variant: v || null }))
      .filter((it) => products.some((p) => p.id === it.id));
    history.replaceState(null, "", location.pathname + location.search + "#productos");
    if (!items.length) return toast("El presupuesto compartido ya no tiene productos disponibles");
    if (!confirm(`Te compartieron un presupuesto con ${items.length} producto${items.length > 1 ? "s" : ""}. ¿Lo cargo en tu carrito?`)) return;
    items.forEach((it) => add(it.id, it.variant, it.qty));
    toggleCart(true);
  }
  window.addEventListener("hashchange", routeBudget);

  /* ---------- Eventos ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a[data-filter]");
    if (!t) return;
    if (t.dataset.add) {
      const sel = document.querySelector(`[data-variant="${CSS.escape(t.dataset.add)}"]`);
      add(t.dataset.add, sel ? sel.value : null);
      renderProducts();
    } else if (t.dataset.inc) {
      const l = cart[+t.dataset.inc];
      const p = products.find((x) => x.id === l.id);
      if (available(p) > 0) { l.qty++; save(); renderCart(); }
    } else if (t.dataset.dec) {
      const i = +t.dataset.dec;
      if (--cart[i].qty <= 0) cart.splice(i, 1);
      save(); renderCart();
    } else if (t.dataset.cat) {
      filter = t.dataset.cat; renderFilters(); renderProducts();
    } else if (t.dataset.filter) {
      filter = products.some((p) => p.category === t.dataset.filter) ? t.dataset.filter : "Todos";
      renderFilters(); renderProducts();
    }
  });

  $("search").addEventListener("input", (e) => { query = e.target.value.trim(); renderProducts(); });

  /* ---------- Filtros y orden ---------- */
  function renderTagOptions() {
    const tags = [...new Set(products.flatMap((p) => p.tags || []))].sort((a, b) => a.localeCompare(b, "es"));
    $("fpTagsBox").hidden = !tags.length;
    $("fpTags").innerHTML = tags.map((t) => `<label class="fp-check"><input type="checkbox" value="${esc(t)}"${fp.tags.has(t) ? " checked" : ""}> ${esc(t)}</label>`).join("");
  }
  function renderBrandOptions() {
    renderTagOptions();
    const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    $("fpBrands").innerHTML = brands.map((b) =>
      `<label class="fp-check"><input type="checkbox" value="${esc(b)}"${fp.brands.has(b) ? " checked" : ""}> ${esc(b)}</label>`).join("");
  }
  function updateFilters() {
    const n = fp.brands.size + fp.tags.size + (fp.min != null || fp.max != null ? 1 : 0) + (fp.stock ? 1 : 0) + (fp.logo ? 1 : 0);
    $("activeBrand").hidden = !fp.logo && !fp.ids;
    $("activeBrand").innerHTML = (fp.logo ? `<button type="button" class="chip active" id="clearLogo" aria-label="Quitar filtro de marca ${esc(fp.logo.brand)}">Marca: ${esc(fp.logo.brand)} <span aria-hidden="true">✕</span></button>` : "") +
      (fp.ids ? `<button type="button" class="chip active" id="clearSel" aria-label="Ver todos los productos">Selección (${fp.ids.size}) <span aria-hidden="true">✕</span></button>` : "");
    $("filtersCount").hidden = !n; $("filtersCount").textContent = n;
    renderProducts();
  }
  const numOrNull = (v) => (v === "" || isNaN(+v) ? null : Math.max(0, +v));
  function toggleFilters(open) {
    $("filtersPanel").hidden = !open; $("filtersBtn").setAttribute("aria-expanded", open);
  }
  $("filtersBtn").onclick = () => toggleFilters($("filtersPanel").hidden);
  $("fpDone").onclick = () => { toggleFilters(false); $("filtersBtn").focus(); };   // "Listo" = cerrar el panel (los filtros quedan aplicados)
  $("filtersPanel").addEventListener("input", (e) => {
    const t = e.target;
    if (t.closest("#fpBrands")) t.checked ? fp.brands.add(t.value) : fp.brands.delete(t.value);
    if (t.closest("#fpTags")) t.checked ? fp.tags.add(t.value) : fp.tags.delete(t.value);
    if (t.id === "fpMin") fp.min = numOrNull(t.value);
    if (t.id === "fpMax") fp.max = numOrNull(t.value);
    if (t.id === "fpStock") fp.stock = t.checked;
    updateFilters();
  });
  $("fpClear").onclick = () => {
    fp.brands.clear(); fp.tags.clear(); fp.min = fp.max = null; fp.stock = false; fp.logo = null; fp.ids = null;
    $("fpMin").value = $("fpMax").value = ""; $("fpStock").checked = false;
    renderBrandOptions(); updateFilters();
  };
  // Etiquetas "Marca: X" y logos de marcas: muestran solo esa marca y llevan al catálogo
  function showBrand(name) {
    const logo = (cfg.brandLogos || []).find((l) => (l.brand || l.name) === name);
    const known = products.some((p) => p.brand === name);
    fp.brands.clear(); fp.logo = null; filter = "Todos"; query = ""; $("search").value = "";
    if (known) fp.brands.add(name);
    else fp.logo = { brand: name, match: logo && logo.match ? logo.match : [name.toLowerCase()] };
    renderFilters(); renderBrandOptions(); updateFilters();
    $("productos").scrollIntoView({ behavior: "smooth" });
  }
  document.addEventListener("click", (e) => {
    const tg = e.target.closest("[data-tag]");
    if (tg) {
      if (!$("pdOverlay").hidden) closeProduct();
      fp.tags.clear(); fp.tags.add(tg.dataset.tag); renderBrandOptions(); updateFilters();
      return $("productos").scrollIntoView({ behavior: "smooth" });
    }
    const sel = e.target.closest("[data-dz-ids], #clearSel");
    if (sel) {
      e.preventDefault();
      fp.ids = sel.id === "clearSel" ? null : new Set(sel.dataset.dzIds.split(",").filter(Boolean));
      if (fp.ids) { filter = "Todos"; renderFilters(); }
      updateFilters();
      return fp.ids && $("productos").scrollIntoView({ behavior: "smooth" });
    }
    const t = e.target.closest("[data-brand-tag], #clearLogo");
    if (!t) return;
    if (t.id === "clearLogo") { fp.logo = null; return updateFilters(); }
    if (!$("pdOverlay").hidden) closeProduct();
    showBrand(t.dataset.brandTag);
  });

  // Menú "Ordenar por" con el estilo del sitio (reemplaza el <select> nativo)
  const sortBtn = $("sortBtn"), sortMenu = $("sortMenu");
  const sortOpts = [...sortMenu.querySelectorAll("[role=option]")];
  function toggleSort(open) {
    sortMenu.hidden = !open; sortBtn.setAttribute("aria-expanded", open);
    if (open) (sortOpts.find((o) => o.getAttribute("aria-selected") === "true") || sortOpts[0]).focus();
  }
  function pickSort(o) {
    sortBy = o.dataset.sort;
    sortOpts.forEach((x) => x.setAttribute("aria-selected", x === o));
    $("sortLabel").textContent = sortBy ? o.textContent : "Ordenar por";
    toggleSort(false); sortBtn.focus(); renderProducts();
  }
  sortOpts.forEach((o) => (o.tabIndex = -1));
  sortBtn.onclick = () => toggleSort(sortMenu.hidden);
  sortMenu.addEventListener("click", (e) => { const o = e.target.closest("[role=option]"); if (o) pickSort(o); });
  sortMenu.addEventListener("keydown", (e) => {
    const i = sortOpts.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); sortOpts[Math.min(i + 1, sortOpts.length - 1)].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sortOpts[Math.max(i - 1, 0)].focus(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (i >= 0) pickSort(sortOpts[i]); }
    else if (e.key === "Escape" || e.key === "Tab") { toggleSort(false); if (e.key === "Escape") sortBtn.focus(); }
  });
  document.addEventListener("click", (e) => { if (!sortMenu.hidden && !e.target.closest(".sort-wrap")) toggleSort(false); });
  $("cartOpen").onclick = () => toggleCart(true);
  $("cartClose").onclick = () => toggleCart(false);
  $("overlay").onclick = () => toggleCart(false);
  document.addEventListener("keydown", (e) => e.key === "Escape" && $("pdOverlay").hidden && toggleCart(false));
  $("cartShare").onclick = shareBudget;
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-share-product]"); if (b) shareProduct(b.dataset.shareProduct); });
  $("cartClear").onclick = () => { cart = []; shipping = null; if (shipOn) $("shipOpts").innerHTML = ""; save(); renderCart(); renderProducts(); };
  $("sendWa").onclick = () => window.open(waLink(buildMessage()), "_blank", "noopener");

  /* ---------- Header / menú ---------- */
  // ---------- Tema: claro / automático / oscuro ----------
  // "auto" no guarda nada y deja que el CSS siga al sistema (prefers-color-scheme).
  const themeSwitch = $("themeSwitch");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const MODES = ["light", "auto", "dark"];
  const syncThemeMeta = () => {
    const t = document.documentElement.dataset.theme;
    const dark = t === "dark" || (t !== "light" && darkQuery.matches);
    if (themeMeta) themeMeta.content = dark ? "#05070b" : "#ffffff";
  };
  function applyTheme(mode, save = true) {
    const root = document.documentElement;
    if (mode === "auto") delete root.dataset.theme; else root.dataset.theme = mode;
    if (save) { try { mode === "auto" ? localStorage.removeItem("exe-theme") : localStorage.setItem("exe-theme", mode); } catch (e) {} }
    themeSwitch.dataset.mode = mode;
    themeSwitch.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    syncThemeMeta();
  }
  let storedTheme = null;
  try { storedTheme = localStorage.getItem("exe-theme"); } catch (e) {}
  applyTheme(MODES.includes(storedTheme) ? storedTheme : "auto", false);
  themeSwitch.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) applyTheme(b.dataset.mode);
  });
  themeSwitch.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = MODES[Math.min(2, Math.max(0, MODES.indexOf(themeSwitch.dataset.mode) + step))];
    applyTheme(next);
    themeSwitch.querySelector(`[data-mode="${next}"]`).focus();
  });
  darkQuery.addEventListener("change", syncThemeMeta);

  // ---------- Botón flotante de WhatsApp: visible / oculto (preferencia guardada en este dispositivo) ----------
  const waSwitch = $("waSwitch");
  function applyWa(mode, save = true) {
    if (mode === "off") document.documentElement.dataset.waFloat = "off"; else delete document.documentElement.dataset.waFloat;
    if (save) { try { mode === "off" ? localStorage.setItem("exe-wa-float", "off") : localStorage.removeItem("exe-wa-float"); } catch (e) {} }
    waSwitch.dataset.mode = mode;
    waSwitch.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  if (waSwitch) {
    let storedWa = null;
    try { storedWa = localStorage.getItem("exe-wa-float"); } catch (e) {}
    applyWa(storedWa === "off" ? "off" : "on", false);
    waSwitch.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) applyWa(b.dataset.mode); });
    waSwitch.addEventListener("keydown", (e) => {
      const next = { ArrowLeft: "off", ArrowUp: "off", ArrowRight: "on", ArrowDown: "on" }[e.key];
      if (!next) return;
      e.preventDefault(); applyWa(next); waSwitch.querySelector(`[data-mode="${next}"]`).focus();
    });
  }

  const header = $("header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  $("menuToggle").onclick = () => $("nav").classList.toggle("open");
  $("nav").addEventListener("click", (e) => e.target.tagName === "A" && $("nav").classList.remove("open"));

  // Link activo según la sección visible
  const navLinks = [...document.querySelectorAll(".nav a")];
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle("active", a.hash === "#" + en.target.id));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  navLinks.forEach((a) => { const s = document.querySelector(a.hash); if (s) spy.observe(s); });

  /* ---------- Carrusel principal ---------- */
  const track = $("heroTrack");
  let slideCount = 0, current = 0, timer, dots = [];
  function go(i) {
    if (!slideCount) return;
    current = (i + slideCount) % slideCount;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, k) => d.classList.toggle("active", k === current));
  }
  const play = () => { clearInterval(timer); if (slideCount > 1) timer = setInterval(() => go(current + 1), 5000); };
  // Se puede volver a llamar si el panel cambió las imágenes del carrusel
  function setupHero() {
    slideCount = track.children.length; current = 0;
    $("dots").innerHTML = [...track.children].map((_, i) => `<button aria-label="Imagen ${i + 1}"${i === 0 ? ' class="active"' : ""}></button>`).join("");
    dots = [...$("dots").children];
    dots.forEach((d, i) => d.addEventListener("click", () => { go(i); play(); }));
    [$("heroPrev"), $("heroNext"), $("dots")].forEach((el) => (el.hidden = slideCount < 2));
    go(0); play();
  }
  $("heroPrev").onclick = () => { go(current - 1); play(); };
  $("heroNext").onclick = () => { go(current + 1); play(); };
  // Deslizar con el dedo en celulares
  let touchX = null;
  track.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  track.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) { go(current + (dx < 0 ? 1 : -1)); play(); }
    touchX = null;
  });
  setupHero();

  /* ---------- Página editable desde el panel (tabla site_blocks) ----------
     Cada sección del inicio tiene data-block="id". Supabase dice el orden, cuáles se muestran y su contenido;
     las secciones nuevas (texto, imagen, imagen + texto, aviso) se crean acá. Si Supabase no responde, queda el HTML. */
  const src = (u) => esc(u || "");
  const linkOf = (d) => (d.link ? `href="${src(d.link)}"${/^https?:/.test(d.link) ? ' target="_blank" rel="noopener"' : ""}` : d.filter ? `href="#productos" data-filter="${esc(d.filter)}"` : "");
  const renderers = {
    hero(el, d) {
      if (!d.slides || !d.slides.length) return;
      track.innerHTML = d.slides.map((sl, i) => `<div class="hero-slide">${sl.link ? `<a ${linkOf(sl)}>` : ""}<img src="${src(sl.img)}" alt="${esc(sl.alt || "")}" width="1904" height="650"${i ? ' loading="lazy"' : ' fetchpriority="high"'}>${sl.link ? "</a>" : ""}</div>`).join("");
      setupHero();
    },
    tarjetas(el, d) {
      if (!d.cards) return;
      el.innerHTML = d.cards.map((c, i) => `<article class="brand-card reveal" style="--d:${i * 0.12}s${c.pos ? `;--pos:${esc(c.pos)}` : ""}"><picture>${c.img_mobile ? `<source media="(max-width: 767px)" srcset="${src(c.img_mobile)}">` : ""}<img src="${src(c.img)}" alt="${esc(c.alt || "")}" width="1056" height="1440" loading="lazy"></picture>${c.text ? `<a ${linkOf(c) || 'href="#productos"'} class="btn btn-banner">${esc(c.text)}</a>` : ""}</article>`).join("");
    },
    catalogo(el, d) {
      const h = el.querySelector(".section-head"); if (!h) return;
      if (d.title) h.querySelector("h2").textContent = d.title;
      if (d.text !== undefined) h.querySelector("p").textContent = d.text;
    },
    banner(el, d) {
      const a = el.querySelector(".wide-banner"); if (!a) return;
      if (d.img) a.style.backgroundImage = `url("${String(d.img).replace(/"/g, "")}")`;
      a.setAttribute("aria-label", d.alt || "");
      a.removeAttribute("data-filter"); a.removeAttribute("target");
      if (d.link) { a.href = d.link; if (/^https?:/.test(d.link)) { a.target = "_blank"; a.rel = "noopener"; } }
      else { a.href = "#productos"; if (d.filter) a.dataset.filter = d.filter; }
    },
    beneficios(el, d) {
      const feats = el.querySelectorAll(".feature"); if (!d.items) return;
      d.items.forEach((it, i) => { const f = feats[i]; if (!f) return; f.querySelector("h3").textContent = it.title || ""; f.querySelector("p").textContent = it.text || ""; });
      feats.forEach((f, i) => (f.hidden = i >= d.items.length));
    },
    logos() {},
    contacto(el, d) {
      const c = el.querySelector(".contact-card"); if (!c) return;
      if (d.title) c.querySelector("h2").textContent = d.title;
      if (d.text !== undefined) c.querySelector("p").textContent = d.text;
      if (d.button) $("waDirect").textContent = d.button;
    },
  };
  const creators = {
    texto: (d) => `<div class="container cms-text reveal">${d.title ? `<h2>${esc(d.title)}</h2><span class="divider"></span>` : ""}${d.text ? `<p>${esc(d.text)}</p>` : ""}${d.button_text ? `<a class="btn btn-primary" ${linkOf({ link: d.button_link }) || 'href="#productos"'}>${esc(d.button_text)}</a>` : ""}</div>`,
    imagen: (d) => `<div class="container cms-img reveal">${d.img ? `${d.link ? `<a ${linkOf(d)}>` : ""}<img src="${src(d.img)}" alt="${esc(d.alt || "")}" loading="lazy">${d.link ? "</a>" : ""}` : ""}</div>`,
    imagen_texto: (d) => `<div class="container cms-it reveal${d.side === "derecha" ? " rev" : ""}"><div>${d.img ? `<img src="${src(d.img)}" alt="${esc(d.alt || "")}" loading="lazy">` : ""}</div><div>${d.title ? `<h2>${esc(d.title)}</h2>` : ""}${d.text ? `<p>${esc(d.text)}</p>` : ""}${d.button_text ? `<a class="btn btn-primary" ${linkOf({ link: d.button_link }) || 'href="#productos"'}>${esc(d.button_text)}</a>` : ""}</div></div>`,
    espaciador: (d) => `<div class="cms-spacer${d.line === "si" ? " line" : ""}" aria-hidden="true"></div>`,
    aviso: (d) => `<div class="cms-aviso">${d.link ? `<a ${linkOf(d)}>` : ""}${esc(d.text || "")}${d.link ? "</a>" : ""}</div>`,
  };
  // Estilo de cada sección (panel → Página web → Estilo). Todo validado: colores #rrggbb y números acotados.
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  const num = (v, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, Math.round(n))) : null; };
  const textOn = (c) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff"; };
  function applyStyle(el, d, type) {
    const st = d.style || {}, css = el.style;
    ["--sec-pt", "--sec-pb", "--sec-bg-l", "--sec-bg-d", "--sec-fg-l", "--sec-fg-d", "--sec-r", "--sp-h", "--sp-hm", "--sp-line"].forEach((k) => css.removeProperty(k));
    el.classList.remove("cms-styled", "has-pad", "has-bg", "cms-full", "cms-narrow", "cms-round", "al-left", "al-center", "al-right", "hide-mob", "hide-desk");
    const pt = num(st.pt, 0, 240), pb = num(st.pb, 0, 240);
    if (pt != null || pb != null) { el.classList.add("cms-styled", "has-pad"); css.setProperty("--sec-pt", `${pt ?? 0}px`); css.setProperty("--sec-pb", `${pb ?? 0}px`); }
    const bl = hex(st.bg), bd = hex(st.bg_dark) || bl;
    if (bl || bd) { el.classList.add("cms-styled", "has-bg"); css.setProperty("--sec-bg-l", bl || "transparent"); css.setProperty("--sec-bg-d", bd || "transparent");
      css.setProperty("--sec-fg-l", hex(st.fg) || (bl ? textOn(bl) : "inherit")); css.setProperty("--sec-fg-d", hex(st.fg_dark) || (bd ? textOn(bd) : "inherit")); }
    if (st.width === "completo") el.classList.add("cms-styled", "cms-full");
    if (st.width === "angosto") el.classList.add("cms-styled", "cms-narrow");
    const r = num(st.radius, 0, 60); if (r) { el.classList.add("cms-styled", "cms-round"); css.setProperty("--sec-r", `${r}px`); }
    if (["left", "center", "right"].includes(st.align)) el.classList.add("cms-styled", `al-${st.align}`);
    if (st.hide_mobile) el.classList.add("hide-mob");
    if (st.hide_desktop) el.classList.add("hide-desk");
    if (type === "espaciador") { css.setProperty("--sp-h", `${num(d.height, 0, 400) ?? 40}px`); css.setProperty("--sp-hm", `${num(d.height_mobile, 0, 400) ?? num(d.height, 0, 400) ?? 24}px`);
      if (hex(d.line_color)) css.setProperty("--sp-line", hex(d.line_color)); }
  }
  // Editor visual: tamaños de cada capa (sección / contenedor / tarjeta) y sombras por capas. Todo validado y acotado.
  // Capas: sección = el bloque entero; contenedor = su .container; tarjeta = la única caja dentro del contenedor (si la hay).
  function cmsLayers(el) {
    const cont = el.querySelector(":scope > .container") || el.querySelector(".container");
    const card = cont && cont.children.length === 1 ? cont.firstElementChild : null;
    return { sec: el, cont: cont || null, card };
  }
  const SHADOW_LAYERS = ["sec", "cont", "card"];
  function shadowCss(list, layer) {
    return (Array.isArray(list) ? list : []).slice(0, 8).filter((s) => s && s.on !== false && s.layer === layer).map((s) => {
      const c = hex(s.color) || "#000000", a = (num(s.a, 0, 100) ?? 40) / 100;
      const rgba = `rgba(${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)},${a})`;
      return `${s.inset ? "inset " : ""}${num(s.x, -200, 200) ?? 0}px ${num(s.y, -200, 200) ?? 0}px ${num(s.blur, 0, 300) ?? 0}px ${num(s.spread, -100, 150) ?? 0}px ${rgba}`;
    }).join(", ");
  }
  function applyBox(el, st) {
    (el.__cmsProps || []).forEach(([n, k]) => n.style.removeProperty(k));
    const set = []; el.__cmsProps = set;
    const put = (n, k, v) => { if (!n || v == null || v === "") return; n.style.setProperty(k, v, "important"); set.push([n, k]); };
    const L = cmsLayers(el);
    const px = (v, a, b) => { const n = num(v, a, b); return n == null ? null : `${n}px`; };
    put(L.sec, "min-height", st.sec_h ? px(st.sec_h, 0, 1600) : null);
    put(L.sec, "margin-top", st.sec_mt != null && st.sec_mt !== "" ? px(st.sec_mt, -300, 400) : null);
    put(L.sec, "margin-bottom", st.sec_mb != null && st.sec_mb !== "" ? px(st.sec_mb, -300, 400) : null);
    if (L.cont) put(L.cont, "max-width", st.cont_w ? px(st.cont_w, 200, 2400) : null);
    if (L.card) {
      const w = num(st.card_w, 10, 100); put(L.card, "width", w ? `${w}%` : null); if (w) put(L.card, "margin-inline", "auto");
      put(L.card, "min-height", st.card_h ? px(st.card_h, 0, 1600) : null);
      put(L.card, "padding-block", st.card_py != null && st.card_py !== "" ? px(st.card_py, 0, 300) : null);
      put(L.card, "padding-inline", st.card_px != null && st.card_px !== "" ? px(st.card_px, 0, 300) : null);
      put(L.card, "border-radius", st.card_r != null && st.card_r !== "" ? px(st.card_r, 0, 120) : null);
    }
    SHADOW_LAYERS.forEach((k) => { const sh = shadowCss(st.shadows, k); if (sh) put(L[k], "box-shadow", sh); });
    // "Sobresalir": la sección queda por encima de sus vecinas y no recorta sus sombras.
    if (st.over) { put(L.sec, "position", "relative"); put(L.sec, "z-index", "5"); put(L.sec, "overflow", "visible"); if (L.cont) put(L.cont, "overflow", "visible"); }
  }
  // Vista previa del editor visual (solo dentro del panel, en un iframe del mismo sitio): expone applySite para los cambios en vivo.
  if (window.parent !== window && /[?&]cms-edit=1/.test(location.search)) {
    try { if (window.parent.location.origin === location.origin) window.EXE_CMS = { applySite, cmsLayers }; } catch (e) { /* otro origen: nada */ }
  }
  function applySite(blocks) {
    const main = document.querySelector("main");
    document.querySelectorAll("[data-block-cms]").forEach((el) => el.remove());
    blocks.sort((a, b) => a.position - b.position).forEach((b) => {
      let el = document.querySelector(`[data-block="${CSS.escape(b.id)}"]`);
      if (!el && creators[b.type]) {
        el = document.createElement("section");
        el.className = b.type === "aviso" ? "cms-aviso-wrap" : "cms-block"; el.dataset.block = b.id; el.dataset.blockCms = "";
        el.innerHTML = creators[b.type](b.data || {});
      } else if (el && renderers[b.type]) { try { renderers[b.type](el, b.data || {}); } catch (e) { /* si un bloque falla, queda el contenido original */ } }
      if (!el) return;
      try { applyStyle(el, b.data || {}, b.type); applyBox(el, (b.data || {}).style || {}); } catch (e) { /* estilo inválido: se ignora */ }
      el.hidden = !b.active;
      main.appendChild(el);   // reordena según la posición
    });
    observeReveals();
    designZones();
  }
  /* ---------- Zonas tocables de las imágenes hechas en el editor (tabla designs) ----------
     Una imagen publicada desde el editor vive en .../disenos/...; si tiene enlaces, se dibujan encima como links
     transparentes (en % de la imagen, así sirven a cualquier tamaño). Solo se piden a la base si hay alguna. */
  const zoneCache = new Map();   // url → hotspots
  const zoneImgs = () => [...document.querySelectorAll("main img")].filter((i) => /\/disenos\/[^/]+\.webp/.test(i.getAttribute("src") || ""));
  async function designZones() {
    try {
      if (!cfg.supabaseUrl) return;
      const urls = [...new Set(zoneImgs().map((i) => i.getAttribute("src")))].filter((u) => !zoneCache.has(u)).slice(0, 30);
      if (urls.length) {
        const list = urls.map((u) => `"${u.replace(/["\\]/g, "")}"`).join(",");
        const r = await fetch(`${cfg.supabaseUrl}/rest/v1/designs?select=image_url,hotspots&image_url=in.(${encodeURIComponent(list)})`, { headers: { apikey: cfg.supabaseAnonKey } });
        const rows = r.ok ? await r.json() : [];
        urls.forEach((u) => zoneCache.set(u, []));
        rows.forEach((d) => zoneCache.set(d.image_url, Array.isArray(d.hotspots) ? d.hotspots : []));
      }
      paintZones();
    } catch (e) { /* sin zonas: la imagen sigue funcionando como antes */ }
  }
  const pct = (v) => `${Math.max(0, Math.min(100, Number(v) * 100 || 0)).toFixed(3)}%`;
  function zoneAttrs(k) {
    const v = String(k.v ?? "");
    switch (k.t) {
      case "product": return `href="#producto/${encodeURIComponent(v)}"`;
      case "products": return `href="#productos" data-dz-ids="${esc((Array.isArray(k.v) ? k.v : []).slice(0, 60).map(String).join(","))}"`;
      case "category": return `href="#productos" data-filter="${esc(v)}"`;
      case "brand": return `href="#productos" data-brand-tag="${esc(v)}"`;
      case "section": return v === "carrito" ? 'href="#" data-dz-cart="1"' : `href="#${v === "inicio" ? "" : esc(v.replace(/[^\w-]/g, ""))}"`;
      case "url": return /^https?:\/\/[^\s"<>]+$/i.test(v) ? `href="${esc(v)}"${k.tab ? ' target="_blank" rel="noopener"' : ""}` : "";
      case "whatsapp": return `href="${esc(waLink(v || "Hola EXE!"))}" target="_blank" rel="noopener"`;
      default: return "";
    }
  }
  function paintZones() {
    zoneImgs().forEach((img) => {
      const hs = zoneCache.get(img.getAttribute("src")) || [];
      const host = (img.closest("a") || img).parentElement;
      if (!host) return;
      let layer = host.querySelector(":scope > .dz-layer");
      if (!hs.length) { if (layer) layer.remove(); return; }
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      if (!layer) { layer = document.createElement("div"); layer.className = "dz-layer"; host.appendChild(layer); }
      layer.innerHTML = hs.slice(0, 40).map((h) => {
        const k = h.link || {}, attrs = zoneAttrs(k); if (!attrs) return "";
        const p = k.t === "product" ? products.find((x) => x.id === k.v) : null;
        if (k.t === "product" && k.hide && (!p || (tracksStock(p) && p.stock <= 0))) return "";
        const label = h.label || (p ? p.name : "Ver más");
        return `<a class="dz" ${attrs} style="left:${pct(h.x)};top:${pct(h.y)};width:${pct(h.w)};height:${pct(h.h)}" aria-label="${esc(label)}" title="${esc(label)}">${k.price && p ? `<span class="dz-price">${esc(priceLabel(p))}</span>` : ""}</a>`;
      }).join("");
      const place = () => Object.assign(layer.style, { left: img.offsetLeft + "px", top: img.offsetTop + "px", width: img.offsetWidth + "px", height: img.offsetHeight + "px" });
      place();
      if (!img.__dzObs && window.ResizeObserver) { img.__dzObs = new ResizeObserver(place); img.__dzObs.observe(img); }
    });
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-dz-cart]")) { e.preventDefault(); $("cartOpen").click(); } });
  /* ---------- Animaciones de entrada ---------- */
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); revealer.unobserve(en.target); } });
  }, { threshold: 0.12 });
  function observeReveals() {
    document.querySelectorAll(".reveal:not(.in)").forEach((el) => revealer.observe(el));
  }
  observeReveals();

  if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
    fetch(`${cfg.supabaseUrl}/rest/v1/site_blocks?select=id,type,position,active,data&page=eq.inicio&order=position`, { headers: { apikey: cfg.supabaseAnonKey } })
      .then((r) => (r.ok ? r.json() : Promise.reject())).then((rows) => { if (rows.length && !(window.EXE_CMS && window.EXE_CMS.draft)) applySite(rows); }).catch(() => {});
  }

  /* ---------- Contenido de config ---------- */
  const logos = cfg.brandLogos || [];
  // Carrusel de logos sin cortes en cualquier ancho (16:9, 21:9, 32:9…): cada mitad del track se repite hasta
  // cubrir la pantalla y la animación corre -50 %. Solo se recalcula si cambia la cantidad de copias necesarias.
  const logoBtn = (l, hidden) => `<button type="button" class="logo-btn" data-brand-tag="${esc(l.brand || l.name)}"${hidden ? ' tabindex="-1" aria-hidden="true"' : ""} title="Ver productos ${esc(l.brand || l.name)}" aria-label="Ver productos ${esc(l.brand || l.name)}"><img src="${esc(l.src)}" alt="${hidden ? "" : esc(l.name)}" width="150" height="134" decoding="async"></button>`;
  let logoCopies = 0;
  function buildLogos() {
    const track = $("logos"); if (!logos.length) return;
    const itemW = track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width : Math.min(240, Math.min(1400, innerWidth) / 5);
    const copies = Math.max(1, Math.ceil(innerWidth / (itemW * logos.length)));   // copias por mitad
    if (copies === logoCopies) return;
    logoCopies = copies;
    const half = Array.from({ length: copies }, (_, c) => logos.map((l) => logoBtn(l, c > 0)).join("")).join("");
    track.innerHTML = half + half.replace(/<button type="button" class="logo-btn"(?![^>]*aria-hidden)/g, '<button type="button" class="logo-btn" tabindex="-1" aria-hidden="true"');
    track.style.setProperty("--logos-dur", `${Math.round(25 * copies)}s`);   // misma velocidad sin importar las copias
  }
  buildLogos(); buildLogos();   // la 2.ª pasada mide el ancho real de cada logo
  let logosTimer; addEventListener("resize", () => { clearTimeout(logosTimer); logosTimer = setTimeout(buildLogos, 250); });
  const waHello = waLink("Hola EXE! Quería hacer una consulta.");
  $("waDirect").href = waHello; $("waFloat").href = waHello; $("waFooter").href = waHello;
  $("mailFooter").href = `mailto:${cfg.email}`; $("mailFooter").textContent = cfg.email;
  $("socials").innerHTML = Object.entries(cfg.socials || {})
    .filter(([, url]) => url)
    .map(([name, url]) => `<a class="btn btn-outline" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>`).join("");
  $("year").textContent = new Date().getFullYear();

  /* ---------- Datos ---------- */
  // Catálogo: primero Supabase (lo que se edita en el panel se ve al instante); si falla, la copia products.json.
  // ask_price / ask_stock: mostrar "Consultar"; cart_ok: sin precio/stock se puede igual agregar al carrito
  // (sin stock + cart_ok = "a pedido", sin límite); hide_no_stock: no se muestra si el stock llega a 0.
  const fromDb = (r) => ({
    id: r.id, name: r.name, brand: r.brand, category: r.category, description: r.description, price: r.ask_price ? 0 : Number(r.price) || 0,
    askStock: !!r.ask_stock, cartOk: r.cart_ok !== false, noStock: !r.ask_stock && r.show_stock && r.stock <= 0 && r.cart_ok !== false,
    ...(r.show_stock && !r.ask_stock && !(r.stock <= 0 && r.cart_ok !== false) ? { stock: r.stock } : {}), images: r.images && r.images.length ? r.images : (r.image ? [r.image] : []),
    specs: r.specs && r.specs.length ? r.specs : undefined, outlet: r.outlet, condition: r.condition, weightKg: Number(r.weight_kg) || 1,
    variants: r.variants && r.variants.length ? r.variants : undefined, tags: r.tags || [],
  });
  const loadDb = () => {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return Promise.reject();
    const cols = "id,name,brand,category,description,price,stock,show_stock,image,images,specs,outlet,condition,weight_kg,variants,tags,ask_price,ask_stock,cart_ok,hide_no_stock";
    return fetch(`${cfg.supabaseUrl}/rest/v1/products?select=${cols}&active=eq.true&order=sort.asc,name.asc`, { headers: { apikey: cfg.supabaseAnonKey } })
      .then((r) => (r.ok ? r.json() : Promise.reject())).then((rows) => (rows.length ? rows.filter((r) => !(r.hide_no_stock && r.show_stock && r.stock <= 0)).map(fromDb) : Promise.reject()));
  };
  const loadJson = () => fetch("data/products.json", { cache: "no-cache" }).then((r) => r.json())
    .then((data) => data.filter((p) => p.active !== false));   // "active": false = sin stock: no se muestra ni se puede pedir
  // Datos estructurados para Google (tienda + lista de productos con precio y disponibilidad).
  // "Consultar precio" no publica precio; la foto y el link apuntan a la ficha del producto.
  function structuredData() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const abs = (u) => (u && /^https?:/.test(u) ? u : base + (u || "").replace(/^\.?\//, ""));
    const items = products.slice(0, 100).map((p, i) => {
      const prod = { "@type": "Product", name: p.name, url: `${base}#producto/${encodeURIComponent(p.id)}`, sku: p.id,
        ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}), ...(p.category ? { category: p.category } : {}),
        ...(p.images && p.images[0] ? { image: abs(p.images[0]) } : {}), ...(p.description ? { description: String(p.description).slice(0, 500) } : {}) };
      if (p.price > 0) prod.offers = { "@type": "Offer", priceCurrency: "ARS", price: p.price,
        availability: typeof p.stock === "number" && p.stock <= 0 ? "https://schema.org/OutOfStock" : p.noStock ? "https://schema.org/BackOrder" : "https://schema.org/InStock",
        itemCondition: p.outlet ? "https://schema.org/UsedCondition" : "https://schema.org/NewCondition" };
      return { "@type": "ListItem", position: i + 1, item: prod };
    });
    const data = [{ "@context": "https://schema.org", "@type": "Store", name: "EXE", url: base, image: abs("assets/img/favicon.jpg"), telephone: "+54 9 11 3009 5254", email: "ventas@exe.com.ar", address: { "@type": "PostalAddress", addressCountry: "AR" } },
      { "@context": "https://schema.org", "@type": "ItemList", name: "Productos de EXE", itemListElement: items }];
    let s = document.getElementById("ldJson");
    if (!s) { s = document.createElement("script"); s.type = "application/ld+json"; s.id = "ldJson"; document.head.appendChild(s); }
    s.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
  }
  loadDb().catch(loadJson)
    .then((data) => { products = data; renderFilters(); renderBrandOptions(); renderProducts(); renderCart(); routeProduct(); routeBudget(); routeSearch(); paintZones(); try { structuredData(); } catch (e) { /* no afecta la tienda */ } })
    .catch(() => { $("productGrid").innerHTML = `<p class="empty-state">No se pudieron cargar los productos.</p>`; });
})();

/* Al achicar/agrandar la ventana (o si cambia el alto de algo de arriba), mantener quieto lo que el
   usuario estaba mirando: sin saltos ni efecto de "scroll" hacia otra sección. */
(() => {
  let anchor = null, top = 0, lock = 0, t;
  const pick = () => {
    if (Date.now() < lock) return;
    if (scrollY < 10) { anchor = null; return; }
    const hh = (document.querySelector(".site-header") || {}).offsetHeight || 70;
    const el = document.elementFromPoint(innerWidth / 2, hh + 20);
    if (el && el !== document.body && el !== document.documentElement) { anchor = el; top = el.getBoundingClientRect().top; }
  };
  const fix = () => {
    if (!anchor || !anchor.isConnected) return;
    const d = anchor.getBoundingClientRect().top - top;
    if (Math.abs(d) > 1) { lock = Date.now() + 300; scrollTo({ top: scrollY + d, behavior: "instant" }); }
  };
  addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(pick, 120); }, { passive: true });
  addEventListener("resize", () => { lock = Date.now() + 500; fix(); });
  if (window.ResizeObserver) new ResizeObserver(() => { if (Date.now() < lock) fix(); }).observe(document.body);
  pick();
})();
