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
    .mfa small{opacity:.75}`;
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

  window.EXE_MFA = { status, gate, enroll, challenge, remove };
})();
