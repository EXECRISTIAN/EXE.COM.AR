// Panel → Imágenes: diseños guardados (tabla designs), imágenes de la página y fotos de productos.
// "🎨 Editar" abre el editor por capas (imagen.html); al guardar reemplaza la imagen donde se usa.
(() => {
  const A = window.EXE_ADMIN;
  const { esc } = A;
  const sb = () => A.be.sb;
  const imgUrl = (src) => (!src ? "" : /^(https?:|blob:)/.test(src) ? src : `../${src}`);
  const PRESETS = [["Carrusel principal", 1904, 650], ["Tarjeta vertical", 352, 480], ["Banner ancho", 1400, 400], ["Banner de marca", 1200, 750], ["Foto de producto", 1200, 1200], ["Historia / celular", 1080, 1920]];
  const BLOCK_NAMES = { hero: "Carrusel", tarjetas: "Tarjeta", banner: "Banner ancho", imagen: "Imagen", imagen_texto: "Imagen + texto" };
  let filter = "todas";

  const q = (o) => new URLSearchParams({ ...o, ...(A.demo ? { demo: "1" } : {}) }).toString();
  // Recorre los datos de una sección y junta cada imagen con su ruta (ej. slides.0.img)
  function blockImages(b) {
    const out = [];
    (function walk(o, path) {
      if (Array.isArray(o)) return o.forEach((v, i) => walk(v, [...path, i]));
      if (!o || typeof o !== "object") return;
      Object.entries(o).forEach(([k, v]) => {
        if ((k === "img" || k === "img_mobile") && typeof v === "string" && v) out.push({ src: v, path: [...path, k].join("."), mobile: k === "img_mobile" });
        else if (typeof v === "object") walk(v, [...path, k]);
      });
    })(b.data || {}, []);
    return out.map((x, i) => ({ ...x, title: `${BLOCK_NAMES[b.type] || b.title || b.type}${out.length > 1 ? " " + (i + 1) : ""}${x.mobile ? " (celular)" : ""}`, block: b.id }));
  }

  async function data() {
    if (A.demo) return {
      designs: [{ id: "demo", name: "Ryzen 8000 ya en stock", width: 1200, height: 750, image_url: "", hotspots: [{}, {}] }],
      blocks: [{ id: "hero", type: "hero", data: { slides: [{ img: "assets/img/banner-asus-z790.webp" }] } }, { id: "tarjetas", type: "tarjetas", data: { cards: [{ img: "assets/img/banner-marca-01.webp" }, { img: "assets/img/banner-marca-02.webp" }] } }, { id: "banner-ancho", type: "banner", data: { img: "assets/img/banner-inferior-01.webp" } }],
      products: [{ id: "asus-gtx1660", name: "ASUS GTX 1660", images: ["assets/img/products/asus-gtx1660-01.webp"] }, { id: "cooler-deepcool-ag400-plus", name: "Cooler DeepCool AG400 PLUS", images: ["assets/img/products/cooler-deepcool-02.webp"] }],
    };
    const [d, b, p] = await Promise.all([
      sb().from("designs").select("id,name,width,height,image_url,hotspots,updated_at").order("updated_at", { ascending: false }),
      sb().from("site_blocks").select("id,type,title,data").eq("page", "inicio").order("position"),
      A.perms.has("products.read") ? sb().from("products").select("id,name,images").order("name") : Promise.resolve({ data: [] }),
    ]);
    return { designs: d.data || [], blocks: b.data || [], products: (p.data || []).filter((x) => x.images && x.images.length) };
  }

  A.views.imagenes = async function () {
    const { designs, blocks, products } = await data();
    const cards = [];
    designs.forEach((d) => cards.push({ k: "disenos", img: d.image_url, title: d.name, sub: `Diseño · ${d.width}×${d.height}${d.hotspots && d.hotspots.length ? ` · ${d.hotspots.length} enlace${d.hotspots.length === 1 ? "" : "s"}` : ""}`, href: `imagen.html?${q({ id: d.id })}` }));
    blocks.forEach((b) => blockImages(b).forEach((x) => cards.push({ k: "banners", img: x.src, title: x.title, sub: "Página web", href: `imagen.html?${q({ src: x.src, target: `block:${b.id}:${x.path}`, name: x.title })}` })));
    products.forEach((p) => cards.push({ k: "productos", img: p.images[0], title: p.name, sub: `Producto · ${p.images.length} foto${p.images.length === 1 ? "" : "s"}`, href: `imagen.html?${q({ src: p.images[0], target: `product:${p.id}:0`, name: p.name })}` }));
    const list = cards.filter((c) => filter === "todas" || c.k === filter);
    return `<div class="img-bar">
        <select id="imgPreset" aria-label="Tamaño de la imagen nueva">${PRESETS.map(([n, w, h], i) => `<option value="${i}">${esc(n)} · ${w}×${h}</option>`).join("")}</select>
        <button type="button" class="btn btn-primary" id="imgNew">＋ Nueva imagen</button>
        <span class="img-sp"></span>
        ${[["todas", "Todas"], ["disenos", "Diseños guardados"], ["banners", "Banners de la página"], ["productos", "Fotos de productos"]].map(([k, t]) => `<button type="button" class="chip${filter === k ? " active" : ""}" data-imgf="${k}">${t}</button>`).join("")}
      </div>
      <div class="img-grid">${list.map((c) => `<article class="img-card"><a class="img-thumb" href="${esc(c.href)}">${c.img ? `<img src="${esc(imgUrl(c.img))}" alt="" loading="lazy">` : `<span>🎨</span>`}</a>
        <div class="img-info"><div><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></div><a class="btn btn-primary img-edit" href="${esc(c.href)}">🎨 Editar</a></div></article>`).join("") || '<p class="notice info">No hay imágenes en esta lista.</p>'}</div>
      <p class="notice info">Cada diseño guarda sus capas: podés volver a cambiar el texto, la foto o los enlaces sin empezar de cero. Al guardar se publica un WebP liviano y, si la imagen se usa en la página o en un producto, se reemplaza ahí.</p>`;
  };
  A.views.imagenes.after = () => {
    const nw = document.getElementById("imgNew");
    if (nw) nw.onclick = () => { const [n, w, h] = PRESETS[+document.getElementById("imgPreset").value]; location.href = `imagen.html?${q({ w, h, name: n })}`; };
    document.querySelectorAll("[data-imgf]").forEach((b) => (b.onclick = () => { filter = b.dataset.imgf; A.route(); }));
  };
})();
