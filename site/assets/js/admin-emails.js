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

  // Cuándo se envía cada plantilla y qué condiciones admite.
  // cond: d = días (demora/antigüedad), at = fecha y hora, aud = a quién, min = compra mínima, cat = categoría.
  // mk = publicitario: solo a quien aceptó recibir ofertas y con link de baja (Ley 25.326).
  const EV = [
    ["Pedidos", [
      ["order_created", "Al crear un pedido", "Apenas el cliente confirma el pedido.", ""],
      ["order_processing", "Pedido en proceso", "Cuando empezás a revisar el pedido (stock y precio final).", ""],
      ["payment_processing", "Pago en proceso", "Cuando el pago está en verificación (transferencia, Mercado Pago pendiente…).", ""],
      ["order_paid", "Pago procesado y verificado", "Cuando el pago se acreditó y se verificó (pedido pagado).", ""],
      ["order_preparing", "Pedido en preparación", "Cuando empezás a armar el pedido.", ""],
      ["order_packed", "Pedido embalado", "Cuando el pedido está embalado y listo para salir.", ""],
      ["order_shipped", "Pedido despachado", "Cuando sale del depósito (con o sin número de seguimiento).", ""],
      ["order_handed_carrier", "Entregado al servicio de envío", "Cuando el correo o la mensajería lo recibe (usa {{transportista}} y {{seguimiento}}).", ""],
      ["order_delivered", "Pedido entregado", "Cuando el envío figura como entregado.", ""],
      ["order_ready_pickup_point", "Listo para retirar en un punto de retiro", "Cuando llega al punto de retiro elegido (usa {{punto_retiro}}).", ""],
      ["order_ready_pickup_store", "Listo para retirar en el local", "Cuando está listo en el local (usa {{direccion_local}} y {{horario_local}}).", ""],
      ["order_cancelled", "Al cancelar el pedido", "Cuando el pedido se cancela (usa {{motivo}}).", ""],
      ["payment_reminder", "Recordatorio de pago", "Si el pedido sigue sin pagar N días después de creado. Se manda una sola vez.", "d"],
      ["review_request", "Pedir opinión", "N días después de entregado, para que cuente cómo le fue.", "d"],
      ["admin_new_order", "Aviso interno de pedido nuevo", "Le llega a ventas@ con los datos del cliente.", ""],
    ]],
    ["Clientes", [
      ["account_welcome", "Bienvenida", "Al confirmar el email de una cuenta nueva.", ""],
      ["inactive_customer", "Cliente inactivo", "A quien compró alguna vez y no volvió a comprar en N días.", "d mk"],
      ["back_in_stock", "Volvió el stock", "A quien pidió que le avisen cuando un producto vuelva a tener stock (usa {{producto}}).", "cat"],
      ["price_drop", "Bajó el precio", "Cuando baja el precio de un producto que el cliente compró o pidió que le avisen.", "cat mk"],
    ]],
    ["Campañas", [
      ["promo", "Ofertas y promociones", "Se envía en la fecha y hora elegidas a la audiencia elegida.", "at aud min cat mk"],
      ["special_date", "Fechas especiales (Hot Sale, Cyber Monday, Black Friday, Navidad)", "Se envía en la fecha elegida.", "at aud mk"],
      ["reopening", "Reapertura / vuelta de vacaciones", "Avisa que la tienda vuelve a atender. Se envía en la fecha elegida.", "at aud"],
      ["closing_notice", "Cierre temporal / vacaciones / feriados", "Avisa demoras o días sin atención. Se envía en la fecha elegida.", "at aud"],
      ["manual", "Manual (no se envía sola)", "Queda guardada para usarla cuando quieras.", ""],
    ]],
  ];
  const EVENTS = Object.fromEntries(EV.flatMap(([, l]) => l.map(([k, n]) => [k, n])));
  const EVINFO = Object.fromEntries(EV.flatMap(([, l]) => l.map(([k, n, d, c]) => [k, { n, d, c: c.split(" ") }])));
  const AUD = { order_customer: "El cliente del pedido", buyers: "Clientes que compraron alguna vez", all_customers: "Todos los clientes registrados", consent: "Solo quienes aceptaron recibir ofertas", admin: "Solo al equipo (ventas@)" };
  const COLS = "id,name,event,subject,preheader,title,body,button_label,button_url,show_items,why,active,system,updated_at,delay_days,send_at,audience,min_total,category";

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
          <td>${esc(EVENTS[t.event] || t.event)}${condText(t) ? `<small class="pr-meta">${esc(condText(t))}</small>` : ""}</td><td>${esc(t.subject)}</td>
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
            <label class="field">Cuándo se envía<select name="event" ${t.system ? "disabled" : ro}>${EV.map(([g, l]) => `<optgroup label="${g}">${l.map(([v, n]) => `<option value="${v}" ${v === t.event ? "selected" : ""}>${n}</option>`).join("")}</optgroup>`).join("")}</select></label>
          </div>
          <div class="em-cond" id="emCond">
            <p class="ed-hint" id="emEvDesc"></p>
            <div class="ed-grid">
              <label class="field" data-c="d">Días<input name="delay_days" type="number" min="0" max="365" value="${t.delay_days ?? ""}" placeholder="Ej: 3" ${ro}></label>
              <label class="field" data-c="at">Fecha y hora de envío<input name="send_at" type="datetime-local" value="${t.send_at ? new Date(new Date(t.send_at) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ""}" ${ro}></label>
              <label class="field" data-c="aud" ${"" }>A quién<select name="audience" ${ro}>${Object.entries(AUD).filter(([k]) => k !== "order_customer" && k !== "admin").map(([k, n]) => `<option value="${k}" ${k === t.audience ? "selected" : ""}>${n}</option>`).join("")}</select></label>
              <label class="field" data-c="min">Solo si compraron más de $ (opcional)<input name="min_total" inputmode="numeric" value="${t.min_total ?? ""}" ${ro}></label>
              <label class="field" data-c="cat">Solo categoría (opcional)<input name="category" value="${esc(t.category || "")}" placeholder="Ej: Placas de video" ${ro}></label>
            </div>
            <p class="notice info" data-c="mk">Es un email <b>publicitario</b>: solo se envía a quienes aceptaron recibir ofertas en Mi cuenta, y lleva al pie el link para darse de baja ({{link_baja}}).</p>
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
      show_items: f.show_items.checked, why: f.why.value.trim() || null, active: f.active.checked, ...readCond(f) });
    const ev = () => (cur.system ? cur.event : f.event.value);
    const showCond = () => { const i = EVINFO[ev()] || { d: "", c: [] }; $("emEvDesc").textContent = i.d;
      f.querySelectorAll("[data-c]").forEach((x) => (x.hidden = !i.c.includes(x.dataset.c)));
      // Publicitario: siempre con consentimiento (se puede acotar a quienes además compraron)
      const mk = i.c.includes("mk"); const o = f.audience.querySelector('[value="all_customers"]'); if (o) { o.hidden = mk; o.disabled = mk; }
      const ob = f.audience.querySelector('[value="buyers"]'); if (ob) ob.textContent = mk ? "Clientes que compraron y aceptaron ofertas" : "Clientes que compraron alguna vez";
      if (mk && f.audience.value === "all_customers") f.audience.value = "consent"; };
    f.event.addEventListener("change", showCond); showCond();
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
      const ci = (EVINFO[t.event] || { c: [] }).c;
      if (ci.includes("d") && !(t.delay_days >= 0 && t.delay_days !== null)) return msg("Poné la cantidad de días.", "error");
      if (ci.includes("at") && t.active && !t.send_at) return msg("Elegí la fecha y hora de envío.", "error");
      if (ci.includes("mk") && !/\{\{\s*link_baja\s*\}\}/.test(t.body + (t.why || ""))) t.why = ((t.why || "") + " Si no querés recibir más ofertas: {{link_baja}}").trim();
      if (cur.isNew) t.id = newId(t.name);
      try { await save(t, cur.isNew); msg("Guardado ✔", "ok"); if (cur.isNew) location.hash = `#email/${encodeURIComponent(t.id)}`; else cur = { ...t, isNew: false }; }
      catch (err) { msg("No se pudo guardar: " + err.message, "error"); }
    });
    draw();
  };

  /* ---------- Utilidades ---------- */
  function readCond(f) {
    const c = (EVINFO[cur.system ? cur.event : f.event.value] || { c: [] }).c;
    const n = (v) => (String(v).trim() === "" ? null : Number(String(v).replace(/\D/g, "")));
    return {
      delay_days: c.includes("d") ? n(f.delay_days.value) : null,
      send_at: c.includes("at") && f.send_at.value ? new Date(f.send_at.value).toISOString() : null,
      audience: c.includes("mk") ? (f.audience.value === "buyers" ? "buyers" : "consent") : c.includes("aud") ? f.audience.value : cur.event === "admin_new_order" ? "admin" : "order_customer",
      min_total: c.includes("min") ? n(f.min_total.value) : null,
      category: c.includes("cat") ? f.category.value.trim() || null : null,
    };
  }
  function condText(t) {
    const out = [];
    if (t.delay_days != null) out.push(`${t.delay_days} día${t.delay_days === 1 ? "" : "s"}`);
    if (t.send_at) out.push(new Date(t.send_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }));
    if (t.audience && !["order_customer", "admin"].includes(t.audience)) out.push(AUD[t.audience]);
    if (t.category) out.push(t.category);
    return out.join(" · ");
  }
  function newId(base) {
    let id = String(base || "plantilla").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "plantilla";
    const taken = new Set((demoRows || []).map((x) => x.id).concat(A._emailIds || []));
    let out = id, k = 2; while (taken.has(out)) out = `${id}_${k++}`;
    return out;
  }
  async function save(t, insert) {
    const row = { id: t.id, name: t.name, event: t.event, subject: t.subject, preheader: t.preheader, title: t.title, body: t.body,
      button_label: t.button_label, button_url: t.button_url, show_items: t.show_items, why: t.why, active: t.active,
      delay_days: t.delay_days ?? null, send_at: t.send_at ?? null, audience: t.audience || "order_customer", min_total: t.min_total ?? null, category: t.category || null };
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
