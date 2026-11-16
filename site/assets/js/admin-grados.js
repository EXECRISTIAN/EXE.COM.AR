// Panel → Grados outlet (permiso products.write).
// Prender / apagar el sistema de grados, la ventana "Leí y acepto" y cada grado, y editar todos los textos.
// La tienda lee esto de outlet_settings / outlet_grades; si la base no responde, usa sus textos por defecto.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, $ } = A;
  const sb = () => A.be.sb;
  const ORDER = ["A", "B", "C", "G", "D"];
  const ROLE = { A: "Grado A", B: "Grado B", C: "Grado C", G: "Grado general A a C (productos sin grado cargado)", D: "Grado D" };
  let data = null;

  function demo() {
    if (!A.DEMO._grades) A.DEMO._grades = {
      settings: { enabled: true, ack_enabled: true, warranty_months: 3, base_text: "Producto usado o reacondicionado, con mantenimiento y pruebas de funcionamiento hechas por EXE.", img_note: "Las imágenes son ilustrativas: el empaque, el color o detalles menores pueden variar sin afectar las características ni el funcionamiento." },
      grades: [
        { code: "A", enabled: true, in_list: true, sort: 1, name: "Grado A · Excelente", txt: "Como nuevo: sin marcas de uso a la vista." },
        { code: "B", enabled: true, in_list: true, sort: 2, name: "Grado B · Muy bueno", txt: "Puede tener alguna marca leve de uso, como pequeños rayones o desgaste, que no afecta el funcionamiento." },
        { code: "C", enabled: true, in_list: true, sort: 3, name: "Grado C · Bueno", txt: "Puede tener marcas de uso visibles o detalles estéticos (rayones, desgaste, alguna tapa o etiqueta faltante). Funciona perfecto." },
        { code: "G", enabled: true, in_list: true, sort: 4, name: "Grado A a C · Seleccionado", txt: "Según la unidad, puede estar entre como nuevo y/o con posibles marcas de uso, visibles o no a simple vista. Todas funcionan perfecto.", list_name: "Grado A a C · Asignado automáticamente", list_txt: "Es el grado que se asigna automáticamente a las unidades que todavía no fueron clasificadas a mano." },
        { code: "D", enabled: true, in_list: false, sort: 5, name: "Grado D · No funciona", txt: "No funciona y puede estar en cualquier estado. Se vende para repuesto o reparación.", own_base: "Sin garantía de funcionamiento." },
      ],
    };
    return A.DEMO._grades;
  }
  async function load() {
    if (A.demo) return (data = demo());
    const [s, g] = await Promise.all([
      sb().from("outlet_settings").select("*").eq("id", 1).maybeSingle(),
      sb().from("outlet_grades").select("*"),
    ]);
    for (const x of [s, g]) if (x.error) throw x.error;
    return (data = { settings: s.data || {}, grades: g.data || [] });
  }

  const chk = (name, on, label) => `<label class="ed-check"><input type="checkbox" name="${name}" ${on ? "checked" : ""}> ${label}</label>`;
  const area = (name, v, label, rows = 2, ph = "") => `<label class="field">${label}<textarea name="${name}" rows="${rows}" placeholder="${esc(ph)}">${esc(v || "")}</textarea></label>`;
  const inp = (name, v, label, ph = "") => `<label class="field">${label}<input name="${name}" value="${esc(v ?? "")}" placeholder="${esc(ph)}"></label>`;

  A.views.grados = async function () {
    const { settings: s, grades } = await load();
    const by = Object.fromEntries(grades.map((g) => [g.code, g]));
    return `<p class="ed-hint" style="margin-top:0">Los productos marcados como <b>outlet</b> muestran su grado en la tienda y, antes de enviar el pedido, el cliente tiene que tildar <b>"Leí y acepto"</b>. Lo aceptado viaja en el mensaje de WhatsApp. El grado de cada producto se elige en <a href="#productos">Productos y stock</a>; si no tiene, lleva el <b>grado general A a C</b>.</p>
      <form class="panel cd-form" id="grForm">
        <h3>⚙️ General</h3>
        ${chk("enabled", s.enabled, "<b>Grados activados</b> (apagado: los outlet muestran solo la etiqueta \"Outlet\" y cómo vienen, sin grado)")}
        ${chk("ack_enabled", s.ack_enabled, "<b>Pedir \"Leí y acepto\"</b> antes de enviar un pedido con productos outlet")}
        <div class="cd-grid">${inp("warranty_months", s.warranty_months, "Garantía de los outlet (meses, 0 = no mostrar)")}</div>
        ${area("base_text", s.base_text, "Texto que acompaña a los grados (sin la garantía, que se agrega sola)", 2)}
        ${area("img_note", s.img_note, "Aviso de imágenes ilustrativas", 2)}
        ${ORDER.filter((c) => by[c]).map((c) => { const g = by[c]; return `<fieldset class="gr-card" data-code="${c}">
          <legend>${esc(ROLE[c])}</legend>
          <div class="gr-flags">${chk(`en_${c}`, g.enabled, "Activado")} ${chk(`li_${c}`, g.in_list, "Mostrar en \"¿Qué significa cada grado?\"")}</div>
          ${inp(`name_${c}`, g.name, "Nombre (en el producto)")}
          ${area(`txt_${c}`, g.txt, "Descripción (en el producto)")}
          <details${g.list_name || g.list_txt ? " open" : ""}><summary>Texto distinto en la lista de grados (opcional)</summary>
            ${inp(`lname_${c}`, g.list_name, "Nombre en la lista", "Vacío = el mismo de arriba")}
            ${area(`ltxt_${c}`, g.list_txt, "Descripción en la lista", 2, "Vacío = la misma de arriba")}
          </details>
          ${area(`base_${c}`, g.own_base, "Texto propio en lugar del general y la garantía (opcional)", 2, "Vacío = usa el texto general y la garantía")}
        </fieldset>`; }).join("")}
        <div class="gr-actions"><button class="btn btn-primary" type="submit">Guardar</button> <span class="cd-msg" id="grMsg"></span></div>
        <p class="ed-hint">Un grado apagado no se muestra: los productos que lo tienen quedan solo con la etiqueta "Outlet". Si apagás el grado general, lo mismo pasa con los outlet sin grado cargado.</p>
      </form>`;
  };

  A.views.grados.after = () => {
    const f = $("grForm"); if (!f) return;
    const msg = (t, ok) => { const m = $("grMsg"); m.textContent = t; m.className = `cd-msg ${ok ? "ok" : "err"}`; };
    const val = (n) => (f.elements[n] ? f.elements[n].value.trim() : "");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const w = Math.round(Number(val("warranty_months")));
      if (!(w >= 0 && w <= 120)) return msg("La garantía tiene que ser un número de meses entre 0 y 120.");
      const settings = { enabled: f.enabled.checked, ack_enabled: f.ack_enabled.checked, warranty_months: w, base_text: val("base_text"), img_note: val("img_note") };
      if (!settings.base_text) return msg("Completá el texto que acompaña a los grados.");
      const rows = data.grades.map((g) => ({ code: g.code, enabled: f.elements[`en_${g.code}`].checked, in_list: f.elements[`li_${g.code}`].checked,
        name: val(`name_${g.code}`), txt: val(`txt_${g.code}`), list_name: val(`lname_${g.code}`) || null, list_txt: val(`ltxt_${g.code}`) || null, own_base: val(`base_${g.code}`) || null }));
      const empty = rows.find((r) => !r.name || !r.txt);
      if (empty) return msg(`Completá el nombre y la descripción de ${ROLE[empty.code]}.`);
      if (A.demo) { Object.assign(data.settings, settings); rows.forEach((r) => Object.assign(data.grades.find((g) => g.code === r.code), r)); return msg("✓ Guardado (demo)", true); }
      const now = new Date().toISOString();
      const uid = (await A.be.sb.auth.getUser()).data.user?.id;
      const r1 = await sb().from("outlet_settings").update({ ...settings, updated_at: now, updated_by: uid }).eq("id", 1);
      if (r1.error) return msg("No se pudo guardar: " + r1.error.message);
      for (const r of rows) {
        const { code, ...rest } = r;
        const x = await sb().from("outlet_grades").update({ ...rest, updated_at: now }).eq("code", code);
        if (x.error) return msg("No se pudo guardar: " + x.error.message);
      }
      await load();
      msg("✓ Guardado. La tienda lo muestra al recargar la página.", true);
    };
  };
})();
