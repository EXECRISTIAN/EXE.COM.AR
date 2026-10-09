// Verificación en dos pasos (código de 6 números de una app: Google Authenticator, Microsoft Authenticator, Authy…).
// Usa el MFA incluido en Supabase (gratis). La base exige el segundo paso para cualquier permiso de administración
// (has_perm pide sesión "aal2"), así que robar la sesión o la contraseña de un administrador no alcanza.
(() => {
  const be = window.EXE_BACKEND;
  if (!be) return;
  const sb = be.sb;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const css = document.createElement("style");
  css.textContent = `.mfa{display:grid;gap:12px;max-width:380px;margin:0 auto;text-align:left}
    .mfa h2{margin:0;font-size:1.25rem}.mfa p{margin:0;line-height:1.45}
    .mfa-qr{justify-self:center;background:#fff;padding:10px;border-radius:12px;line-height:0}.mfa-qr img{width:190px;height:190px}
    .mfa-secret{font:600 .85rem/1.4 ui-monospace,Consolas,monospace;word-break:break-all;padding:8px 10px;border-radius:8px;border:1px dashed currentColor;opacity:.85;user-select:all}
    .mfa-code{font:700 1.6rem/1 ui-monospace,Consolas,monospace;letter-spacing:.35em;text-align:center;padding:12px;border-radius:10px;border:2px solid #0084d6;width:100%;box-sizing:border-box;background:transparent;color:inherit}
    .mfa-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .mfa-row button{padding:10px 16px;border-radius:8px;border:1px solid #0084d6;background:transparent;color:inherit;font:inherit;cursor:pointer}
    .mfa-row .ok{background:#0084d6;color:#fff;font-weight:700}
    .mfa-msg{font-size:.9rem;min-height:1.2em}.mfa-msg.err{color:#ef4444}
    .mfa small{opacity:.75}
    .mfa-tabs{display:flex;gap:6px}.mfa-tabs button{flex:1;padding:9px;border-radius:8px;border:1px solid #0084d6;background:transparent;color:inherit;font:inherit;cursor:pointer}
    .mfa-tabs button[aria-selected=true]{background:#0084d6;color:#fff;font-weight:700}
    .mfa-qr svg{width:210px;height:210px;display:block}
    .mfa-num{font:800 2.4rem/1 ui-monospace,Consolas,monospace;text-align:center;letter-spacing:.1em}
    .mfa-choices{display:flex;gap:10px;justify-content:center}.mfa-choices button{width:76px;height:64px;border-radius:12px;border:2px solid #0084d6;background:transparent;color:inherit;font:800 1.6rem ui-monospace,Consolas,monospace;cursor:pointer}
    .mfa-choices button:hover{background:#0084d6;color:#fff}`;
  document.head.appendChild(css);

  async function status() {
    const [a, f] = await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors()]);
    const all = (f.data && f.data.all) || [];
    return { cur: a.data && a.data.currentLevel, next: a.data && a.data.nextLevel, factors: all.filter((x) => x.factor_type === "totp" && x.status === "verified"), pending: all.filter((x) => x.status !== "verified") };
  }

  const codeInput = '<input class="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" aria-label="Código de 6 números" required>';
  function wire(el, onCode, onCancel) {
    const f = el.querySelector("form"), inp = f.querySelector(".mfa-code"), msg = el.querySelector(".mfa-msg");
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 6); if (inp.value.length === 6) f.requestSubmit(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (inp.value.length !== 6) return;
      msg.className = "mfa-msg"; msg.textContent = "Verificando…"; inp.disabled = true;
      const err = await onCode(inp.value);
      inp.disabled = false;
      if (err) { msg.className = "mfa-msg err"; msg.textContent = err; inp.value = ""; inp.focus(); }
    });
    const c = el.querySelector("[data-mfa-cancel]"); if (c) c.onclick = onCancel;
    setTimeout(() => inp.focus(), 50);
  }
  const bad = (e) => (/invalid|expired/i.test(e.message || "") ? "Código incorrecto o vencido. Mirá la app y probá con el código nuevo." : "No se pudo verificar: " + e.message);

  // Pide el código a quien ya tiene la verificación activada. Devuelve true si quedó verificado.
  function challenge(el, factor, { cancelText = "Cancelar" } = {}) {
    return new Promise((done) => {
      el.innerHTML = `<div class="mfa"><h2>🔐 Verificación en dos pasos</h2><p>Abrí tu app de códigos (Google Authenticator u otra) y escribí el código de 6 números de <b>EXE</b>.</p>
        <form>${codeInput}<p class="mfa-msg" aria-live="polite"></p><div class="mfa-row"><button type="button" data-mfa-cancel>${esc(cancelText)}</button><button class="ok">Verificar</button></div></form>
        <small>¿Perdiste el celular? Escribinos por WhatsApp desde tu número registrado para desactivarla.</small></div>`;
      wire(el, async (code) => {
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
        if (error) return bad(error);
        done(true);
      }, () => done(false));
    });
  }

  // Alta: QR para escanear + clave para copiar a mano, y el primer código para confirmar
  async function enroll(el, { required = false, cancelText = "Ahora no" } = {}) {
    const st = await status();
    for (const p of st.pending) await sb.auth.mfa.unenroll({ factorId: p.id }).catch(() => {});   // restos de un intento anterior
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "EXE " + new Date().toISOString().slice(0, 10) });
    if (error) { el.innerHTML = `<p class="notice error">No se pudo iniciar la verificación en dos pasos: ${esc(error.message)}</p>`; return false; }
    return new Promise((done) => {
      el.innerHTML = `<div class="mfa"><h2>🔐 Activar verificación en dos pasos</h2>
        ${required ? "<p><b>Obligatoria para administradores.</b> Protege el panel aunque alguien te robe la contraseña o la sesión.</p>" : ""}
        <p>1. Instalá <b>Google Authenticator</b> (o Microsoft Authenticator / Authy) en tu celular.<br>2. Tocá “+” y escaneá este código:</p>
        <div class="mfa-qr"><img src="${esc(data.totp.qr_code)}" alt="Código QR para la app de verificación"></div>
        <p><small>¿No podés escanear? Cargá esta clave a mano:</small></p><div class="mfa-secret">${esc(data.totp.secret)}</div>
        <p>3. Escribí el código de 6 números que muestra la app:</p>
        <form>${codeInput}<p class="mfa-msg" aria-live="polite"></p><div class="mfa-row"><button type="button" data-mfa-cancel>${esc(cancelText)}</button><button class="ok">Activar</button></div></form></div>`;
      wire(el, async (code) => {
        const { error: e } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code });
        if (e) return bad(e);
        done(true);
      }, async () => { await sb.auth.mfa.unenroll({ factorId: data.id }).catch(() => {}); done(false); });
    });
  }

  // Antes de mostrar algo protegido: si tiene la verificación activa pide el código; si es obligatoria y no la tiene, la activa.
  async function gate(el, { required = false } = {}) {
    const st = await status();
    if (st.factors.length) return st.cur === "aal2" ? true : challenge(el, st.factors[0], { cancelText: "Salir" });
    if (required) return enroll(el, { required: true, cancelText: "Salir" });
    return true;
  }

  async function remove(factorId) {
    const { error } = await sb.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    await sb.auth.refreshSession().catch(() => {});
  }

  // ---------- Equipo (administradores y moderadores) ----------
  // La base exige una verificación vigente (código de la app o aprobación por QR desde el celular) que se renueva
  // cada 12 h, y para acciones críticas que tenga menos de 30 minutos. Además la sesión queda atada a este navegador.
  const staffStatus = async () => { const { data, error } = await sb.rpc("staff_status"); if (error) throw error; return data || {}; };
  const device = () => window.EXE_DEVICE;
  const deviceName = () => { const u = navigator.userAgent;
    const os = /Windows/.test(u) ? "Windows" : /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iPhone/iPad" : /Mac OS/.test(u) ? "Mac" : /Linux/.test(u) ? "Linux" : "Otro sistema";
    const br = /Edg\//.test(u) ? "Edge" : /OPR\//.test(u) ? "Opera" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Navegador";
    return `${os} · ${br}`; };
  const approveUrl = (token) => new URL(`${location.pathname.includes("/admin/") ? "../" : ""}cuenta.html#aprobar/${token}`, location.href).href;
  function qrSvg(text) {
    if (!window.qrcode) return "";
    const q = window.qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true, alt: "Código QR para aprobar el ingreso" });
  }

  // QR en la computadora: se aprueba desde un celular ya verificado (misma cuenta o vinculada)
  function qrApprove(el, { cancelText = "Cancelar" } = {}) {
    return new Promise((done) => {
      let poll = null, stop = false;
      const finish = (v) => { stop = true; clearInterval(poll); done(v); };
      async function start() {
        clearInterval(poll);
        el.querySelector(".mfa-body").innerHTML = "<p>Generando código…</p>";
        const { data, error } = await sb.rpc("qr_start", { p_device: deviceName() });
        const box = el.querySelector(".mfa-body");
        if (error || !data?.[0]) { box.innerHTML = `<p class="mfa-msg err">${esc(error?.message || "No se pudo generar el código")}</p>`; return; }
        const r = data[0];
        box.innerHTML = `<p>Escaneá este código con tu celular (con la sesión de EXE iniciada) y elegí el número:</p>
          <div class="mfa-qr">${qrSvg(approveUrl(r.token))}</div><div class="mfa-num" aria-label="Número de control">${esc(r.code)}</div>
          <p class="mfa-msg" aria-live="polite">Esperando la aprobación… <small data-left></small></p>`;
        const left = box.querySelector("[data-left]"), msg = box.querySelector(".mfa-msg"), end = new Date(r.expires_at).getTime();
        poll = setInterval(async () => {
          if (stop) return;
          const s = Math.max(0, Math.round((end - Date.now()) / 1000)); left.textContent = `(vence en ${s} s)`;
          const { data: st } = await sb.rpc("qr_status", { p_token: r.token });
          if (st === "approved") { clearInterval(poll); msg.textContent = "¡Aprobado! Entrando…"; if (device()) await device().bind().catch(() => {}); finish(true); }
          else if (st === "rejected" || st === "expired" || s === 0) {
            clearInterval(poll); msg.className = "mfa-msg err";
            msg.innerHTML = `${st === "rejected" ? "Rechazado o número incorrecto." : "El código venció."} <button type="button" class="link-btn" data-again>Generar otro</button>`;
            msg.querySelector("[data-again]").onclick = start;
          }
        }, 2000);
      }
      el.querySelector("[data-mfa-cancel]").onclick = () => finish(false);
      el._stop = () => finish(null);  // cambió de pestaña: deja de esperar sin cerrar la pantalla
      start();
    });
  }

  // Pide la verificación del equipo eligiendo código de la app o QR
  function staffVerify(el, factor, { title = "🔐 Verificá tu identidad", note = "", cancelText = "Salir" } = {}) {
    return new Promise((done) => {
      el.innerHTML = `<div class="mfa"><h2>${title}</h2>${note ? `<p>${note}</p>` : ""}
        <div class="mfa-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-t="code">Código de la app</button><button type="button" role="tab" aria-selected="false" data-t="qr">QR con el celular</button></div>
        <div class="mfa-pane"></div></div>`;
      const pane = el.querySelector(".mfa-pane");
      const show = async (t) => {
        if (pane._stop) { pane._stop(); pane._stop = null; }
        el.querySelectorAll("[data-t]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === t)));
        if (t === "code") {
          pane.innerHTML = `<p>Escribí el código de 6 números de tu app (Google Authenticator u otra):</p>
            <form>${codeInput}<p class="mfa-msg" aria-live="polite"></p><div class="mfa-row"><button type="button" data-mfa-cancel>${esc(cancelText)}</button><button class="ok">Verificar</button></div></form>`;
          wire(pane, async (code) => {
            const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
            if (error) return bad(error);
            if (device()) await device().bind().catch(() => {});
            done(true);
          }, () => done(false));
        } else {
          pane.innerHTML = `<div class="mfa-body"></div><div class="mfa-row"><button type="button" data-mfa-cancel>${esc(cancelText)}</button></div>`;
          const v = await qrApprove(pane, { cancelText }); if (v !== null) done(v);
        }
      };
      el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => show(b.dataset.t)));
      show("code");
    });
  }

  // Entrada al panel: activar la verificación si falta, y que la sesión tenga una verificación vigente
  async function staffGate(el) {
    const st = await status();
    if (!st.factors.length && !(await enroll(el, { required: true, cancelText: "Salir" }))) return false;
    let ss = await staffStatus();
    if (ss.verified) { if (device()) { await device().ensure().catch(() => {}); device().keepAlive(); } ss = await staffStatus(); }
    if (!ss.verified && ss.device_binding && ss.device_bound && device()) { await device().prove().catch(() => {}); ss = await staffStatus(); }
    if (!ss.verified) {
      const f = (await status()).factors[0];
      if (!(await staffVerify(el, f, { note: ss.device_bound || ss.alive ? `Por seguridad, la verificación se renueva cada ${ss.reverify_hours || 12} horas.` : "" }))) return false;
      ss = await staffStatus();
    }
    if (ss.verified && device()) device().keepAlive();
    return !!ss.verified;
  }

  // Acciones críticas (sancionar, cambiar roles): verificación de menos de 30 minutos
  async function reverify(el) {
    let ss = await staffStatus();
    if (ss.recent) return true;
    const f = (await status()).factors[0]; if (!f) return false;
    const ok = await staffVerify(el, f, { title: "🔐 Confirmá que sos vos", note: "Esta acción es delicada: confirmá tu identidad otra vez.", cancelText: "Cancelar" });
    ss = ok ? await staffStatus() : ss;
    return !!ss.recent;
  }

  window.EXE_MFA = { status, gate, enroll, challenge, remove, staffStatus, staffGate, reverify, deviceName };
})();
