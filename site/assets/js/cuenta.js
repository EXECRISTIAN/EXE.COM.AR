(() => {
  const $ = (id) => document.getElementById(id);
  const be = window.EXE_BACKEND;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function show(msg, kind = "error") {
    const m = $("msg");
    m.textContent = msg; m.className = `notice ${kind}`; m.hidden = false;
  }

  document.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
      $("loginForm").hidden = b.dataset.tab !== "login";
      $("registerForm").hidden = b.dataset.tab !== "register";
      $("msg").hidden = true;
    })
  );

  if (!be) {
    $("offline").hidden = false;
    document.querySelectorAll("#guest form button").forEach((b) => (b.disabled = true));
    return;
  }
  const { sb } = be;

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
    if (error) return show("Email o contraseña incorrectos.");
    render();
  });

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.auth.signUp({
      email: f.get("email"),
      password: f.get("password"),
      options: { data: { full_name: f.get("full_name"), phone: f.get("phone") }, emailRedirectTo: location.href },
    });
    if (error) return show(error.message);
    show("¡Listo! Te enviamos un email para confirmar tu cuenta.", "ok");
  });

  $("forgot").addEventListener("click", async () => {
    const email = $("loginForm").email.value;
    if (!email) return show("Escribí tu email arriba y volvé a tocar el enlace.");
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href });
    show("Si el email existe, te llegará un enlace para restablecer la contraseña.", "ok");
  });

  $("logout").addEventListener("click", async () => { await sb.auth.signOut(); render(); });

  async function render() {
    const user = await be.user();
    $("guest").hidden = !!user;
    $("logged").hidden = !user;
    if (!user) return;
    $("who").textContent = user.user_metadata?.full_name || user.email;
    const perms = await be.permissions().catch(() => new Set());
    $("dashLink").hidden = !perms.has("dashboard.access");
    const { data: orders } = await sb.from("orders").select("id, created_at, status, total").order("created_at", { ascending: false });
    $("orders").innerHTML = orders?.length
      ? `<table class="table"><tr><th>Pedido</th><th>Fecha</th><th>Estado</th><th>Total</th></tr>${orders
          .map((o) => `<tr><td>#${esc(o.id)}</td><td>${new Date(o.created_at).toLocaleDateString("es-AR")}</td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td>$${Number(o.total).toLocaleString("es-AR")}</td></tr>`)
          .join("")}</table>`
      : `<p class="notice info">Todavía no tenés pedidos.</p>`;
  }
  render();
})();
