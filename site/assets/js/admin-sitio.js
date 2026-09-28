// Panel → Página web: secciones del inicio (orden, mostrar/ocultar, contenido) y secciones nuevas.
// Datos en Supabase (site_blocks, bucket "sitio"); edición solo con el permiso site.edit (RLS).
(() => {
  const A = window.EXE_ADMIN;
  const { esc, $ } = A;
  const sb = () => A.be.sb;
  const imgUrl = (src) => (!src ? "" : /^(https?:|blob:)/.test(src) ? src : `../${src}`);
  const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  // Tipos de sección y sus campos. list = lista repetible.
  const TYPES = {
    hero: { name: "Carrusel de imágenes", fields: [{ k: "slides", list: "Imagen", item: [{ k: "img", t: "image", l: "Imagen (1904 × 540 px aprox.)" }, { k: "alt", l: "Descripción de la imagen" }, { k: "link", l: "Link al tocar (opcional)" }] }] },
    tarjetas: { name: "Tarjetas con imagen y botón", fields: [{ k: "cards", list: "Tarjeta", item: [{ k: "img", t: "image", l: "Imagen (vertical, 352 × 480 px aprox.)" }, { k: "img_mobile", t: "image", l: "Imagen para celular (opcional)" }, { k: "alt", l: "Descripción de la imagen" }, { k: "text", l: "Texto del botón" }, { k: "filter", l: "Al tocar, mostrar la categoría…" }, { k: "link", l: "…o ir a este link" }] }] },
    catalogo: { name: "Catálogo de productos", fields: [{ k: "title", l: "Título" }, { k: "text", t: "textarea", l: "Texto" }] },
    banner: { name: "Banner ancho", fields: [{ k: "img", t: "image", l: "Imagen (ancha, 1400 × 400 px aprox.)" }, { k: "alt", l: "Descripción" }, { k: "filter", l: "Al tocar, mostrar la categoría…" }, { k: "link", l: "…o ir a este link" }] },
    beneficios: { name: "Beneficios", fields: [{ k: "items", list: "Beneficio", max: 3, item: [{ k: "title", l: "Título" }, { k: "text", l: "Texto" }] }] },
    logos: { name: "Carrusel de logos de marcas", fields: [], note: "Los logos se cargan en config.js. Acá podés mostrarlo, ocultarlo o moverlo." },
    contacto: { name: "Contacto por WhatsApp", fields: [{ k: "title", l: "Título" }, { k: "text", t: "textarea", l: "Texto" }, { k: "button", l: "Texto del botón" }] },
    texto: { name: "Texto con botón", create: true, fields: [{ k: "title", l: "Título" }, { k: "text", t: "textarea", l: "Texto" }, { k: "button_text", l: "Texto del botón (opcional)" }, { k: "button_link", l: "Link del botón (vacío = ir a productos)" }] },
    imagen: { name: "Imagen / banner", create: true, fields: [{ k: "img", t: "image", l: "Imagen" }, { k: "alt", l: "Descripción" }, { k: "link", l: "Link al tocar (opcional)" }, { k: "filter", l: "…o mostrar la categoría" }] },
    imagen_texto: { name: "Imagen + texto", create: true, fields: [{ k: "img", t: "image", l: "Imagen" }, { k: "alt", l: "Descripción de la imagen" }, { k: "title", l: "Título" }, { k: "text", t: "textarea", l: "Texto" }, { k: "button_text", l: "Texto del botón (opcional)" }, { k: "button_link", l: "Link del botón" }, { k: "side", t: "select", o: ["izquierda", "derecha"], l: "Imagen a la…" }] },
    aviso: { name: "Barra de aviso", create: true, fields: [{ k: "text", l: "Texto (ej: ¡Envío gratis en compras de más de $500.000!)" }, { k: "link", l: "Link (opcional)" }] },
  };

  let demoBlocks = null;
  async function load() {
    if (A.demo) {
      demoBlocks = demoBlocks || [
        { id: "hero", type: "hero", title: "Carrusel principal", position: 0, active: true, builtin: true, data: { slides: [{ img: "assets/img/banner-asus-z790.webp", alt: "Z790", link: "" }] } },
        { id: "catalogo", type: "catalogo", title: "Catálogo de productos", position: 1, active: true, builtin: true, data: { title: "Productos destacados", text: "…" } },
        { id: "banner-ancho", type: "banner", title: "Banner ancho (motherboards ASUS X570/B550)", position: 2, active: false, builtin: true, data: { img: "assets/img/banner-inferior-01.webp" } },
      ];
      return demoBlocks;
    }
    const r = await sb().from("site_blocks").select("*").eq("page", "inicio").order("position");
    if (r.error) throw r.error;
    return r.data;
  }
  // Actualiza filas existentes (o crea si no existe) de a una
  async function save(rows) {
    for (const row of rows) {
      if (A.demo) { const i = demoBlocks.findIndex((b) => b.id === row.id); if (i >= 0) demoBlocks[i] = { ...demoBlocks[i], ...row }; else demoBlocks.push(row); continue; }
      const { id, ...fields } = row;
      const exists = (await sb().from("site_blocks").select("id").eq("id", id)).data?.length;
      const r = exists
        ? await sb().from("site_blocks").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id)
        : await sb().from("site_blocks").insert({ id, ...fields });
      if (r.error) throw r.error;
    }
  }

  /* ---------- Listado de secciones ---------- */
  A.subviews["sitio-editar"] = { perm: "site.edit", parent: "sitio", title: () => "Editar sección" };
  A.views.sitio = async function () {
    const blocks = await load();
    return `
      <div class="pr-toolbar">
        <button class="btn btn-primary" id="stAdd" type="button">＋ Agregar sección</button>
        <a class="btn btn-outline" href="../index.html" target="_blank" rel="noopener">Ver la página ↗</a>
      </div>
      <div class="panel"><h3 style="margin-top:0">Página principal (de arriba hacia abajo)</h3>
        <ol class="st-list">${blocks.map((b, i) => `<li class="st-item ${b.active ? "" : "is-off"}" data-id="${esc(b.id)}">
          <div class="st-move"><button type="button" data-mv="-1" title="Subir" ${i === 0 ? "disabled" : ""}>▲</button><button type="button" data-mv="1" title="Bajar" ${i === blocks.length - 1 ? "disabled" : ""}>▼</button></div>
          <div class="st-info"><b>${esc(b.title || TYPES[b.type].name)}</b><small>${esc(TYPES[b.type].name)}${b.active ? "" : " · oculta"}</small></div>
          <label class="switch" title="Mostrar / ocultar"><input type="checkbox" data-act ${b.active ? "checked" : ""}><span></span></label>
          <a class="btn btn-outline" href="#sitio-editar/${encodeURIComponent(b.id)}">Editar</a>
          ${b.builtin ? `<span class="st-lock" title="Sección original: se puede ocultar, no eliminar">🔒</span>` : `<button type="button" class="link-btn" data-del title="Eliminar">🗑</button>`}
        </li>`).join("")}</ol>
      </div>
      <p class="notice info">Los cambios se ven en la web apenas los guardás (recargá la página). Mi cuenta y el panel son páginas de funcionamiento, sin secciones para editar.</p>`;
  };
  A.views.sitio.after = () => {
    const list = document.querySelector(".st-list");
    list.addEventListener("change", async (e) => {
      if (!e.target.matches("[data-act]")) return;
      const id = e.target.closest(".st-item").dataset.id;
      try { await save([{ id, active: e.target.checked }]); A.route(); }
      catch (err) { A.alertView("No se pudo guardar: " + err.message); }
    });
    list.addEventListener("click", async (e) => {
      const item = e.target.closest(".st-item"); if (!item) return;
      const blocks = await load(); const i = blocks.findIndex((b) => b.id === item.dataset.id);
      try {
        if (e.target.closest("[data-mv]")) {
          const j = i + +e.target.closest("[data-mv]").dataset.mv; if (j < 0 || j >= blocks.length) return;
          [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
          await save(blocks.map((b, k) => ({ id: b.id, position: k })).filter((b, k) => blocks[k].position !== k || true));
          return A.route();
        }
        if (e.target.closest("[data-del]")) {
          if (!(await confirmBox(`¿Eliminar "${blocks[i].title}"?`, "Se borra de la página. No se puede deshacer (si solo querés esconderla, usá el interruptor)."))) return;
          if (A.demo) demoBlocks.splice(i, 1); else { const r = await sb().from("site_blocks").delete().eq("id", blocks[i].id); if (r.error) throw r.error; }
          return A.route();
        }
      } catch (err) { A.alertView("No se pudo guardar: " + err.message); }
    });
    $("stAdd").onclick = async () => {
      const type = await pickType(); if (!type) return;
      const blocks = await load();
      let id = `${type}-${Date.now().toString(36)}`;
      const row = { id, page: "inicio", type, title: TYPES[type].name, position: blocks.length, active: false, builtin: false, data: type === "imagen_texto" ? { side: "izquierda" } : {} };
      try { await save([row]); location.hash = `#sitio-editar/${encodeURIComponent(id)}`; }
      catch (err) { A.alertView("No se pudo crear: " + err.message); }
    };
  };

  function dialogHtml(inner) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog"); d.className = "confirm";
      d.innerHTML = `<form method="dialog">${inner}</form>`; document.body.appendChild(d); d.showModal();
      d.addEventListener("close", () => { resolve(d.returnValue); d.remove(); });
    });
  }
  const confirmBox = (t, x) => dialogHtml(`<h2>${esc(t)}</h2><p>${esc(x)}</p><div class="confirm-actions"><button class="btn btn-outline" value="cancel">Volver</button><button class="btn btn-primary" value="ok">Eliminar</button></div>`).then((v) => v === "ok");
  const pickType = () => dialogHtml(`<h2>¿Qué sección querés agregar?</h2><p>Se crea oculta al final; la editás y la activás cuando esté lista.</p>
    <div class="st-types">${Object.entries(TYPES).filter(([, t]) => t.create).map(([k, t]) => `<button class="btn btn-outline" value="${k}">${esc(t.name)}</button>`).join("")}</div>
    <div class="confirm-actions"><button class="btn btn-outline" value="">Volver</button></div>`).then((v) => (v && TYPES[v] ? v : null));

  /* ---------- Editor de una sección ---------- */
  let cur = null;
  A.views["sitio-editar"] = async function (id) {
    const blocks = await load(); const b = blocks.find((x) => x.id === id);
    if (!b) return `<p class="notice error">No existe la sección.</p>`;
    cur = JSON.parse(JSON.stringify(b)); cur.data = cur.data || {};
    const T = TYPES[b.type];
    return `<form id="stForm" class="ed">
      <div class="ed-bar"><a class="btn btn-outline" href="#sitio">← Volver a la página</a><span class="ed-spacer"></span><button class="btn btn-primary" type="submit">Guardar</button></div>
      <p class="notice" id="stMsg" hidden></p>
      <section class="panel ed-sec"><h3>${esc(T.name)}</h3>
        <div class="ed-grid"><label class="field">Nombre (solo para el panel)<input name="title" value="${esc(b.title || "")}"></label>
        <label class="field ed-check"><input type="checkbox" name="active" ${b.active ? "checked" : ""}> Mostrar en la página</label></div>
        ${T.note ? `<p class="ed-hint">${esc(T.note)}</p>` : ""}
        <div id="stFields"></div>
      </section>
      <div class="ed-bar ed-bar-bottom"><span class="ed-spacer"></span><button class="btn btn-primary" type="submit">Guardar</button></div>
    </form>`;
  };
  A.views["sitio-editar"].after = () => { renderFields(); bind(); };

  const fieldHtml = (f, val, path) => {
    const name = `data-path="${esc(path)}"`;
    if (f.t === "image") return `<div class="field st-img"><span>${esc(f.l)}</span><div class="st-img-row">
        ${val ? `<img src="${esc(imgUrl(val))}" alt="">` : `<span class="pr-thumb pr-nophoto">📷</span>`}
        <input class="pr-in" ${name} value="${esc(val || "")}" placeholder="link de la imagen o subí una">
        <button type="button" class="btn btn-outline" data-upload="${esc(path)}">Subir</button></div></div>`;
    if (f.t === "textarea") return `<label class="field">${esc(f.l)}<textarea rows="4" ${name}>${esc(val || "")}</textarea></label>`;
    if (f.t === "select") return `<label class="field">${esc(f.l)}<select ${name}>${f.o.map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
    return `<label class="field">${esc(f.l)}<input ${name} value="${esc(val || "")}"></label>`;
  };
  function renderFields() {
    const T = TYPES[cur.type];
    $("stFields").innerHTML = T.fields.map((f) => {
      if (!f.list) return fieldHtml(f, cur.data[f.k], f.k);
      const items = cur.data[f.k] || [];
      return `<div class="st-listed">${items.map((it, i) => `<div class="ed-spec"><div class="ed-spec-head"><b>${esc(f.list)} ${i + 1}</b><span class="ed-spacer"></span>
          <button type="button" class="link-btn" data-lmv="${f.k}:${i}:-1" ${i === 0 ? "disabled" : ""}>▲</button><button type="button" class="link-btn" data-lmv="${f.k}:${i}:1" ${i === items.length - 1 ? "disabled" : ""}>▼</button>
          <button type="button" class="link-btn" data-lrm="${f.k}:${i}">Quitar</button></div>
          <div class="ed-grid">${f.item.map((sf) => fieldHtml(sf, it[sf.k], `${f.k}.${i}.${sf.k}`)).join("")}</div></div>`).join("")}
        ${!f.max || items.length < f.max ? `<button type="button" class="btn btn-outline" data-ladd="${f.k}">＋ Agregar ${esc(f.list.toLowerCase())}</button>` : ""}</div>`;
    }).join("") || "";
  }
  // Pasa lo escrito en el formulario a cur.data
  function readFields() {
    document.querySelectorAll("#stFields [data-path]").forEach((el) => {
      const parts = el.dataset.path.split("."); let o = cur.data;
      while (parts.length > 1) { const p = parts.shift(); o = o[isNaN(p) ? p : +p] = o[isNaN(p) ? p : +p] || {}; }
      o[parts[0]] = el.value.trim();
    });
  }
  async function toWebp(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    return new Promise((ok) => cv.toBlob(ok, "image/webp", 0.85));
  }
  const msg = (t, k) => { const m = $("stMsg"); m.hidden = false; m.className = `notice ${k}`; m.textContent = t; };
  function bind() {
    const f = $("stForm");
    $("stFields").addEventListener("click", (e) => {
      const add = e.target.closest("[data-ladd]"), rm = e.target.closest("[data-lrm]"), mv = e.target.closest("[data-lmv]"), up = e.target.closest("[data-upload]");
      if (up) {
        const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
        inp.onchange = async () => {
          const file = inp.files[0]; if (!file) return;
          try {
            msg("Subiendo imagen…", "info");
            const blob = await toWebp(file); let url;
            if (A.demo) url = URL.createObjectURL(blob);
            else {
              const path = `${slug(cur.id)}/${Date.now()}.webp`;
              const r = await sb().storage.from("sitio").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
              if (r.error) throw r.error;
              url = sb().storage.from("sitio").getPublicUrl(path).data.publicUrl;
            }
            readFields(); const target = f.querySelector(`[data-path="${CSS.escape(up.dataset.upload)}"]`); target.value = url; readFields(); renderFields();
            msg("Imagen subida. Acordate de Guardar.", "ok");
          } catch (err) { msg("No se pudo subir: " + err.message, "error"); }
        };
        return inp.click();
      }
      if (!add && !rm && !mv) return;
      readFields();
      if (add) (cur.data[add.dataset.ladd] = cur.data[add.dataset.ladd] || []).push({});
      if (rm) { const [k, i] = rm.dataset.lrm.split(":"); cur.data[k].splice(+i, 1); }
      if (mv) { const [k, i, d] = mv.dataset.lmv.split(":"); const a = cur.data[k], j = +i + +d; [a[+i], a[j]] = [a[j], a[+i]]; }
      renderFields();
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); readFields();
      try {
        await save([{ id: cur.id, type: cur.type, page: cur.page || "inicio", position: cur.position, builtin: cur.builtin, title: f.elements.title.value.trim() || TYPES[cur.type].name, active: f.elements.active.checked, data: cur.data }]);
        msg("Guardado ✔ Recargá la página web para verlo.", "ok");
      } catch (err) { msg("No se pudo guardar: " + err.message, "error"); }
    });
  }
})();
