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
  // Contraseñas: ocultas por defecto (cambia el tipo). Emails: visibles por defecto; al ocultarlos se tapan con puntos
  // sin cambiar el tipo (así siguen validándose y autocompletándose como email).
  document.querySelectorAll('input[type="password"], input[type="email"]').forEach((inp) => {
    const isMail = inp.type === "email", what = isMail ? "email" : "contraseña";
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    inp.before(wrap); wrap.append(inp);
    const b = document.createElement("button");
    b.type = "button"; b.className = "pw-eye"; b.innerHTML = EYE;
    const shown = () => (isMail ? !inp.classList.contains("masked") : inp.type === "text");
    const sync = () => {
      const visible = shown();
      b.classList.toggle("on", visible);
      b.setAttribute("aria-label", visible ? `Ocultar ${what}` : `Mostrar ${what}`);
      b.setAttribute("aria-pressed", String(visible));
      b.title = b.getAttribute("aria-label");
    };
    b.addEventListener("click", () => {
      const pos = inp.selectionStart;
      if (isMail) inp.classList.toggle("masked");
      else inp.type = inp.type === "password" ? "text" : "password";
      sync(); inp.focus();
      try { inp.setSelectionRange(pos, pos); } catch (e) {}
    });
    // al enviar el formulario la contraseña se vuelve a ocultar (no queda visible en pantalla)
    if (!isMail && inp.form) inp.form.addEventListener("submit", () => { inp.type = "password"; sync(); });
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
    document.querySelectorAll("#guest form button:not(.pw-eye)").forEach((b) => (b.disabled = true));
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
  const approving = () => /^#aprobar\/[0-9a-f-]{36}$/i.test(location.hash);
  async function afterAuth() {
    if (approving()) return false;  // vino desde un QR: se queda para aprobar
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
    renderMfa();
    renderSessions();
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

  /* ---------- Verificación en dos pasos ---------- */
  const MFA = window.EXE_MFA;
  // Muestra una pantalla de la verificación (código o alta) en lugar del resto
  async function mfaScreen(run) {
    ["guest", "logged", "settings", "recovery"].forEach((id) => ($(id).hidden = true));
    $("mfaStep").hidden = false;
    try { return await run($("mfaBox")); } finally { $("mfaStep").hidden = true; $("mfaBox").innerHTML = ""; }
  }
  async function renderMfa() {
    const box = $("accMfa"); if (!box || !MFA) return;
    const st = await MFA.status().catch(() => null); if (!st) { box.innerHTML = ""; return; }
    const on = st.factors[0];
    box.innerHTML = `<div class="acc-mfa-card"><div><b>🔐 Verificación en dos pasos</b><small>${on ? `Activada desde el ${new Date(on.created_at).toLocaleDateString("es-AR")}. Al entrar se pide el código de tu app.` : "Desactivada. Sumá un código de tu celular además de la contraseña."}</small></div>
      <button type="button" class="btn ${on ? "btn-outline" : "btn-primary"}" id="mfaToggle">${on ? "Desactivar" : "Activar"}</button></div>`;
    $("mfaToggle").onclick = async () => {
      if (on) {
        if (!confirm("¿Desactivar la verificación en dos pasos? Tu cuenta queda protegida solo con la contraseña.")) return;
        try { await MFA.remove(on.id); accMsg("Verificación en dos pasos desactivada.", "ok"); } catch (e) { accMsg("No se pudo desactivar: " + e.message, "error"); }
        return renderMfa();
      }
      const ok = await mfaScreen((el) => MFA.enroll(el));
      history.replaceState("", "", location.pathname + location.search + "#configuracion");
      await showSettings();
      accMsg(ok ? "¡Listo! Verificación en dos pasos activada." : "", ok ? "ok" : "");
    };
  }
  if ($("mfaNeedBtn")) $("mfaNeedBtn").onclick = async () => { const ok = await mfaScreen((el) => MFA.enroll(el, { required: true })); render(); if (ok) show("¡Listo! Ya podés entrar al panel.", "ok"); };

  /* ---------- Aprobar un ingreso escaneando el QR de la computadora ---------- */
  async function approveScreen() {
    const token = location.hash.split("/")[1];
    const leave = () => { history.replaceState("", "", location.pathname + location.search); render(); };
    await mfaScreen(async (el) => {
      const st = MFA ? await MFA.status().catch(() => null) : null;
      if (!st || !st.factors.length) {
        el.innerHTML = `<div class="mfa"><h2>🔐 Aprobar ingreso</h2><p>Para aprobar ingresos desde este celular, primero activá la verificación en dos pasos en esta cuenta.</p><div class="mfa-row"><button type="button" class="ok" data-x>Entendido</button></div></div>`;
        return new Promise((ok) => (el.querySelector("[data-x]").onclick = ok));
      }
      const { data, error } = await sb.rpc("qr_view", { p_token: token });
      if (error) {
        el.innerHTML = `<div class="mfa"><h2>🔐 Aprobar ingreso</h2><p class="mfa-msg err">${esc(error.message)}</p><div class="mfa-row"><button type="button" class="ok" data-x>Volver</button></div></div>`;
        return new Promise((ok) => (el.querySelector("[data-x]").onclick = ok));
      }
      el.innerHTML = `<div class="mfa"><h2>🔐 ¿Estás entrando ahora?</h2>
        <p>Alguien quiere entrar al panel con <b>${esc(data.email)}</b> desde <b>${esc(data.device || "un dispositivo")}</b> (hora: ${new Date(data.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })})</p>
        <p><b>Si sos vos</b>, tocá el número que ves en la pantalla de la computadora:</p>
        <div class="mfa-choices">${data.choices.map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join("")}</div>
        <p class="mfa-msg" aria-live="polite"></p>
        <div class="mfa-row"><button type="button" data-no>No fui yo — rechazar</button></div>
        <small>Nunca apruebes un ingreso que no estés haciendo vos, aunque te lo pidan por mensaje o teléfono.</small></div>`;
      const msg = el.querySelector(".mfa-msg");
      return new Promise((ok) => {
        const decide = async (code, approve) => {
          el.querySelectorAll("button").forEach((b) => (b.disabled = true));
          const { data: r, error: e } = await sb.rpc("qr_decide", { p_token: token, p_code: code, p_approve: approve });
          msg.className = "mfa-msg" + (r === "approved" ? "" : " err");
          msg.textContent = e ? e.message : r === "approved" ? "✔ Ingreso aprobado. Ya podés seguir en la computadora." : r === "wrong_code" ? "Número incorrecto: el ingreso se bloqueó. Si eras vos, generá otro QR." : "Ingreso rechazado.";
          setTimeout(ok, 2500);
        };
        el.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => decide(Number(b.dataset.n), true)));
        el.querySelector("[data-no]").onclick = () => decide(null, false);
      });
    });
    leave();
  }

  /* ---------- Sesiones abiertas (cerrar a distancia) y cuentas que aprueban ingresos ---------- */
  const devName = (ua) => { const u = String(ua || "");
    const os = /Windows/.test(u) ? "Windows" : /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iPhone/iPad" : /Mac OS/.test(u) ? "Mac" : /Linux/.test(u) ? "Linux" : "Dispositivo";
    const br = /Edg\//.test(u) ? "Edge" : /OPR\//.test(u) ? "Opera" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
    return br ? `${os} · ${br}` : os; };
  const when = (d) => d ? new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  async function renderSessions() {
    const box = $("accSessions"); if (!box) return;
    const { data, error } = await sb.rpc("my_sessions");
    if (error) { box.innerHTML = ""; return; }
    const others = data.filter((x) => !x.current).length;
    box.innerHTML = `<div class="acc-sess"><b>💻 Sesiones abiertas</b><small>Dispositivos donde tu cuenta está iniciada. Si no reconocés alguno, cerralo. Cada sesión se cierra sola al mes.</small>
      <ul>${data.map((x) => `<li><span><b>${esc(devName(x.user_agent))}</b>${x.current ? ' <em class="acc-here">este dispositivo</em>' : ""}<small>Desde ${when(x.created_at)} · última actividad ${when(x.last_seen)}${x.ip ? ` · IP ${esc(x.ip)}` : ""}</small></span>
        ${x.current ? "" : `<button type="button" class="btn btn-outline" data-sclose="${esc(x.id)}">Cerrar</button>`}</li>`).join("")}</ul>
      ${others > 1 ? '<button type="button" class="btn btn-outline" id="sessAll">Cerrar todas las demás</button>' : ""}</div><div id="accLinks"></div>`;
    const done = (e, t) => { accMsg(e ? (/Verific/.test(e.message) ? "Por seguridad, primero ingresá el código de tu app (cerrá sesión y volvé a entrar)." : "No se pudo: " + e.message) : t, e ? "error" : "ok"); renderSessions(); };
    box.querySelectorAll("[data-sclose]").forEach((b) => (b.onclick = async () => { const { error: e } = await sb.rpc("revoke_my_session", { p_id: b.dataset.sclose }); done(e, "Sesión cerrada en ese dispositivo."); }));
    if ($("sessAll")) $("sessAll").onclick = async () => { const { error: e } = await sb.rpc("revoke_my_other_sessions"); done(e, "Cerramos tu cuenta en todos los demás dispositivos."); };
    renderLinks();
  }
  async function renderLinks() {
    const box = $("accLinks"); if (!box) return;
    const perms = await be.permissions().catch(() => new Set());
    const { data: links } = await sb.rpc("approver_list");
    if (!perms.has("dashboard.access") && !(links || []).length) { box.innerHTML = `<div class="acc-sess"><b>📱 Aprobar ingresos de otra cuenta</b><small>Si alguien del equipo te pasó un código de vínculo, escribilo acá.</small>
      <div class="acc-link-row"><input id="linkCode" maxlength="8" placeholder="Código" aria-label="Código de vínculo"><button type="button" class="btn btn-outline" id="linkOk">Vincular</button></div></div>`; wireLinkCode(); return; }
    box.innerHTML = `<div class="acc-sess"><b>📱 Aprobación con el celular</b><small>Para entrar al panel podés escanear un QR con tu celular en vez de escribir el código. Lo puede aprobar esta misma cuenta o las cuentas que vincules acá (con la verificación en dos pasos activada).</small>
      <ul>${(links || []).map((l) => `<li><span><b>${esc(l.email)}</b><small>${esc(l.role)} · desde ${when(l.created_at)}</small></span><button type="button" class="btn btn-outline" data-lrm="${esc(l.other)}">Quitar</button></li>`).join("") || "<li><small>Todavía no vinculaste otra cuenta.</small></li>"}</ul>
      <div class="acc-link-row">${perms.has("dashboard.access") ? '<button type="button" class="btn btn-outline" id="linkNew">Generar código para vincular</button>' : ""}<input id="linkCode" maxlength="8" placeholder="Código de otra cuenta" aria-label="Código de vínculo"><button type="button" class="btn btn-outline" id="linkOk">Vincular</button></div>
      <p class="acc-link-code" id="linkShow" hidden></p></div>`;
    box.querySelectorAll("[data-lrm]").forEach((b) => (b.onclick = async () => { const { error: e } = await sb.rpc("approver_remove", { p_other: b.dataset.lrm }); accMsg(e ? "No se pudo: " + e.message : "Vínculo quitado.", e ? "error" : "ok"); renderLinks(); }));
    if ($("linkNew")) $("linkNew").onclick = async () => {
      const { data: code, error: e } = await sb.rpc("approver_link_start");
      const p = $("linkShow"); p.hidden = false;
      p.innerHTML = e ? esc(e.message) : `Código: <b>${esc(code)}</b> — escribilo en la otra cuenta (Mi cuenta → Aprobación con el celular). Vence en 10 minutos.`;
    };
    wireLinkCode();
  }
  function wireLinkCode() {
    $("linkOk").onclick = async () => {
      const code = $("linkCode").value.trim(); if (!code) return;
      const { data: email, error: e } = await sb.rpc("approver_link_confirm", { p_code: code });
      accMsg(e ? (/dos pasos/.test(e.message) ? "Para vincular, esta cuenta necesita la verificación en dos pasos activada y verificada." : e.message) : `Listo: desde esta cuenta podés aprobar los ingresos de ${email}.`, e ? "error" : "ok");
      renderLinks();
    };
  }

  let mfaAsking = false;
  async function render() {
    let user = await be.user();
    // Si la cuenta tiene la verificación activada y esta sesión todavía no pasó el código, se pide antes de mostrar nada
    if (user && MFA && !mfaAsking) {
      const st = await MFA.status().catch(() => null);
      if (st && st.factors.length && st.cur !== "aal2") {
        mfaAsking = true;
        const ok = await mfaScreen((el) => MFA.challenge(el, st.factors[0], { cancelText: "Salir" }));
        mfaAsking = false;
        if (!ok) { await sb.auth.signOut(); user = null; }
      }
    }
    if (mfaAsking) return;
    if (user && approving()) return approveScreen();
    $("guest").hidden = !!user;
    $("logged").hidden = !user;
    await showSettings();
    if (!user) return;
    $("who").textContent = user.user_metadata?.full_name || user.email;
    $("dashLink").hidden = true; // oculto por defecto; solo se muestra si la base confirma el permiso
    const perms = await be.permissions().catch(() => new Set());
    $("dashLink").hidden = !perms.has("dashboard.access");
    // Administradores: la verificación en dos pasos es obligatoria (la base no da permisos sin ella)
    const mst = perms.has("dashboard.access") && MFA ? await MFA.status().catch(() => null) : null;
    $("mfaNeed").hidden = !(mst && !mst.factors.length);
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
