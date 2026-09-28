// Panel → Emails automáticos: crear, editar, eliminar y ver las plantillas como las ve el cliente.
// Datos en la tabla email_templates (RLS: solo quien tiene emails.manage). El HTML final lo arma
// emails.mjs (la misma función que usa el envío real), así la vista previa es idéntica al email.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, $ } = A;
  const sb = () => A.be.sb;
  const can = () => A.perms.has("emails.manage");
  let lib = null;
  const loadLib = async () => (lib ||= await import("./emails.mjs"));

  const EVENTS = {
    order_created: "Al crear un pedido", order_paid: "Al confirmar el pago", order_shipped: "Al despachar el pedido",
    order_delivered: "Al entregar el pedido", order_cancelled: "Al cancelar el pedido", admin_new_order: "Aviso interno (a ventas@)",
    manual: "Manual (no se envía solo)",
  };
  const COLS = "id,name,event,subject,preheader,title,body,button_label,button_url,show_items,why,active,system,updated_at";

  let demoRows = null;
  async function list() {
    if (A.demo) {
      demoRows ||= [
        { id: "order_created", name: "Pedido recibido", event: "order_created", subject: "Recibimos tu pedido #{{pedido}}", preheader: "Pedido #{{pedido}} por {{total}}.", title: "¡Gracias por tu pedido!", body: "Hola {{nombre}},\n\nRecibimos tu pedido #{{pedido}} y ya lo estamos revisando. Este es el resumen:\n\n{{resumen}}\n\n¿Qué sigue?\n1. Confirmamos stock y precio final.\n2. Te enviamos cómo pagar.\n3. Preparamos y despachamos tu pedido.", button_label: "Ver mi pedido", button_url: "{{link_cuenta}}", show_items: true, why: "Recibís este email porque hiciste un pedido en EXE.", active: true, system: true },
        { id: "order_shipped", name: "Pedido enviado", event: "order_shipped", subject: "Tu pedido #{{pedido}} está en camino", preheader: "Seguimiento: {{seguimiento}}", title: "¡Tu pedido está en camino!", body: "Hola {{nombre}},\n\nDespachamos tu pedido #{{pedido}} con {{transportista}}.\n\nNúmero de seguimiento: {{seguimiento}}", button_label: "Seguir mi envío", button_url: "{{link_seguimiento}}", show_items: false, why: "Recibís este email porque hiciste un pedido en EXE.", active: true, system: true },
      ];
      return demoRows;
    }
    const r = await sb().from("email_templates").select(COLS).order("system", { ascending: false }).order("name");
    if (r.error) throw r.error;
    A._emailIds = r.data.map((x) => x.id);
    return r.data;
  }

  /* ---------- Listado ---------- */
  A.views.emails = async function () {
    const rows = await list();
    return `
      <div class="pr-toolbar"><a class="btn btn-primary" href="#email/nueva">＋ Nueva plantilla</a></div>
      <div class="panel"><table class="table">
        <tr><th>Plantilla</th><th>Cuándo se envía</th><th>Asunto</th><th>Activa</th><th></th></tr>
        ${rows.map((t) => `<tr data-id="${esc(t.id)}" class="${t.active ? "" : "is-off"}">
          <td><a href="#email/${encodeURIComponent(t.id)}"><b>${esc(t.name)}</b></a>${t.system ? ` <small class="pr-meta">del sistema</small>` : ""}</td>
          <td>${esc(EVENTS[t.event] || t.event)}</td><td>${esc(t.subject)}</td>
          <td><label class="switch"><input type="checkbox" data-act ${t.active ? "checked" : ""}><span></span></label></td>
          <td class="pr-actions"><a href="#email/${encodeURIComponent(t.id)}" title="Editar y ver">✏️ Editar</a>
            <button class="link-btn" data-prev title="Ver como el cliente">👁 Ver</button>
            <button class="link-btn" data-dup title="Duplicar">⧉</button>
            ${t.system ? "" : `<button class="link-btn danger" data-del title="Eliminar">🗑</button>`}</td></tr>`).join("")}
      </table></div>
      <p class="notice info">Las plantillas <b>del sistema</b> se envían solas en cada paso del pedido; se pueden editar o desactivar, pero no eliminar.
      Las que creás vos pueden reemplazar a una del sistema (elegí el mismo "Cuándo se envía" y dejala activa) o quedar como <b>Manual</b>.
      Los emails de la cuenta (confirmar registro, recuperar contraseña) los envía Supabase y se configuran allá.</p>
      <dialog class="confirm em-prev-dlg" id="emPrevDlg"><div class="em-prev-head"><b id="emPrevSubj"></b><button class="link-btn" id="emPrevClose">✕ Cerrar</button></div>
        <div class="em-devices"><button type="button" class="fx-rbtn on" data-dev="desk">🖥 Computadora</button><button type="button" class="fx-rbtn" data-dev="mob">📱 Celular</button></div>
        <iframe id="emPrevFrame" class="em-frame" sandbox="" title="Vista previa del email"></iframe></dialog>`;
  };
  A.views.emails.after = () => {
    $("view").addEventListener("click", async (e) => {
      const tr = e.target.closest("tr[data-id]"); if (!tr) return;
      const t = (await list()).find((x) => x.id === tr.dataset.id); if (!t) return;
      if (e.target.closest("[data-prev]")) return preview(t);
      if (e.target.closest("[data-dup]")) return save({ ...t, id: newId(t.id), name: `${t.name} (copia)`, event: "manual", active: false, system: false }, true).then(() => A.route()).catch(fail);
      if (e.target.closest("[data-del]")) {
        if (!(await confirmDel(t.name))) return;
        if (A.demo) demoRows = demoRows.filter((x) => x.id !== t.id);
        else { const r = await sb().from("email_templates").delete().eq("id", t.id); if (r.error) return fail(r.error); }
        A.route();
      }
    });
    $("view").addEventListener("change", async (e) => {
      if (!e.target.matches("[data-act]")) return;
      const id = e.target.closest("tr").dataset.id;
      try { await save({ ...(await list()).find((x) => x.id === id), active: e.target.checked }); e.target.closest("tr").classList.toggle("is-off", !e.target.checked); } catch (err) { fail(err); }
    });
    bindPreview();
  };

  /* ---------- Vista previa (iframe aislado: no ejecuta nada) ---------- */
  async function preview(t) {
    const { renderTemplate } = await loadLib();
    const r = renderTemplate(t);
    $("emPrevSubj").textContent = "Asunto: " + r.subject;
    $("emPrevFrame").srcdoc = r.html;
    $("emPrevDlg").showModal();
  }
  function bindPreview() {
    const d = $("emPrevDlg"); if (!d) return;
    $("emPrevClose").onclick = () => d.close();
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); const b = e.target.closest("[data-dev]"); if (b) setDev(b); });
  }
  function setDev(b) {
    b.parentElement.querySelectorAll("[data-dev]").forEach((x) => x.classList.toggle("on", x === b));
    b.closest("dialog, .em-live").querySelector(".em-frame").classList.toggle("mob", b.dataset.dev === "mob");
  }

  /* ---------- Editor ---------- */
  A.subviews.email = { perm: "emails.manage", parent: "emails", title: (a) => (a[0] === "nueva" ? "Nueva plantilla de email" : "Editar plantilla de email") };
  let cur = null;
  A.views.email = async function (id) {
    const { TEMPLATE_VARS } = await loadLib();
    const isNew = id === "nueva";
    const t = isNew
      ? { id: "", name: "", event: "manual", subject: "", preheader: "", title: "", body: "Hola {{nombre}},\n\n", button_label: "", button_url: "", show_items: false, why: "Recibís este email porque hiciste un pedido en EXE.", active: true, system: false }
      : (await list()).find((x) => x.id === id);
    if (!t) return `<p class="notice error">No existe esa plantilla.</p><a class="btn btn-outline" href="#emails">← Volver</a>`;
    cur = { ...t, isNew };
    const ro = can() ? "" : "disabled";
    return `
      <form id="emForm" class="em-grid">
        <div class="panel ed-sec">
          <div class="ed-grid">
            <label class="field">Nombre (para vos)<input name="name" value="${esc(t.name)}" required maxlength="80" ${ro}></label>
            <label class="field">Cuándo se envía<select name="event" ${t.system ? "disabled" : ro}>${Object.entries(EVENTS).map(([v, n]) => `<option value="${v}" ${v === t.event ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          </div>
          <label class="field">Asunto<input name="subject" value="${esc(t.subject)}" required maxlength="150" ${ro}></label>
          <label class="field">Texto de vista previa en la bandeja (opcional)<input name="preheader" value="${esc(t.preheader || "")}" maxlength="150" ${ro}></label>
          <label class="field">Título grande<input name="title" value="${esc(t.title)}" required maxlength="120" ${ro}></label>
          <label class="field">Mensaje<textarea name="body" rows="12" ${ro}>${esc(t.body)}</textarea></label>
          <p class="ed-hint">Línea en blanco = párrafo nuevo · "1. …" en líneas seguidas = lista · <b>{{resumen}}</b> en una línea sola = tabla del pedido.</p>
          <div class="em-vars">${Object.entries(TEMPLATE_VARS).map(([k, d]) => `<button type="button" class="p-tag" data-var="${k}" title="${esc(d)}">{{${k}}}</button>`).join("")}</div>
          <div class="ed-grid">
            <label class="field">Botón: texto (opcional)<input name="button_label" value="${esc(t.button_label || "")}" maxlength="40" ${ro}></label>
            <label class="field">Botón: link<input name="button_url" value="${esc(t.button_url || "")}" placeholder="{{link_cuenta}} o https://…" ${ro}></label>
          </div>
          <label class="field ed-check"><input type="checkbox" name="show_items" ${t.show_items ? "checked" : ""} ${ro}> Agregar el resumen del pedido al final (si no pusiste {{resumen}})</label>
          <label class="field">Texto chico al pie (por qué recibe el email)<input name="why" value="${esc(t.why || "")}" maxlength="200" ${ro}></label>
          <label class="field ed-check"><input type="checkbox" name="active" ${t.active ? "checked" : ""} ${ro}> Activa</label>
          <p class="notice" id="emMsg" hidden></p>
          <div class="ed-bar"><a class="btn btn-outline" href="#emails">← Volver</a><span class="ed-spacer"></span>
            ${!t.system && !isNew ? `<button class="btn btn-outline danger" type="button" id="emDel">Eliminar</button>` : ""}
            <button class="btn btn-primary" type="submit" ${ro}>Guardar</button></div>
        </div>
        <div class="panel em-live">
          <div class="em-prev-head"><b>Así lo ve el cliente</b><small>(con datos de ejemplo)</small></div>
          <div class="em-subj" id="emSubj"></div>
          <div class="em-devices"><button type="button" class="fx-rbtn on" data-dev="desk">🖥 Computadora</button><button type="button" class="fx-rbtn" data-dev="mob">📱 Celular</button></div>
          <iframe id="emFrame" class="em-frame" sandbox="" title="Vista previa del email"></iframe>
        </div>
      </form>`;
  };
  A.views.email.after = () => {
    const f = $("emForm"); if (!f) return;
    const read = () => ({ ...cur, name: f.name.value.trim(), event: cur.system ? cur.event : f.event.value, subject: f.subject.value.trim(), preheader: f.preheader.value.trim() || null,
      title: f.title.value.trim(), body: f.body.value, button_label: f.button_label.value.trim() || null, button_url: f.button_url.value.trim() || null,
      show_items: f.show_items.checked, why: f.why.value.trim() || null, active: f.active.checked });
    let tmr;
    const draw = async () => { const { renderTemplate } = await loadLib(); const r = renderTemplate(read()); $("emSubj").textContent = "Asunto: " + r.subject; $("emFrame").srcdoc = r.html; };
    f.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(draw, 250); });
    f.addEventListener("change", draw);
    f.addEventListener("click", (e) => {
      const v = e.target.closest("[data-var]"); const d = e.target.closest("[data-dev]");
      if (d) return setDev(d);
      if (!v || !can()) return;
      const ta = f.body, s = ta.selectionStart, txt = `{{${v.dataset.var}}}`;
      ta.value = ta.value.slice(0, s) + txt + ta.value.slice(ta.selectionEnd); ta.focus(); ta.selectionStart = ta.selectionEnd = s + txt.length; draw();
    });
    const del = $("emDel");
    if (del) del.onclick = async () => {
      if (!(await confirmDel(cur.name))) return;
      if (A.demo) demoRows = demoRows.filter((x) => x.id !== cur.id);
      else { const r = await sb().from("email_templates").delete().eq("id", cur.id); if (r.error) return msg(r.error.message, "error"); }
      location.hash = "#emails";
    };
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const t = read();
      if (!t.name || !t.subject || !t.title || !t.body.trim()) return msg("Completá nombre, asunto, título y mensaje.", "error");
      if (t.button_label && !t.button_url) return msg("El botón necesita un link.", "error");
      if (t.button_url && !/^(https?:\/\/|\{\{\s*link_[a-z]+\s*\}\})/.test(t.button_url)) return msg("El link del botón tiene que empezar con https:// o ser una variable como {{link_cuenta}}.", "error");
      if (cur.isNew) t.id = newId(t.name);
      try { await save(t, cur.isNew); msg("Guardado ✔", "ok"); if (cur.isNew) location.hash = `#email/${encodeURIComponent(t.id)}`; else cur = { ...t, isNew: false }; }
      catch (err) { msg("No se pudo guardar: " + err.message, "error"); }
    });
    draw();
  };

  /* ---------- Utilidades ---------- */
  function newId(base) {
    let id = String(base || "plantilla").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "plantilla";
    const taken = new Set((demoRows || []).map((x) => x.id).concat(A._emailIds || []));
    let out = id, k = 2; while (taken.has(out)) out = `${id}_${k++}`;
    return out;
  }
  async function save(t, insert) {
    const row = { id: t.id, name: t.name, event: t.event, subject: t.subject, preheader: t.preheader, title: t.title, body: t.body,
      button_label: t.button_label, button_url: t.button_url, show_items: t.show_items, why: t.why, active: t.active };
    if (A.demo) { const i = demoRows.findIndex((x) => x.id === t.id); if (i >= 0) demoRows[i] = { ...demoRows[i], ...row }; else demoRows.push({ ...row, system: false }); return; }
    const r = insert ? await sb().from("email_templates").insert(row) : await sb().from("email_templates").update(row).eq("id", t.id);
    if (r.error) throw r.error;
  }
  const msg = (t, k) => { const m = $("emMsg"); if (!m) return; m.hidden = false; m.className = `notice ${k}`; m.textContent = t; };
  const fail = (err) => A.alertView("No se pudo: " + (err.message || err));
  function confirmDel(name) {
    return new Promise((ok) => {
      const d = document.createElement("dialog"); d.className = "confirm";
      d.innerHTML = `<form method="dialog"><h2>¿Eliminar "${esc(name)}"?</h2><p>No se puede deshacer.</p><div class="confirm-actions"><button class="btn btn-outline" value="no">Volver</button><button class="btn btn-danger" value="ok">Eliminar</button></div></form>`;
      document.body.appendChild(d); d.showModal(); d.addEventListener("close", () => { ok(d.returnValue === "ok"); d.remove(); });
    });
  }
})();
