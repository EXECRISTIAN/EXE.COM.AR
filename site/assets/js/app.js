(() => {
  const cfg = window.SITE_CONFIG;
  const STORAGE_KEY = "exe-cart";
  const PLACEHOLDER = "assets/img/placeholder.svg";
  const $ = (id) => document.getElementById(id);
  const money = (n) =>
    new Intl.NumberFormat(cfg.locale, { style: "currency", currency: cfg.currency, maximumFractionDigits: 0 }).format(n);
  const mainImg = (p) => (p.images && p.images[0]) || p.image || PLACEHOLDER;
  const priceLabel = (p) => (p.price > 0 ? money(p.price) : "Consultar");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const waLink = (text) => `https://wa.me/${cfg.whatsappNumber}?text=${encodeURIComponent(text)}`;

  let products = [];
  let filter = "Todos";
  let query = "";
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

  function stockBadge(p) {
    if (!tracksStock(p)) return "";
    if (p.stock <= 0) return `<span class="stock out">Sin stock</span>`;
    if (!showsStock(p)) return `<span class="stock ok">En stock</span>`;
    const cls = p.stock <= cfg.lowStockThreshold ? "low" : "ok";
    return `<span class="stock ${cls}">${p.stock <= cfg.lowStockThreshold ? "¡Últimas " + p.stock + " unidades!" : p.stock + " disponibles"}</span>`;
  }

  /* ---------- Catálogo ---------- */
  function renderFilters() {
    const cats = ["Todos", ...new Set(products.map((p) => p.category).filter(Boolean))];
    $("filters").innerHTML = cats
      .map((c) => `<button class="chip${c === filter ? " active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join("");
  }

  function renderProducts() {
    const q = query.toLowerCase();
    const list = products.filter(
      (p) => (filter === "Todos" || p.category === filter) &&
        (!q || `${p.name} ${p.brand || ""} ${p.category || ""}`.toLowerCase().includes(q))
    );
    $("productGrid").innerHTML = list.length
      ? list.map((p, i) => {
          const out = tracksStock(p) && p.stock <= 0;
          return `
          <article class="card reveal" style="--d:${(i % 4) * 0.08}s">
            <div class="card-media">
              <img src="${esc(mainImg(p))}" alt="${esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
              ${p.images && p.images[1] ? `<img class="alt" src="${esc(p.images[1])}" alt="" loading="lazy">` : ""}
              ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ""}
            </div>
            <div class="card-body">
              ${p.brand ? `<span class="card-brand">${esc(p.brand)}</span>` : ""}
              <h3>${esc(p.name)}</h3>
              <div class="price">${priceLabel(p)}</div>
              ${stockBadge(p)}
              ${p.variants ? `<select data-variant="${esc(p.id)}" aria-label="Variante">${p.variants.map((v) => `<option>${esc(v)}</option>`).join("")}</select>` : ""}
              <button class="btn btn-primary" data-add="${esc(p.id)}" ${out ? "disabled" : ""}>${out ? "Sin stock" : "Agregar al carrito"}</button>
            </div>
          </article>`;
        }).join("")
      : `<p class="empty-state">No encontramos productos con ese criterio.</p>`;
    observeReveals();
  }

  /* ---------- Carrito ---------- */
  function add(id, variant) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (available(p) <= 0) return toast("No hay más stock disponible de este producto");
    const line = cart.find((l) => l.id === id && l.variant === variant);
    if (line) line.qty++;
    else cart.push({ id, variant, qty: 1 });
    save(); renderCart();
    const badge = $("cartCount");
    badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump");
    toast("Agregado al carrito");
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
            <small>${l.variant ? esc(l.variant) + " · " : ""}${priceLabel(l.product)}</small>
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

  // ---------- Envío (Andreani) ----------
  let shipping = null; // { method, cp, cost }
  const shipOn = cfg.andreani?.enabled && cfg.supabaseUrl && cfg.supabaseAnonKey;
  if (shipOn) $("ship").hidden = false;
  async function andreani(payload) {
    const r = await fetch(`${cfg.supabaseUrl}/functions/v1/andreani`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error al cotizar");
    return data;
  }
  function renderShip(q) {
    const opts = [["domicilio", "A domicilio"], ["sucursal", "Retiro en sucursal Andreani"]].filter(([k]) => q[k] != null);
    $("shipOpts").innerHTML = opts.length
      ? opts.map(([k, label]) => `<label><input type="radio" name="ship" value="${k}" data-cost="${q[k]}"> ${label} <b>${money(q[k])}</b></label>`).join("")
      : `<small>No hay tarifas para ese código postal. Te cotizamos por WhatsApp.</small>`;
  }
  if (shipOn) {
    $("shipQuote").onclick = async () => {
      const cp = $("shipCp").value.trim();
      if (!/^\d{4}$/.test(cp)) return toast("Ingresá un código postal de 4 dígitos");
      if (!cart.length) return toast("Agregá productos al carrito");
      $("shipQuote").disabled = true; shipping = null;
      $("shipOpts").innerHTML = "<small>Cotizando…</small>";
      try { renderShip(await andreani({ action: "quote", cp, items: cart.map((l) => ({ id: l.id, qty: l.qty })) })); }
      catch (e) { $("shipOpts").innerHTML = `<small>${esc(e.message)}</small>`; }
      finally { $("shipQuote").disabled = false; }
    };
    $("shipOpts").onchange = (e) => {
      shipping = { method: e.target.value, cp: $("shipCp").value.trim(), cost: Number(e.target.dataset.cost), sig: cartSig() };
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
      return `• ${l.qty} x ${l.product.name}${l.variant ? ` (${l.variant})` : ""} — ${sub}`;
    });
    return [
      `Hola EXE! ${name ? `Soy ${name}. ` : ""}Quiero hacer este pedido:`,
      "",
      ...rows,
      "",
      total ? `*Total estimado: ${money(total)}*${hasConsult ? " (+ productos a consultar)" : ""}` : "*Precio a consultar*",
      shipping ? `Envío Andreani ${shipping.method === "sucursal" ? "a sucursal" : "a domicilio"} (CP ${shipping.cp}): ${money(shipping.cost)} — cotización estimada` : "",
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
  $("cartOpen").onclick = () => toggleCart(true);
  $("cartClose").onclick = () => toggleCart(false);
  $("overlay").onclick = () => toggleCart(false);
  document.addEventListener("keydown", (e) => e.key === "Escape" && toggleCart(false));
  $("cartClear").onclick = () => { cart = []; shipping = null; if (shipOn) $("shipOpts").innerHTML = ""; save(); renderCart(); renderProducts(); };
  $("sendWa").onclick = () => window.open(waLink(buildMessage()), "_blank", "noopener");

  /* ---------- Header / menú ---------- */
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
  const slideCount = track.children.length;
  let current = 0;
  let timer;
  $("dots").innerHTML = [...track.children].map((_, i) => `<button aria-label="Imagen ${i + 1}"${i === 0 ? ' class="active"' : ""}></button>`).join("");
  const dots = [...$("dots").children];
  function go(i) {
    current = (i + slideCount) % slideCount;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, k) => d.classList.toggle("active", k === current));
  }
  const play = () => { clearInterval(timer); timer = setInterval(() => go(current + 1), 5000); };
  dots.forEach((d, i) => d.addEventListener("click", () => { go(i); play(); }));
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
  if (slideCount > 1) play();

  /* ---------- Animaciones de entrada ---------- */
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); revealer.unobserve(en.target); } });
  }, { threshold: 0.12 });
  function observeReveals() {
    document.querySelectorAll(".reveal:not(.in)").forEach((el) => revealer.observe(el));
  }
  observeReveals();

  /* ---------- Contenido de config ---------- */
  const logos = cfg.brandLogos || [];
  $("logos").innerHTML = [...logos, ...logos]
    .map((l) => `<img src="${esc(l.src)}" alt="${esc(l.name)}" title="${esc(l.name)}" loading="lazy">`).join("");
  const waHello = waLink("Hola EXE! Quería hacer una consulta.");
  $("waDirect").href = waHello; $("waFloat").href = waHello; $("waFooter").href = waHello;
  $("mailFooter").href = `mailto:${cfg.email}`; $("mailFooter").textContent = cfg.email;
  $("socials").innerHTML = Object.entries(cfg.socials || {})
    .filter(([, url]) => url)
    .map(([name, url]) => `<a class="btn btn-outline" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>`).join("");
  $("year").textContent = new Date().getFullYear();

  /* ---------- Datos ---------- */
  fetch("data/products.json")
    .then((r) => r.json())
    .then((data) => { products = data; renderFilters(); renderProducts(); renderCart(); })
    .catch(() => { $("productGrid").innerHTML = `<p class="empty-state">No se pudieron cargar los productos.</p>`; });
})();
