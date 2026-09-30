(() => {
  const $ = (id) => document.getElementById(id);
  const be = window.EXE_BACKEND;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function show(msg, kind = "error") {
    const m = $("msg");
    m.textContent = msg; m.className = `notice ${kind}`; m.hidden = false;
  }

  // ---------- Ver / ocultar contraseña (ojo cerrado ⇄ ojo abierto, animado) ----------
  const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g class="eye-open"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle class="pupil" cx="12" cy="12" r="3"/></g>
    <g class="eye-closed"><path d="M2.5 11c2.2 3.2 5.6 5 9.5 5s7.3-1.8 9.5-5"/><path d="M5.4 14.2 4 16.3M9 15.7l-.6 2.5M15 15.7l.6 2.5M18.6 14.2l1.4 2.1"/></g></svg>`;
  document.querySelectorAll('input[type="password"]').forEach((inp) => {
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    inp.before(wrap); wrap.append(inp);
    const b = document.createElement("button");
    b.type = "button"; b.className = "pw-eye"; b.innerHTML = EYE;
    const sync = () => {
      const visible = inp.type === "text";
      b.classList.toggle("on", visible);
      b.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
      b.setAttribute("aria-pressed", String(visible));
      b.title = b.getAttribute("aria-label");
    };
    b.addEventListener("click", () => {
      const pos = inp.selectionStart;
      inp.type = inp.type === "password" ? "text" : "password";
      sync(); inp.focus();
      try { inp.setSelectionRange(pos, pos); } catch (e) {}
    });
    // al enviar el formulario se vuelve a ocultar (no queda visible en pantalla)
    inp.form && inp.form.addEventListener("submit", () => { inp.type = "password"; sync(); });
    sync(); wrap.append(b);
  });

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

  // Errores de Supabase Auth → mensajes claros en español (sin revelar si un email ya tiene cuenta)
  function authError(e, fallback) {
    const m = String(e?.message || e || "").toLowerCase();
    if (/rate limit|too many|security purposes|only request this after/.test(m)) return "Hiciste varios intentos seguidos. Esperá un minuto y probá de nuevo.";
    if (/captcha/.test(m)) return "No pudimos verificar que no sos un robot. Recargá la página y probá de nuevo.";
    if (/password.*(at least|should be|weak|short)|weak password|pwned|leaked/.test(m)) return "La contraseña es muy débil: usá al menos 8 caracteres, con letras y números.";
    if (/same.*password|different from the old/.test(m)) return "La contraseña nueva tiene que ser distinta de la anterior.";
    if (/invalid.*email|email.*invalid|unable to validate email/.test(m)) return "El email no es válido. Revisalo.";
    if (/network|failed to fetch|load failed/.test(m)) return "No hay conexión. Revisá tu internet y probá de nuevo.";
    return fallback;
  }

  // ---------- Antibots (Cloudflare Turnstile, en español) ----------
  // Supabase valida el token del lado del servidor cuando el captcha está activado en Attack Protection.
  const siteKey = window.SITE_CONFIG?.turnstileSiteKey;
  const widgets = {};
  // Si la verificación falla (o el script de Cloudflare no carga), aviso debajo para que recargue la página.
  function captchaNote(el, show) {
    let n = el.nextElementSibling;
    if (!n || !n.classList.contains("captcha-note")) {
      n = document.createElement("p");
      n.className = "captcha-note"; n.setAttribute("role", "alert"); n.hidden = true;
      n.innerHTML = 'No se pudo completar la verificación. <button type="button" class="link-btn">Recargá la página</button> y probá de nuevo.';
      n.querySelector("button").onclick = () => location.reload();
      el.after(n);
    }
    n.hidden = !show;
  }
  function mountCaptchas() {
    if (!siteKey || !window.turnstile) return;
    document.querySelectorAll("[data-captcha]").forEach((el) => {
      if (widgets[el.dataset.captcha] !== undefined) return;
      widgets[el.dataset.captcha] = window.turnstile.render(el, {
        sitekey: siteKey, language: "es", theme: "auto", size: "flexible",
        callback: () => captchaNote(el, false),
        "error-callback": () => { captchaNote(el, true); return true; },
        "timeout-callback": () => captchaNote(el, true),
        "unsupported-callback": () => captchaNote(el, true),
      });
    });
  }
  (function waitTurnstile(n = 0) {
    if (window.turnstile) mountCaptchas();
    else if (n < 50) setTimeout(() => waitTurnstile(n + 1), 200);
    else if (siteKey) document.querySelectorAll("[data-captcha]").forEach((el) => captchaNote(el, true));   // no cargó en 10 s
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
    if (error) return show(/confirm/i.test(error.message) ? "Tenés que confirmar tu email: revisá tu bandeja de entrada (y spam)." : authError(error, "Email o contraseña incorrectos."));
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
    if (error) return show(authError(error, "No pudimos crear la cuenta. Revisá los datos e intentá de nuevo."));
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
    if (error) { m.className = "notice error"; m.textContent = authError(error, "No se pudo guardar. Probá con otra contraseña (mínimo 8 caracteres)."); return; }
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
  const accForm = $("accForm");
  const accMsg = (t, k) => { const m = $("accMsg"); m.hidden = !t; m.className = `notice ${k}`; m.textContent = t || ""; };
  // "Ir a mi cuenta" abre cuenta.html#configuracion (igual para clientes y administradores)
  async function showSettings() {
    const on = location.hash === "#configuracion";
    const user = await be.user();
    $("settings").hidden = !(on && user);
    if (user) $("logged").hidden = on;
    if (!on || !user) return;
    const { data: prof } = await sb.from("profiles").select("full_name, phone, email, created_at, email_verified_at, marketing_opt_in").eq("id", user.id).maybeSingle();
    const { count } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    accForm.full_name.value = prof?.full_name || user.user_metadata?.full_name || "";
    accForm.phone.value = prof?.phone || ""; accForm.marketing_opt_in.checked = !!prof?.marketing_opt_in; accForm.email.value = user.email;
    $("accInitials").textContent = initials(accForm.full_name.value || user.email);
    $("accSince").textContent = `Cliente desde ${new Date(prof?.created_at || user.created_at).toLocaleDateString("es-AR", { month: "long", year: "numeric" })}`;
    $("accOrders").textContent = count || 0;
    $("accVerified").textContent = prof?.email_verified_at || user.email_confirmed_at ? "✔ Verificado" : "Sin verificar";
    accMsg("");
    scrollTo(0, 0);
  }
  addEventListener("hashchange", showSettings);
  $("accBack").onclick = (e) => { e.preventDefault(); history.pushState("", "", location.pathname + location.search); showSettings(); };
  accForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = await be.user(); if (!user) return;
    const full_name = accForm.full_name.value.trim().slice(0, 80), phone = accForm.phone.value.trim().slice(0, 30);
    const { error } = await sb.from("profiles").update({ full_name, phone, marketing_opt_in: accForm.marketing_opt_in.checked }).eq("id", user.id);
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
    await showSettings();
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
