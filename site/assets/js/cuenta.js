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

  // ---------- A dónde va cada usuario después de entrar ----------
  // Clientes: a la página de inicio (o a ?next=… si algo los mandó a loguearse, ej. terminar una compra).
  // Administradores/moderadores: se quedan en "Mi cuenta" con el acceso al panel.
  // Solo pasa justo después de un evento (ingresar, confirmar email, nueva contraseña), no al abrir "Mi cuenta" a propósito.
  const nextUrl = (() => {
    const n = new URLSearchParams(location.search).get("next");
    return n && /^[\w\-./?=&#%]+$/.test(n) && !n.startsWith("//") && !/^[a-z]+:/i.test(n) ? n : "index.html";
  })();
  async function afterAuth() {
    const perms = await be.permissions().catch(() => new Set());
    if (!perms.has("dashboard.access")) { location.replace(nextUrl); return true; }
    return false;
  }
  // Volvió desde el link de confirmación de email.
  const cameFromEmail = /type=(signup|magiclink|invite|email_change)/.test(location.hash);

  // ---------- Antibots (Cloudflare Turnstile, en español) ----------
  // Supabase valida el token del lado del servidor cuando el captcha está activado en Attack Protection.
  const siteKey = window.SITE_CONFIG?.turnstileSiteKey;
  const widgets = {};
  function mountCaptchas() {
    if (!siteKey || !window.turnstile) return;
    document.querySelectorAll("[data-captcha]").forEach((el) => {
      if (widgets[el.dataset.captcha] !== undefined) return;
      widgets[el.dataset.captcha] = window.turnstile.render(el, { sitekey: siteKey, language: "es", theme: "auto", size: "flexible" });
    });
  }
  (function waitTurnstile(n = 0) {
    if (window.turnstile) mountCaptchas(); else if (n < 50) setTimeout(() => waitTurnstile(n + 1), 200);
  })();
  const captcha = (name) => {
    if (!siteKey || !window.turnstile) return {}; // si el captcha no cargó, decide el servidor
    const t = window.turnstile && widgets[name] !== undefined ? window.turnstile.getResponse(widgets[name]) : "";
    return t ? { captchaToken: t } : null;
  };
  const resetCaptcha = (name) => { if (window.turnstile && widgets[name] !== undefined) window.turnstile.reset(widgets[name]); };
  const needCaptcha = () => show("Completá la verificación \"No soy un robot\" y volvé a intentar.");

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const c = captcha("login"); if (!c) return needCaptcha();
    const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password"), options: c });
    resetCaptcha("login");
    if (error) return show(/confirm/i.test(error.message) ? "Tenés que confirmar tu email: revisá tu bandeja de entrada (y spam)." : "Email o contraseña incorrectos.");
    if (await afterAuth()) return;
    render();
  });

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const c = captcha("register"); if (!c) return needCaptcha();
    const { error } = await sb.auth.signUp({
      email: f.get("email"),
      password: f.get("password"),
      options: { data: { full_name: f.get("full_name"), phone: f.get("phone") }, emailRedirectTo: location.href, ...c },
    });
    resetCaptcha("register");
    if (error) return show("No pudimos crear la cuenta. Revisá los datos e intentá de nuevo.");
    show("¡Listo! Te enviamos un email para confirmar tu cuenta.", "ok");
  });

  $("forgot").addEventListener("click", async () => {
    const email = $("loginForm").email.value;
    if (!email) return show("Escribí tu email arriba y volvé a tocar el enlace.");
    const c = captcha("login"); if (!c) return needCaptcha();
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0], ...c });
    resetCaptcha("login");
    show("Si el email existe, te llegará un enlace para restablecer la contraseña.", "ok");
  });

  // Al volver desde el email de recuperación Supabase abre una sesión especial: pedimos la contraseña nueva.
  sb.auth.onAuthStateChange((event) => {
    if (event !== "PASSWORD_RECOVERY") return;
    $("guest").hidden = true; $("logged").hidden = true; $("recovery").hidden = false;
  });
  $("recoveryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get("password") });
    const m = $("recoveryMsg"); m.hidden = false;
    if (error) { m.className = "notice error"; m.textContent = "No se pudo guardar. Probá con otra contraseña (mínimo 8 caracteres)."; return; }
    m.className = "notice ok"; m.textContent = "¡Listo! Contraseña guardada.";
    setTimeout(async () => { $("recovery").hidden = true; if (!(await afterAuth())) render(); }, 1200);
  });

  // Pide confirmación antes de cerrar sesión
  const logoutDialog = $("logoutDialog");
  // El diálogo modal bloquea el resto de la página: el selector de tema se mueve adentro mientras está abierto
  const themeMini = $("themeMini");
  $("logout").addEventListener("click", () => {
    logoutDialog.returnValue = "";
    if (themeMini) logoutDialog.appendChild(themeMini);
    logoutDialog.showModal();
  });
  logoutDialog.addEventListener("click", (e) => { if (e.target === logoutDialog) logoutDialog.close("cancel"); });   // clic afuera = cancelar
  logoutDialog.addEventListener("close", async () => {
    if (themeMini) document.body.appendChild(themeMini);
    if (logoutDialog.returnValue === "ok") { await sb.auth.signOut(); render(); }
  });

  /* ---------- Botón "Ir a mi cuenta" y ventana de datos ---------- */
  const initials = (name) => (String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const myBtn = $("myAccBtn");
  const accDialog = $("accDialog"), accForm = $("accForm");
  const accMsg = (t, k) => { const m = $("accMsg"); m.hidden = !t; m.className = `notice ${k}`; m.textContent = t || ""; };
  myBtn.addEventListener("click", async () => {
    const user = await be.user(); if (!user) return;
    const { data: prof } = await sb.from("profiles").select("full_name, phone, email, created_at, email_verified_at").eq("id", user.id).maybeSingle();
    const { count } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    accForm.full_name.value = prof?.full_name || user.user_metadata?.full_name || "";
    accForm.phone.value = prof?.phone || ""; accForm.email.value = user.email;
    $("accInitials").textContent = initials(accForm.full_name.value || user.email);
    $("accSince").textContent = `Cliente desde ${new Date(prof?.created_at || user.created_at).toLocaleDateString("es-AR", { month: "long", year: "numeric" })}`;
    $("accOrders").textContent = count || 0;
    $("accVerified").textContent = prof?.email_verified_at || user.email_confirmed_at ? "✔ Verificado" : "Sin verificar";
    accMsg("");
    accDialog.showModal();
  });
  $("accClose").onclick = () => accDialog.close();
  accDialog.addEventListener("click", (e) => { if (e.target === accDialog) accDialog.close(); });
  accForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = await be.user(); if (!user) return;
    const full_name = accForm.full_name.value.trim().slice(0, 80), phone = accForm.phone.value.trim().slice(0, 30);
    const { error } = await sb.from("profiles").update({ full_name, phone }).eq("id", user.id);
    if (error) return accMsg("No se pudo guardar. Probá de nuevo.", "error");
    await sb.auth.updateUser({ data: { full_name } }).catch(() => {});
    accMsg("¡Datos guardados!", "ok");
    $("who").textContent = full_name || user.email; $("accInitials").textContent = initials(full_name || user.email);
  });
  $("accReset").onclick = async () => {
    const user = await be.user(); if (!user) return;
    const { error } = await sb.auth.resetPasswordForEmail(user.email, { redirectTo: location.origin + location.pathname });
    accMsg(error ? "No se pudo enviar el email. Esperá unos minutos y probá de nuevo." : `Te mandamos un email a ${user.email} para elegir una contraseña nueva.`, error ? "error" : "ok");
  };

  async function render() {
    const user = await be.user();
    $("guest").hidden = !!user;
    $("logged").hidden = !user;
    if (!user) return;
    $("who").textContent = user.user_metadata?.full_name || user.email;
    $("dashLink").hidden = true; // oculto por defecto; solo se muestra si la base confirma el permiso
    const perms = await be.permissions().catch(() => new Set());
    $("dashLink").hidden = !perms.has("dashboard.access");
    const { data: orders } = await sb.from("orders").select("id, created_at, status, total, carrier, tracking_number").order("created_at", { ascending: false });
    $("orders").innerHTML = orders?.length
      ? `<table class="table"><tr><th>Pedido</th><th>Fecha</th><th>Estado</th><th>Total</th><th>Envío</th></tr>${orders
          .map((o) => `<tr><td>#${esc(o.id)}</td><td>${new Date(o.created_at).toLocaleDateString("es-AR")}</td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td>$${Number(o.total).toLocaleString("es-AR")}</td><td>${o.tracking_number ? `${esc(o.carrier || "")} <a href="https://envia.com/es-AR/rastreo?label=${encodeURIComponent(o.tracking_number)}" target="_blank" rel="noopener">Seguir ${esc(o.tracking_number)}</a>` : "—"}</td></tr>`)
          .join("")}</table>`
      : `<p class="notice info">Todavía no tenés pedidos.</p>`;
  }
  (async () => {
    if (cameFromEmail && (await be.user()) && (await afterAuth())) return;
    render();
  })();
})();
