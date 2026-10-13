// Panel → Códigos de descuento (permiso promos.manage).
// · Códigos personales: reglas comunes para todos los clientes (cada uno ve su código en Mi cuenta). Se activan acá.
// · Códigos de embajador: los crea el administrador para una persona, con sus propias reglas.
// · Últimos usos: cada uso tiene un número de verificación que aparece en el mensaje de WhatsApp del pedido.
// Seguridad: la base (RLS) solo deja leer y editar con promos.manage; el descuento lo calcula siempre la base.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, money, $ } = A;
  const sb = () => A.be.sb;
  const num = (v) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const d = (x) => (x ? new Date(x).toLocaleDateString("es-AR") : "—");
  const what = (t, v) => (t === "percent" ? `${Number(v)}%` : money(v));
  let data = null, editing = null;

  function demo() {
    const D = A.DEMO;
    if (!D._promo) D._promo = {
      settings: { personal_enabled: true, personal_type: "percent", personal_value: 5, personal_min: 0, personal_max_uses: 10, personal_days: null },
      codes: [
        { code: "JUANEXE", kind: "embajador", owner: "u2", owner_email: "cliente@mail.com", discount_type: "percent", discount_value: 10, min_purchase: 100000, max_uses: 50, expires_at: "2026-12-31T23:59:00Z", active: true, uses: 7, note: "Streamer de hardware", created_at: "2026-10-01" },
        { code: "K7M2QX", kind: "personal", owner: "u3", owner_email: "ana@mail.com", min_purchase: 0, max_uses: null, active: true, uses: 2, created_at: "2026-10-05" },
      ],
      reds: [{ id: 12, code: "JUANEXE", user_email: "leo@mail.com", subtotal: 452000, discount: 45200, created_at: "2026-10-12T15:20:00Z" },
        { id: 11, code: "K7M2QX", user_email: "sofi@mail.com", subtotal: 98000, discount: 4900, created_at: "2026-10-11T11:02:00Z" }],
    };
    return D._promo;
  }

  async function load() {
    if (A.demo) return (data = demo());
    const [s, c, r] = await Promise.all([
      sb().from("promo_settings").select("*").eq("id", 1).maybeSingle(),
      sb().from("promo_codes").select("*, owner_p:profiles!promo_codes_owner_fkey(email, full_name)").order("created_at", { ascending: false }),
      sb().from("promo_redemptions").select("id, code, subtotal, discount, created_at, user:profiles!promo_redemptions_user_id_fkey(email, full_name)").order("created_at", { ascending: false }).limit(100),
    ]);
    for (const x of [s, c, r]) if (x.error) throw x.error;
    return (data = {
      settings: s.data || {},
      codes: (c.data || []).map((x) => ({ ...x, owner_email: x.owner_p?.email || "" })),
      reds: (r.data || []).map((x) => ({ ...x, user_email: x.user?.email || "" })),
    });
  }

  A.views.codigos = async function () {
    const { settings: s, codes, reds } = await load();
    const amb = codes.filter((c) => c.kind === "embajador"), pers = codes.filter((c) => c.kind === "personal");
    const sel = (name, v) => `<select name="${name}"><option value="percent" ${v === "percent" ? "selected" : ""}>Porcentaje (%)</option><option value="fixed" ${v === "fixed" ? "selected" : ""}>Monto fijo ($)</option></select>`;
    const e = editing;
    return `<p class="ed-hint" style="margin-top:0">Para usar un código hay que tener cuenta. El descuento lo calcula la web con los precios reales y, al enviar el pedido, el mensaje de WhatsApp trae el código, el descuento, el total y un <b>número de verificación</b> que podés buscar abajo en "Últimos usos". Nadie puede usar su propio código y cada persona usa un mismo código una sola vez.</p>

      <form class="panel cd-form" id="cdPersonal"><h3>🎁 Códigos personales (para todos los clientes)</h3>
        <label class="ed-check"><input type="checkbox" name="personal_enabled" ${s.personal_enabled ? "checked" : ""}> <b>Activados</b>: cada cliente ve su código en Mi cuenta para compartir con amigos</label>
        <div class="cd-grid">
          <label class="field">Tipo de descuento ${sel("personal_type", s.personal_type)}</label>
          <label class="field">Valor<input name="personal_value" inputmode="decimal" value="${esc(s.personal_value ?? 5)}"></label>
          <label class="field">Compra mínima ($)<input name="personal_min" inputmode="numeric" value="${esc(s.personal_min ?? 0)}"></label>
          <label class="field">Máximo de usos por código<input name="personal_max_uses" inputmode="numeric" placeholder="Sin límite" value="${esc(s.personal_max_uses ?? "")}"></label>
          <label class="field">Vence a los (días)<input name="personal_days" inputmode="numeric" placeholder="No vence" value="${esc(s.personal_days ?? "")}"></label>
        </div>
        <p class="ed-hint">Los cambios valen para todos los códigos personales, también los ya creados.</p>
        <button class="btn btn-primary">Guardar reglas</button> <span class="cd-msg" id="cdPersonalMsg"></span>
      </form>

      <div class="panel"><div class="cd-head"><h3>⭐ Códigos de embajador</h3><button type="button" class="btn btn-primary" id="cdNew">+ Nuevo código</button></div>
        <form class="cd-form cd-edit" id="cdForm" ${e ? "" : "hidden"}>
          <h4>${e && e.code ? `Editar ${esc(e.code)}` : "Nuevo código de embajador"}</h4>
          <div class="cd-grid">
            <label class="field">Código<input name="code" maxlength="20" required value="${esc(e?.code || "")}" ${e && e.code ? "readonly" : ""} placeholder="Ej: JUANEXE" style="text-transform:uppercase"></label>
            <label class="field">Email del embajador<input name="owner_email" type="email" required value="${esc(e?.owner_email || "")}" placeholder="Tiene que tener cuenta en EXE"></label>
            <label class="field">Tipo de descuento ${sel("discount_type", e?.discount_type || "percent")}</label>
            <label class="field">Valor<input name="discount_value" inputmode="decimal" required value="${esc(e?.discount_value ?? 10)}"></label>
            <label class="field">Compra mínima ($)<input name="min_purchase" inputmode="numeric" value="${esc(e?.min_purchase ?? 0)}"></label>
            <label class="field">Máximo de usos<input name="max_uses" inputmode="numeric" placeholder="Sin límite" value="${esc(e?.max_uses ?? "")}"></label>
            <label class="field">Vence el<input name="expires_at" type="date" value="${e?.expires_at ? esc(String(e.expires_at).slice(0, 10)) : ""}"></label>
            <label class="field">Nota (solo se ve acá)<input name="note" maxlength="200" value="${esc(e?.note || "")}"></label>
          </div>
          <label class="ed-check"><input type="checkbox" name="active" ${!e || e.active ? "checked" : ""}> Activo</label>
          <div class="cd-actions"><button class="btn btn-primary">Guardar código</button><button type="button" class="btn btn-outline" id="cdCancel">Cancelar</button> <span class="cd-msg" id="cdFormMsg"></span></div>
        </form>
        ${amb.length ? `<div class="tbl-scroll"><table class="table"><tr><th>Código</th><th>Embajador</th><th>Descuento</th><th>Mínimo</th><th>Usos</th><th>Vence</th><th>Estado</th><th></th></tr>
          ${amb.map((c) => `<tr><td><b>${esc(c.code)}</b>${c.note ? `<br><small>${esc(c.note)}</small>` : ""}</td><td>${esc(c.owner_email || "—")}</td><td>${what(c.discount_type, c.discount_value)}</td><td>${c.min_purchase > 0 ? money(c.min_purchase) : "—"}</td>
            <td>${c.uses}${c.max_uses ? ` / ${c.max_uses}` : ""}</td><td>${d(c.expires_at)}</td><td>${c.active ? '<span class="pill paid">Activo</span>' : '<span class="pill cancelled">Pausado</span>'}</td>
            <td><button type="button" class="link-btn" data-cd-edit="${esc(c.code)}">Editar</button> · <button type="button" class="link-btn" data-cd-toggle="${esc(c.code)}">${c.active ? "Pausar" : "Activar"}</button></td></tr>`).join("")}
          </table></div>` : `<p class="ed-hint">Todavía no hay códigos de embajador.</p>`}
      </div>

      <div class="panel"><h3>🎁 Códigos personales creados (${pers.length})</h3>
        ${pers.length ? `<div class="tbl-scroll"><table class="table"><tr><th>Código</th><th>Cliente</th><th>Usos</th><th>Creado</th><th>Estado</th><th></th></tr>
          ${pers.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.owner_email || "—")}</td><td>${c.uses}${s.personal_max_uses ? ` / ${s.personal_max_uses}` : ""}</td><td>${d(c.created_at)}</td>
            <td>${c.active ? "Activo" : "Pausado"}</td><td><button type="button" class="link-btn" data-cd-toggle="${esc(c.code)}">${c.active ? "Pausar" : "Activar"}</button></td></tr>`).join("")}</table></div>`
          : `<p class="ed-hint">Se crean solos la primera vez que cada cliente entra a Mi cuenta (con los códigos personales activados).</p>`}
      </div>

      <div class="panel"><h3>🧾 Últimos usos</h3>
        <input class="pr-in" id="cdFind" type="search" placeholder="🔍 Buscar por número de verificación, código o email" aria-label="Buscar usos">
        ${reds.length ? `<div class="tbl-scroll"><table class="table" id="cdReds"><tr><th>Verificación</th><th>Fecha</th><th>Código</th><th>Cliente</th><th>Subtotal</th><th>Descuento</th></tr>
          ${reds.map((r) => `<tr data-q="${esc(`#${r.id} ${r.id} ${r.code} ${r.user_email}`.toLowerCase())}"><td><b>#${r.id}</b></td><td>${new Date(r.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</td><td>${esc(r.code)}</td><td>${esc(r.user_email || "—")}</td><td>${money(r.subtotal)}</td><td>−${money(r.discount)}</td></tr>`).join("")}</table></div>`
          : `<p class="ed-hint">Todavía no se usó ningún código.</p>`}
      </div>`;
  };

  A.views.codigos.after = () => {
    const msg = (id, t, ok) => { const m = $(id); if (m) { m.textContent = t; m.className = `cd-msg ${ok ? "ok" : "err"}`; } };
    const intOrNull = (v) => (String(v).trim() === "" ? null : Math.max(1, Math.round(num(v))));

    $("cdPersonal").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, row = {
        personal_enabled: f.personal_enabled.checked, personal_type: f.personal_type.value, personal_value: num(f.personal_value.value),
        personal_min: Math.max(0, num(f.personal_min.value)), personal_max_uses: intOrNull(f.personal_max_uses.value), personal_days: intOrNull(f.personal_days.value),
      };
      if (!(row.personal_value > 0)) return msg("cdPersonalMsg", "Poné un valor mayor a 0.");
      if (row.personal_type === "percent" && row.personal_value > 90) return msg("cdPersonalMsg", "El porcentaje máximo es 90%.");
      if (A.demo) { Object.assign(data.settings, row); return msg("cdPersonalMsg", "✓ Guardado (demo)", true); }
      const { error } = await sb().from("promo_settings").update({ ...row, updated_at: new Date().toISOString(), updated_by: (await A.be.sb.auth.getUser()).data.user?.id }).eq("id", 1);
      msg("cdPersonalMsg", error ? "No se pudo guardar: " + error.message : "✓ Reglas guardadas", !error);
    };

    $("cdNew").onclick = () => { editing = {}; A.route(); };
    const cancel = $("cdCancel"); if (cancel) cancel.onclick = () => { editing = null; A.route(); };
    document.querySelectorAll("[data-cd-edit]").forEach((b) => (b.onclick = () => { editing = data.codes.find((c) => c.code === b.dataset.cdEdit); A.route(); }));
    document.querySelectorAll("[data-cd-toggle]").forEach((b) => (b.onclick = async () => {
      const c = data.codes.find((x) => x.code === b.dataset.cdToggle); if (!c) return;
      if (A.demo) c.active = !c.active;
      else { const { error } = await sb().from("promo_codes").update({ active: !c.active }).eq("code", c.code); if (error) return A.alertView(error.message); }
      A.route();
    }));

    const form = $("cdForm");
    if (form && !form.hidden) form.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const code = f.code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length < 4) return msg("cdFormMsg", "El código tiene que tener entre 4 y 20 letras o números.");
      const row = {
        code, kind: "embajador", discount_type: f.discount_type.value, discount_value: num(f.discount_value.value),
        min_purchase: Math.max(0, num(f.min_purchase.value)), max_uses: intOrNull(f.max_uses.value),
        expires_at: f.expires_at.value ? new Date(f.expires_at.value + "T23:59:59").toISOString() : null,
        note: f.note.value.trim().slice(0, 200) || null, active: f.active.checked,
      };
      if (!(row.discount_value > 0)) return msg("cdFormMsg", "Poné un valor de descuento mayor a 0.");
      if (row.discount_type === "percent" && row.discount_value > 90) return msg("cdFormMsg", "El porcentaje máximo es 90%.");
      const email = f.owner_email.value.trim().toLowerCase();
      if (A.demo) {
        const i = data.codes.findIndex((c) => c.code === code);
        const full = { uses: 0, created_at: new Date().toISOString(), ...(i >= 0 ? data.codes[i] : {}), ...row, owner_email: email };
        if (i >= 0) data.codes[i] = full; else data.codes.unshift(full);
        editing = null; return A.route();
      }
      const { data: p, error: pe } = await sb().from("profiles").select("id").ilike("email", email).maybeSingle();
      if (pe || !p) return msg("cdFormMsg", "No encontramos una cuenta con ese email. El embajador tiene que crear su cuenta primero.");
      const isNew = !(editing && editing.code);
      if (isNew && data.codes.some((c) => c.code === code)) return msg("cdFormMsg", "Ese código ya existe: elegí otro.");
      const q = isNew
        ? sb().from("promo_codes").insert({ ...row, owner: p.id, created_by: (await sb().auth.getUser()).data.user?.id })
        : sb().from("promo_codes").update({ ...row, owner: p.id }).eq("code", code);
      const { error } = await q;
      if (error) return msg("cdFormMsg", /duplicate|unique/i.test(error.message) ? "Ese código ya existe: elegí otro." : "No se pudo guardar: " + error.message);
      editing = null; A.route();
    };

    const find = $("cdFind");
    if (find) find.oninput = () => { const v = find.value.trim().toLowerCase().replace(/^#/, ""); document.querySelectorAll("#cdReds tr[data-q]").forEach((tr) => (tr.hidden = !!v && !tr.dataset.q.includes(v))); };
  };
})();
