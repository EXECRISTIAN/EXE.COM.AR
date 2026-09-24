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
    perms: new Set(["dashboard.access", "orders.read", "orders.update_status", "products.read", "products.write", "stock.write", "users.read", "roles.manage", "emails.manage"]),
    orders: [
      { id: 1042, created_at: "2026-09-20", customer: "Juan Pérez", status: "paid", total: 452000 },
      { id: 1043, created_at: "2026-09-22", customer: "Ana Gómez", status: "pending", total: 98000 },
      { id: 1044, created_at: "2026-09-23", customer: "Leo Díaz", status: "cancelled", total: 15000 },
    ],
    products: [
      { id: "gabinete-antec-nx200m-white", name: "Gabinete Antec NX200M White Vidrio Templado", price: 0, stock: 5, show_stock: true, active: true },
      { id: "cooler-deepcool-ag400-plus", name: "Cooler DeepCool AG400 PLUS", price: 0, stock: 0, show_stock: true, active: true },
    ],
    users: [{ email: "admin@exe.com.ar", full_name: "Administrador", roles: ["administrador"] }, { email: "cliente@mail.com", full_name: "Cliente", roles: ["suscriptor"] }],
    roles: [
      { name: "administrador", perms: ["*"] },
      { name: "moderador", perms: ["dashboard.access", "orders.read", "orders.update_status", "products.read", "stock.write"] },
      { name: "suscriptor", perms: [] },
    ],
    allPerms: ["dashboard.access", "orders.read", "orders.update_status", "orders.mark_paid", "products.read", "products.write", "stock.write", "users.read", "users.assign_roles", "roles.manage", "emails.manage"],
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
    open(user.email);
  }

  function open(who) {
    $("gate").hidden = true;
    $("app").hidden = false;
    $("me").textContent = who;
    document.querySelectorAll("[data-perm]").forEach((a) => a.setAttribute("aria-disabled", String(!perms.has(a.dataset.perm))));
    window.addEventListener("hashchange", route);
    route();
  }

  const views = {
    async resumen() {
      const orders = await load("orders");
      const paid = orders.filter((o) => o.status === "paid");
      return `<div class="kpis">
        <div class="kpi"><small>Pedidos</small><strong>${orders.length}</strong></div>
        <div class="kpi"><small>Pendientes de pago</small><strong>${orders.filter((o) => o.status === "pending").length}</strong></div>
        <div class="kpi"><small>Facturado (pagados)</small><strong>${money(paid.reduce((n, o) => n + o.total, 0))}</strong></div>
      </div>`;
    },
    async pedidos() {
      const rows = await load("orders");
      return `<div class="panel"><table class="table"><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Total</th></tr>
        ${rows.map((o) => `<tr><td>${o.id}</td><td>${esc(o.created_at).slice(0, 10)}</td><td>${esc(o.customer)}</td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td>${money(o.total)}</td></tr>`).join("")}
        </table></div><p class="notice info">"Pagado" lo marca solamente el sistema al recibir la confirmación de Mercado Pago (o un administrador con el permiso <b>orders.mark_paid</b>, quedando registrado quién y cuándo).</p>`;
    },
    async productos() {
      const rows = await load("products");
      return `<div class="panel"><table class="table"><tr><th>Producto</th><th>Precio</th><th>Stock</th><th>Mostrar stock</th><th>Activo</th></tr>
        ${rows.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.price ? money(p.price) : "Consultar"}</td><td>${p.stock}</td><td>${p.show_stock ? "Sí" : "No"}</td><td>${p.active ? "Sí" : "No"}</td></tr>`).join("")}
        </table></div>`;
    },
    async usuarios() {
      const rows = await load("users");
      return `<div class="panel"><table class="table"><tr><th>Usuario</th><th>Email</th><th>Roles</th></tr>
        ${rows.map((u) => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${u.roles.map(esc).join(", ")}</td></tr>`).join("")}
        </table></div>`;
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

  async function load(kind) {
    if (demo) return DEMO[kind];
    const q = {
      orders: () => be.sb.from("orders").select("id, created_at, status, total, customer:profiles(full_name)").order("created_at", { ascending: false }),
      products: () => be.sb.from("products").select("id, name, price, stock, show_stock, active").order("name"),
      users: () => be.sb.rpc("admin_list_users"),
      roles: () => be.sb.rpc("admin_list_roles"),
    }[kind];
    const { data, error } = await q();
    if (error) throw error;
    return kind === "orders" ? data.map((o) => ({ ...o, customer: o.customer?.full_name })) : data;
  }

  async function route() {
    const key = (location.hash || "#resumen").slice(1);
    const link = document.querySelector(`[href="#${key}"]`);
    if (!views[key] || !link || !perms.has(link.dataset.perm)) return (location.hash = "#resumen");
    document.querySelectorAll(".side-nav a").forEach((a) => a.classList.toggle("active", a === link));
    $("viewTitle").textContent = link.textContent.replace(/^\S+\s/, "");
    try { $("view").innerHTML = await views[key](); }
    catch (e) { $("view").innerHTML = `<p class="notice error">${esc(e.message)}</p>`; }
  }

  $("logout").onclick = async () => { if (be) await be.sb.auth.signOut(); location.href = "../index.html"; };
  boot();
})();
