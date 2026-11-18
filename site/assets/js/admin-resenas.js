// Panel → Reseñas (permiso reviews.manage).
// Las opiniones de los clientes llegan "pendientes" (solo puede opinar quien compró el producto). Desde acá se
// publican, se rechazan o se responden. La tienda y Google muestran únicamente las publicadas.
(() => {
  const A = window.EXE_ADMIN;
  const { esc } = A;
  const sb = () => A.be.sb;
  const ST = { pending: ["Pendiente", "pending"], approved: ["Publicada", "paid"], rejected: ["Rechazada", "cancelled"] };
  let filter = "pending";

  function demo() {
    if (!A.DEMO._reviews) A.DEMO._reviews = [
      { id: 1, product_id: "demo-rtx-3060", rating: 5, comment: "Llegó rápido y funciona perfecto.", author: "Juan P.", status: "pending", reply: null, created_at: new Date().toISOString(), products: { name: "Placa de Video RTX 3060 12GB (demo)" } },
      { id: 2, product_id: "demo-cooler", rating: 4, comment: "Muy buen cooler, algo ruidoso al máximo.", author: "Ana G.", status: "approved", reply: "¡Gracias por tu compra!", created_at: new Date().toISOString(), products: { name: "Cooler de ejemplo (demo)" } },
    ];
    return A.DEMO._reviews;
  }
  async function load() {
    if (A.demo) return demo();
    const { data, error } = await sb().from("reviews").select("id, product_id, rating, comment, author, status, reply, created_at, products(name)").order("created_at", { ascending: false }).limit(300);
    if (error) throw new Error(/reviews/.test(error.message) ? "La función de reseñas todavía no está activada en la base de datos." : error.message);
    return data || [];
  }
  const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

  A.views.resenas = async function (f) {
    if (f && ST[f] || f === "todas") filter = f;
    const all = await load();
    const list = filter === "todas" ? all : all.filter((r) => r.status === filter);
    const count = (s) => all.filter((r) => r.status === s).length;
    return `<p class="ed-hint" style="margin-top:0">Solo pueden opinar los clientes que compraron el producto (con la compra cargada a su cuenta). Las opiniones aparecen en la tienda y en Google <b>recién cuando las publicás</b>. Publicá también las negativas si son reales y respetuosas: Google penaliza mostrar solo las buenas.</p>
      <div class="vt-bar-top">${[["pending", `Pendientes (${count("pending")})`], ["approved", `Publicadas (${count("approved")})`], ["rejected", `Rechazadas (${count("rejected")})`], ["todas", `Todas (${all.length})`]]
        .map(([k, l]) => `<button type="button" class="vt-chip ${filter === k ? "on" : ""}" data-rv-filter="${k}">${l}</button>`).join("")}</div>
      ${list.length ? list.map((r) => `<div class="panel rv-adm" data-rv="${r.id}">
        <div class="rv-adm-head"><span class="rv-stars">${stars(r.rating)}</span> <b>${esc(r.author)}</b> sobre
          <a href="#editar/${encodeURIComponent(r.product_id)}">${esc(r.products?.name || r.product_id)}</a>
          <small>${new Date(r.created_at).toLocaleDateString("es-AR")}</small> <span class="pill ${ST[r.status][1]}">${ST[r.status][0]}</span></div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : `<p class="ed-hint">(Sin comentario, solo estrellas)</p>`}
        <label class="field">Respuesta de EXE (opcional, se publica debajo)<textarea rows="2" maxlength="1000" data-rv-reply>${esc(r.reply || "")}</textarea></label>
        <div class="rv-adm-acts">
          <button type="button" class="btn btn-primary" data-rv-set="approved">${r.status === "approved" ? "Guardar respuesta" : "Publicar"}</button>
          ${r.status !== "rejected" ? `<button type="button" class="btn btn-outline" data-rv-set="rejected">${r.status === "approved" ? "Ocultar" : "Rechazar"}</button>` : ""}
          <span class="ed-hint" data-rv-msg></span></div></div>`).join("")
        : `<p class="notice info">No hay reseñas ${filter === "pending" ? "pendientes" : "en esta lista"}.</p>`}`;
  };

  A.views.resenas.after = () => {
    document.querySelectorAll("[data-rv-filter]").forEach((b) => (b.onclick = () => { const h = `#resenas/${b.dataset.rvFilter}`; location.hash === h ? A.route() : (location.hash = h); }));
    document.querySelectorAll("[data-rv-set]").forEach((b) => (b.onclick = async () => {
      const card = b.closest("[data-rv]"), id = Number(card.dataset.rv), msg = card.querySelector("[data-rv-msg]");
      const reply = card.querySelector("[data-rv-reply]").value;
      if (A.demo) { Object.assign(demo().find((r) => r.id === id), { status: b.dataset.rvSet, reply }); return A.route(); }
      msg.textContent = "Guardando…";
      const { error } = await sb().rpc("moderate_review", { p_id: id, p_status: b.dataset.rvSet, p_reply: reply });
      if (error) { msg.textContent = "No se pudo guardar: " + error.message; return; }
      A.route();
    }));
  };
})();
