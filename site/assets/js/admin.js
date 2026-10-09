// Panel de administración.
// La interfaz oculta lo que el usuario no puede usar, pero la seguridad real está en la base de datos
// (Row Level Security + funciones con chequeo de permisos): aunque alguien modifique este JS, no puede
// leer ni escribir datos para los que no tiene permiso.
(() => {
  const $ = (id) => document.getElementById(id);
  const be = window.EXE_BACKEND;
  const demo = new URLSearchParams(location.search).has("demo");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => "$" + Number(n || 0).toLocaleString("es-AR");

  const DEMO = {
    perms: new Set(["site.edit", "dashboard.access", "orders.read", "orders.update_status", "orders.create", "orders.mark_paid", "products.read", "products.write", "stock.write", "users.read", "users.moderate", "roles.manage", "emails.manage", "shipping.manage"]),
    orders: [
      { id: 1042, created_at: "2026-09-20", customer: "Juan Pérez", status: "paid", total: 452000, carrier: "andreani", tracking_number: "360000012345670", label_url: "#" },
      { id: 1043, created_at: "2026-09-22", customer: "Ana Gómez", status: "pending", total: 98000 },
      { id: 1044, created_at: "2026-09-23", customer: "Leo Díaz", status: "cancelled", total: 15000 },
    ],
    products: [
      { id: "gabinete-antec-nx200m-white", name: "Gabinete Antec NX200M White Vidrio Templado", price: 0, stock: 5, show_stock: true, active: true },
      { id: "cooler-deepcool-ag400-plus", name: "Cooler DeepCool AG400 PLUS", price: 0, stock: 0, show_stock: true, active: true },
    ],
    users: [{ id: "u1", email: "admin@exe.com.ar", full_name: "Administrador", phone: "1130095254", created_at: "2026-09-01", last_sign_in_at: "2026-10-01", verified: true, mfa: true, orders: 0, roles: ["administrador"], rank: 2, sessions: 2 },
      { id: "u2", email: "cliente@mail.com", full_name: "Juan Pérez", phone: "1155554444", created_at: "2026-09-20", last_sign_in_at: "2026-09-28", verified: true, mfa: false, orders: 2, last_order_at: "2026-09-22", roles: [], rank: 0, sessions: 1 },
      { id: "u3", email: "spam@mail.com", full_name: "Cuenta sospechosa", phone: "", created_at: "2026-10-05", last_sign_in_at: "2026-10-06", verified: false, mfa: false, orders: 0, roles: [], rank: 0, sessions: 0, banned_until: "2026-10-16T12:00:00Z" }],
    history: { u3: [{ action: "suspend", until: "2026-10-16T12:00:00Z", reason: "Pedidos falsos", by_email: "admin@exe.com.ar", created_at: "2026-10-09T15:00:00Z" }] },
    legacy: [{ email: "ana@mail.com", full_name: "Ana Gómez", phone: "1144443333", city: "CABA", last_order_at: "2024-05-10", claimed: false }],
    roles: [
      { name: "administrador", perms: ["*"] },
      { name: "moderador", perms: ["dashboard.access", "orders.read", "orders.update_status", "products.read", "stock.write"] },
      { name: "suscriptor", perms: [] },
    ],
    allPerms: ["dashboard.access", "orders.read", "orders.create", "orders.update_status", "orders.mark_paid", "products.read", "products.write", "stock.write", "users.read", "users.moderate", "users.assign_roles", "roles.manage", "emails.manage", "shipping.manage"],
  };

  let perms = new Set();

  async function boot() {
    if (demo) {
      perms = DEMO.perms;
      $("demoBanner").hidden = false;
      return open("Modo demo");
    }
    if (!be) {
      $("gateMsg").textContent = "El backend todavía no está configurado (Supabase). Podés ver cómo va a quedar el panel en modo demo.";
      $("demoLink").hidden = false;
      return;
    }
    const user = await be.user();
    if (!user) return ($("gateMsg").textContent = "Tenés que iniciar sesión para acceder al panel.");
    perms = await be.permissions().catch(() => new Set());
    if (!perms.has("dashboard.access")) {
      $("gateMsg").className = "notice error";
      return ($("gateMsg").textContent = "Tu usuario no tiene permiso para acceder al panel.");
    }
    // Verificación en dos pasos: obligatoria para el panel (sin ella la base no da ningún permiso)
    if (!(await mfaGate())) return;
    open(user.email);
  }

  async function mfaGate() {
    if (!window.EXE_MFA) return true;
    $("gateMsg").hidden = true;
    const ok = await window.EXE_MFA.staffGate($("gateMfa")).catch((e) => { $("gateMfa").innerHTML = `<p class="notice error">${esc(e.message)}</p>`; return false; });
    $("gateMfa").innerHTML = "";
    if (!ok) { $("gateMsg").hidden = false; $("gateMsg").textContent = "Para entrar al panel hace falta la verificación en dos pasos."; }
    return ok;
  }

  function open(who) {
    $("gate").hidden = true;
    $("app").hidden = false;
    $("me").textContent = who;
    document.querySelectorAll("[data-perm]").forEach((a) => a.setAttribute("aria-disabled", String(!perms.has(a.dataset.perm))));
    window.addEventListener("hashchange", route);
    route();
    watchVerification();
  }

  // Cada 5 minutos: si la sesión se cerró a distancia (o la suspendieron) vuelve al ingreso; si venció la
  // verificación (12 h) o cambió la conexión del dispositivo, la pide de nuevo sin perder la pantalla.
  let watching = false;
  function watchVerification() {
    if (demo || !window.EXE_MFA || watching) return;
    watching = true;
    let busy = false;
    setInterval(async () => {
      if (busy || document.hidden) return;
      const ss = await window.EXE_MFA.staffStatus().catch(() => null);
      if (!ss || ss.verified) return;
      busy = true;
      if (!ss.alive) { await be.sb.auth.signOut().catch(() => {}); location.reload(); return; }
      const d = document.createElement("dialog"); d.className = "confirm"; document.body.appendChild(d); d.showModal();
      const ok = await window.EXE_MFA.staffGate(d).catch(() => false);
      d.remove(); busy = false;
      if (!ok) location.reload(); else route();
    }, 5 * 60 * 1000);
  }

  const views = {
    async resumen() {
      const orders = await load("orders");
      const ok = (o) => !["pending", "cancelled"].includes(o.status);
      const day = (d) => String(d || "").slice(0, 10), today = new Date().toLocaleDateString("sv"), month = today.slice(0, 7);
      const sum = (list) => money(list.reduce((n, o) => n + Number(o.total || 0), 0));
      const sold = orders.filter(ok);
      // Stock y dólar dependen de otros permisos: si no se pueden leer, esa tarjeta no se muestra.
      const products = perms.has("products.read") ? await load("products").catch(() => []) : [];
      const low = products.filter((p) => p.active && p.stock <= 2).sort((a, b) => a.stock - b.stock).slice(0, 5);
      let fx = null;
      try { fx = demo ? 1550 : (await be.sb.from("fx_settings").select("effective_rate").eq("id", 1).single()).data?.effective_rate; } catch (e) { fx = null; }
      const last = orders.slice(0, 5);
      return `<div class="kpis">
        <a class="kpi kpi-link" href="#pedidos" title="Ver los pedidos"><small>Ventas de hoy</small><strong>${sum(sold.filter((o) => day(o.created_at) === today))}</strong><span class="kpi-go">Ver pedidos →</span></a>
        <a class="kpi kpi-link" href="#pedidos" title="Ver los pedidos"><small>Ventas del mes</small><strong>${sum(sold.filter((o) => day(o.created_at).startsWith(month)))}</strong><span class="kpi-go">Ver pedidos →</span></a>
        <a class="kpi kpi-link" href="#pedidos" title="Ver los pedidos pendientes"><small>Pedidos pendientes</small><strong>${orders.filter((o) => o.status === "pending").length}</strong><span class="kpi-go">Ver pedidos →</span></a>
        ${fx ? (perms.has("products.write") ? `<a class="kpi kpi-link" href="#dolar" title="Ir a la sección Dólar"><small>Dólar usado hoy</small><strong>${money(fx)}</strong><span class="kpi-go">Ver dólar →</span></a>` : `<div class="kpi"><small>Dólar usado hoy</small><strong>${money(fx)}</strong></div>`) : ""}
      </div>
      <div class="kpis kpis-wide">
        ${perms.has("products.read") ? `<div class="kpi"><small>⚠️ Stock bajo</small><div class="kpi-list">${low.length ? low.map((p) => `<a href="#editar/${encodeURIComponent(p.id)}">${esc(p.name)}</a> — ${p.stock > 0 ? `quedan ${p.stock}` : "sin stock"}`).join("<br>") : "Todo con stock"}</div></div>` : ""}
        <div class="kpi"><small>🧾 Últimos pedidos</small><div class="kpi-list">${last.length ? last.map((o) => `#${o.id} ${esc(o.customer || "")} — ${money(o.total)} <span class="pill ${esc(o.status)}">${esc(o.status)}</span>`).join("<br>") : "Todavía no hay pedidos"}</div></div>
      </div>`;
    },
    async pedidos() {
      const rows = await load("orders");
      return `<div class="panel"><table class="table"><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Envío</th></tr>
        ${rows.map((o) => `<tr><td>${o.id}</td><td>${esc(o.created_at).slice(0, 10)}</td><td>${esc(o.customer)}</td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td>${money(o.total)}</td><td>${shipCell(o)}</td></tr>`).join("")}
        </table></div><p class="notice info">"Pagado" lo marca solamente el sistema al recibir la confirmación de Mercado Pago (o un administrador con el permiso <b>orders.mark_paid</b>, quedando registrado quién y cuándo).</p>`;
    },
    async usuarios() {
      const [rows, legacy] = await Promise.all([load("users"), load("legacy").catch(() => [])]);
      lastUsers = rows;
      const canMod = perms.has("users.moderate"), myRank = perms.has("roles.manage") ? 2 : 1;
      const d = (x) => (x ? new Date(x).toLocaleDateString("es-AR") : "—");
      const wa = (ph) => { const n = String(ph || "").replace(/\D/g, ""); return n ? `<a href="https://wa.me/${n.startsWith("54") ? n : "549" + n.replace(/^0/, "")}" target="_blank" rel="noopener">${esc(ph)}</a>` : "—"; };
      return `<div class="usr-bar"><input class="pr-in" id="usrQ" type="search" placeholder="🔍 Buscar por nombre, email o teléfono" aria-label="Buscar usuarios">
          <span class="usr-count">${rows.length} registrado${rows.length === 1 ? "" : "s"} · ${legacy.length} cliente${legacy.length === 1 ? "" : "s"} anterior${legacy.length === 1 ? "" : "es"}</span></div>
        <div class="panel"><h3>Usuarios registrados</h3><div class="tbl-scroll"><table class="table usr-t">
        <tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Alta</th><th>Último ingreso</th><th>Email</th><th>2 pasos</th><th>Pedidos</th><th>Roles</th><th>Estado</th><th>Sesiones</th>${canMod ? "<th></th>" : ""}</tr>
        ${rows.map((u) => `<tr data-q="${esc(`${u.full_name || ""} ${u.email || ""} ${u.phone || ""}`.toLowerCase())}"><td>${esc(u.full_name || "—")}</td><td><a href="mailto:${esc(u.email)}">${esc(u.email)}</a></td><td>${wa(u.phone)}</td>
          <td>${d(u.created_at)}</td><td>${d(u.last_sign_in_at)}</td><td>${u.verified ? "✔ Confirmado" : "Sin confirmar"}</td><td>${u.mfa ? "🔐 Activa" : "—"}</td>
          <td>${u.orders || 0}${u.last_order_at ? ` <small>(último ${d(u.last_order_at)})</small>` : ""}</td><td>${(u.roles || []).map(esc).join(", ") || "cliente"}</td>
          <td>${userState(u)}</td><td>${u.sessions ?? "—"}</td>${canMod ? `<td>${(u.rank ?? 0) < myRank ? `<button type="button" class="btn btn-outline btn-mod" data-mod="${esc(u.id)}">Moderar</button>` : ""}</td>` : ""}</tr>`).join("") || '<tr><td colspan="12">Todavía no hay usuarios.</td></tr>'}
        </table></div></div>
        ${legacy.length ? `<div class="panel"><h3>Clientes anteriores (tienda WordPress)</h3><p class="ed-hint">No tienen cuenta todavía: se vinculan solos cuando crean una con el mismo email y lo confirman. No se les manda nada.</p>
        <div class="tbl-scroll"><table class="table usr-t"><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Ciudad</th><th>Última compra</th><th>Estado</th></tr>
        ${legacy.map((c) => `<tr data-q="${esc(`${c.full_name || ""} ${c.email || ""} ${c.phone || ""} ${c.city || ""}`.toLowerCase())}"><td>${esc(c.full_name || "—")}</td><td>${esc(c.email)}</td><td>${wa(c.phone)}</td><td>${esc(c.city || "—")}</td><td>${d(c.last_order_at)}</td><td>${c.claimed ? "✔ Ya tiene cuenta" : "Sin cuenta"}</td></tr>`).join("")}
        </table></div></div>` : ""}`;
    },
    async roles() {
      const rows = await load("roles");
      const all = demo ? DEMO.allPerms : (await be.sb.from("permissions").select("key")).data.map((p) => p.key);
      return rows.map((r) => `<div class="panel"><h3>${esc(r.name)}</h3><div class="perm-grid">
        ${all.map((p) => `<label><input type="checkbox" ${r.perms.includes("*") || r.perms.includes(p) ? "checked" : ""} disabled> ${esc(p)}</label>`).join("")}
        </div></div>`).join("") + `<p class="notice info">Crear roles personalizados = agregar una fila en <b>roles</b> y tildar sus permisos. Ver docs/ROLES-Y-PERMISOS.md.</p>`;
    },
    async emails() {
      return `<div class="panel"><table class="table"><tr><th>Evento</th><th>Email</th><th>Estado</th></tr>
        <tr><td>Registro</td><td>Bienvenida + confirmar email</td><td>Supabase Auth</td></tr>
        <tr><td>Pedido creado</td><td>Resumen del pedido</td><td>Edge Function send-email</td></tr>
        <tr><td>Pago confirmado</td><td>Comprobante</td><td>Edge Function send-email</td></tr>
        <tr><td>Pedido enviado</td><td>Seguimiento</td><td>Edge Function send-email</td></tr>
        </table></div>`;
    },
  };

  // Envíos (Envia.com): generar la guía (solo pedidos pagados) e imprimir la etiqueta. La función valida el permiso.
  function shipCell(o) {
    if (o.tracking_number) return `${esc(o.carrier || "")} ${esc(o.tracking_number)} ${o.label_url ? `<a href="${esc(o.label_url)}" target="_blank" rel="noopener">Etiqueta</a>` : ""}`;
    if (perms.has("shipping.manage") && ["paid", "preparing"].includes(o.status)) return `<button class="link-btn" data-ship="${o.id}">Crear envío</button>`;
    return "—";
  }
  async function createShipment(order_id) {
    if (demo) return alertView("Modo demo: acá se generaría la guía con Envia.com.");
    const { data: { session } } = await be.sb.auth.getSession();
    const r = await fetch(`${window.SITE_CONFIG.supabaseUrl}/functions/v1/envios`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: window.SITE_CONFIG.supabaseAnonKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: "create", order_id }),
    });
    const data = await r.json();
    if (!r.ok) return alertView(data.error || "Error");
    if (data.etiqueta) window.open(data.etiqueta, "_blank", "noopener");
    route();
  }
  const alertView = (msg) => $("view").insertAdjacentHTML("afterbegin", `<p class="notice info">${esc(msg)}</p>`);
  $("view").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ship]");
    if (b) createShipment(Number(b.dataset.ship));
  });

  /* ---------- Moderación de usuarios: suspender, banear, cerrar sesiones, historial ---------- */
  let lastUsers = [];
  const fmtDate = (d) => new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const userState = (u) => !u.banned_until ? '<span class="pill paid">Activo</span>'
    : new Date(u.banned_until).getFullYear() > 2100 ? '<span class="pill cancelled">Baneado</span>'
    : `<span class="pill pending">Suspendido hasta ${esc(fmtDate(u.banned_until))}</span>`;
  const UNITS = [["minutos", 1], ["horas", 60], ["días", 1440], ["semanas", 10080], ["meses", 43200], ["años", 525600]];
  const ACT = { suspend: "Suspensión", ban: "Baneo", logout: "Cierre de sesiones", lift: "Sanción levantada" };
  async function history(id) {
    if (demo) return DEMO.history[id] || [];
    const { data, error } = await be.sb.rpc("admin_user_history", { p_user: id });
    if (error) throw error; return data || [];
  }
  async function sanction(id, action, minutes, reason) {
    if (demo) {
      const u = DEMO.users.find((x) => x.id === id);
      u.banned_until = action === "ban" ? "2126-01-01T00:00:00Z" : action === "suspend" ? new Date(Date.now() + minutes * 60000).toISOString() : action === "lift" ? null : u.banned_until;
      if (action !== "lift") u.sessions = 0;
      (DEMO.history[id] ||= []).unshift({ action, until: u.banned_until, reason, by_email: "admin@exe.com.ar", created_at: new Date().toISOString() });
      return;
    }
    const run = () => be.sb.rpc("admin_sanction", { p_user: id, p_action: action, p_minutes: minutes, p_reason: reason || null });
    let { error } = await run();
    if (error && /REVERIFY/.test(error.message)) {
      // Acción crítica: confirmar identidad (código o QR) y reintentar una vez
      const d = document.createElement("dialog"); d.className = "confirm"; document.body.appendChild(d); d.showModal();
      const ok = await window.EXE_MFA.reverify(d).catch(() => false); d.remove();
      if (!ok) throw new Error("No se confirmó la identidad: la acción no se aplicó.");
      ({ error } = await run());
    }
    if (error) throw error;
  }
  async function moderate(id) {
    const u = lastUsers.find((x) => x.id === id); if (!u) return;
    const h = await history(id).catch(() => []);
    const d = document.createElement("dialog"); d.className = "confirm mod-dlg";
    d.innerHTML = `<form method="dialog"><h2>Moderar a ${esc(u.full_name || u.email)}</h2>
      <p class="mod-sub">${esc(u.email)} · ${userState(u)}</p>
      <fieldset class="mod-acts"><legend>Acción</legend>
        <label><input type="radio" name="act" value="suspend" checked> Suspender por un tiempo</label>
        <span class="mod-time"><input type="number" name="n" min="1" max="999" value="1" aria-label="Cantidad"><select name="unit" aria-label="Unidad">${UNITS.map(([n, m]) => `<option value="${m}" ${n === "días" ? "selected" : ""}>${n}</option>`).join("")}</select></span>
        <label><input type="radio" name="act" value="ban"> Banear (sin fecha de fin)</label>
        <label><input type="radio" name="act" value="logout"> Solo cerrar sus sesiones abiertas (${u.sessions ?? 0})</label>
        ${u.banned_until ? '<label><input type="radio" name="act" value="lift"> Levantar la sanción</label>' : ""}
      </fieldset>
      <label class="field">Motivo (queda en el historial)<textarea name="reason" rows="2" maxlength="500" placeholder="Ej: pedidos falsos, insultos, spam…"></textarea></label>
      <p class="mod-note">Suspender o banear también le cierra todas las sesiones al instante. No puede volver a entrar hasta que termine la sanción.</p>
      <p class="notice error mod-err" hidden></p>
      <div class="confirm-actions"><button class="btn btn-outline" value="cancel">Volver</button><button class="btn btn-danger" value="ok" data-apply>Aplicar</button></div>
      <details class="mod-hist"${h.length ? "" : " hidden"}><summary>Historial (${h.length})</summary><ul>${h.map((x) => `<li><b>${esc(ACT[x.action] || x.action)}</b>${x.until && x.action !== "lift" ? ` hasta ${esc(new Date(x.until).getFullYear() > 2100 ? "siempre" : fmtDate(x.until))}` : ""} · ${esc(fmtDate(x.created_at))} · por ${esc(x.by_email || "—")}${x.reason ? `<br><small>${esc(x.reason)}</small>` : ""}</li>`).join("")}</ul></details>
    </form>`;
    document.body.appendChild(d); d.showModal();
    const f = d.querySelector("form"), err = d.querySelector(".mod-err");
    f.querySelector("[data-apply]").onclick = async (e) => {
      e.preventDefault();
      const act = f.act.value, minutes = act === "suspend" ? Math.round(Number(f.n.value) * Number(f.unit.value)) : null;
      if (act === "suspend" && !(minutes >= 1 && minutes <= 5256000)) { err.hidden = false; err.textContent = "Elegí un tiempo entre 1 minuto y 10 años."; return; }
      e.target.disabled = true;
      try { await sanction(id, act, minutes, f.reason.value.trim()); d.close(); await route(); alertView(`${ACT[act]} aplicada a ${u.email}.`); }
      catch (x) { err.hidden = false; err.textContent = x.message.replace(/^REVERIFY:\s*/, ""); e.target.disabled = false; }
    };
    d.addEventListener("close", () => d.remove());
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-mod]"); if (b) moderate(b.dataset.mod); });

  async function load(kind) {
    if (demo) return DEMO[kind];
    const q = {
      orders: () => be.sb.from("orders").select("id, created_at, status, total, carrier, tracking_number, label_url, customer_name, packed_at, source, customer:profiles(full_name)").order("created_at", { ascending: false }),
      products: () => be.sb.from("products").select("id, name, price, stock, show_stock, active").order("name"),
      users: () => be.sb.rpc("admin_users_list"),
      legacy: () => be.sb.rpc("admin_legacy_customers"),
      roles: () => be.sb.rpc("admin_list_roles"),
    }[kind];
    const { data, error } = await q();
    if (error) throw error;
    return kind === "orders" ? data.map((o) => ({ ...o, customer: o.customer?.full_name || o.customer_name })) : data;
  }

  views.usuarios.after = () => { const q = document.getElementById("usrQ"); if (q) q.oninput = () => { const v = q.value.trim().toLowerCase(); document.querySelectorAll(".usr-t tr[data-q]").forEach((tr) => (tr.hidden = !!v && !tr.dataset.q.includes(v))); }; };
  // Vistas extra sin link en el menú (ej. #editar/<id>): { perm, parent, title }
  const subviews = {};
  async function route() {
    const [key, ...args] = (location.hash || "#resumen").slice(1).split("/");
    const sub = subviews[key];
    const link = document.querySelector(`.side-nav [href="#${sub ? sub.parent : key}"]`);
    const perm = sub ? sub.perm : link && link.dataset.perm;
    if (!views[key] || !link || !perms.has(perm)) return (location.hash = "#resumen");
    document.querySelectorAll(".side-nav a").forEach((a) => a.classList.toggle("active", a === link));
    $("viewTitle").textContent = sub ? sub.title(args) : link.textContent.replace(/^\S+\s/, "");
    try { $("view").innerHTML = await views[key](...args.map(decodeURIComponent)); if (views[key].after) views[key].after(...args.map(decodeURIComponent)); labelize(); }
    catch (e) { $("view").innerHTML = `<p class="notice error">${esc(e.message)}</p>`; }
  }
  // Accesibilidad: todo campo sin etiqueta visible recibe un nombre para lectores de pantalla
  // (placeholder, encabezado de la columna + producto en tablas, o el texto de la opción vacía de un select).
  function labelize() {
    const run = () => document.querySelectorAll("#view input:not([type=hidden]), #view select, #view textarea").forEach((el) => {
      if (el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return;
      let t = el.placeholder && el.placeholder !== "—" ? el.placeholder : "";
      const td = el.closest("td");
      if (td) { const th = td.closest("table")?.querySelectorAll("th")[td.cellIndex]; const row = td.closest("tr")?.querySelector(".pr-name, b"); t = [th?.textContent.trim(), row?.textContent.trim()].filter(Boolean).join(" — ") || t; }
      if (!t && el.tagName === "SELECT") t = el.options[0]?.textContent.trim() || "";
      if (!t && el.type === "color") t = "Elegir color";
      if (!t && el.type === "number") t = el.closest(".field, label")?.textContent.trim() || "Número";
      if (!t) t = el.closest(".fx-vol-row, .field")?.textContent.replace(/\s+/g, " ").trim().slice(0, 80) || el.name || "Campo";
      el.setAttribute("aria-label", t);
    });
    run(); if (!labelize.obs) { labelize.obs = new MutationObserver(run); labelize.obs.observe($("view"), { childList: true, subtree: true }); }
  }
  // API para los módulos del panel (admin-productos.js)
  window.EXE_ADMIN = { views, subviews, route, esc, money, $, shipCell, get perms() { return perms; }, demo, be, DEMO, alertView: (m) => alertView(m) };

  $("logout").onclick = async () => { if (be) await be.sb.auth.signOut(); location.href = "../index.html"; };
  // boot() arranca cuando cargaron los módulos (admin-productos.js llama a EXE_ADMIN.start())
  window.EXE_ADMIN.start = boot;
})();
