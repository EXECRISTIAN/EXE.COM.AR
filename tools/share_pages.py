"""Páginas de producto indexables por Google: site/p/<id>/index.html (+ sitemap.xml con todas)

Google no lee lo que va después del # (#producto/<id>), así que la tienda era para Google una sola página.
Cada producto tiene acá su página real: título, precio, fotos, descripción, especificaciones, datos
estructurados (Product + Breadcrumb) y dirección canónica, con botones a la tienda y a WhatsApp.
También sirven de vista previa al compartir:

Facebook, WhatsApp, Telegram, etc. no leen lo que va después del # ni ejecutan JavaScript, así que un link
https://exe.com.ar/#producto/<id> siempre mostraba la imagen general de la web. Este script crea, por cada
producto activo, una página con título, descripción y FOTO DEL PRODUCTO (etiquetas og:/twitter:).
La tienda comparte ese link (https://exe.com.ar/p/<id>/).

Corre en cada deploy (pages.yml) y de forma programada, así cubre los productos que se agreguen después.
Lee los productos públicos de Supabase (misma clave pública que usa la web); si no responde, usa
site/data/products.json. Solo datos públicos: los mismos que muestra la tienda.
"""
import html, json, re, shutil, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "p"
BASE = "https://exe.com.ar/"


def config():
    js = (SITE / "assets/js/config.js").read_text()
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', js).group(1)
    key = re.search(r'supabaseAnonKey:\s*"([^"]+)"', js).group(1)
    return url, key


def load_products():
    try:
        url, key = config()
        req = urllib.request.Request(
            f"{url}/rest/v1/products?select=id,name,brand,category,description,images,image,price,ask_price,ask_stock,stock,show_stock,cart_ok,hide_no_stock,specs,outlet,condition,updated_at&active=eq.true&order=sort.asc,name.asc",
            headers={"apikey": key, "Authorization": f"Bearer {key}"})
        rows = json.load(urllib.request.urlopen(req, timeout=30))
        if isinstance(rows, list) and rows:
            print(f"Supabase: {len(rows)} productos activos")
            return rows
    except Exception as e:
        print(f"Supabase no respondió ({e}); uso site/data/products.json", file=sys.stderr)
    return json.load(open(SITE / "data/products.json"))


def abs_url(u):
    if not u:
        return BASE + "assets/img/banner-asus-series-500-400.webp"
    return u if re.match(r"^https?://", u) else BASE + u.lstrip("./")


def safe_id(pid):
    # Solo ids que sirvan como carpeta (los de la tienda son slugs: letras, números y guiones)
    return bool(re.fullmatch(r"[A-Za-z0-9._-]+", pid or "")) and pid not in (".", "..")


def og_image(p):
    """Copia JPG de la primera foto en site/p/<id>/og.jpg (Facebook/WhatsApp no siempre aceptan .webp).
    Si no se puede convertir, usa la foto original."""
    imgs = p.get("images") or ([p["image"]] if p.get("image") else [])
    src = imgs[0] if imgs else None
    if not src:
        return abs_url(None), (1200, 630)
    try:
        from PIL import Image
        import io
        if re.match(r"^https?://", src):
            data = urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()
            im = Image.open(io.BytesIO(data))
        else:
            im = Image.open(SITE / src.lstrip("./"))
        im = im.convert("RGBA")
        im.thumbnail((1200, 1200))
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        out = OUT / p["id"] / "og.jpg"
        out.parent.mkdir(parents=True, exist_ok=True)
        bg.save(out, "JPEG", quality=85)
        return f"{BASE}p/{p['id']}/og.jpg", bg.size
    except Exception as e:
        print(f"{p['id']}: no pude convertir la foto ({e}); uso la original", file=sys.stderr)
        return abs_url(src), (1200, 630)


# Política de devoluciones (Google: hasMerchantReturnPolicy). Venta a distancia en Argentina: 10 días de arrepentimiento
# desde que se recibe el producto (Ley 24.240, art. 34), con devolución por correo o en el local. Por esa ley, en el
# arrepentimiento los gastos de devolución corren por cuenta del vendedor: por eso FreeReturn. Condición de EXE: el producto
# vuelve completo, es el mismo que se envió y en las mismas condiciones (sin daños ni uso indebido). Se muestra en la página.
RETURN_POLICY = {"@type": "MerchantReturnPolicy", "applicableCountry": "AR",
                 "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow", "merchantReturnDays": 10,
                 "returnMethod": ["https://schema.org/ReturnByMail", "https://schema.org/ReturnInStore"],
                 "returnFees": "https://schema.org/FreeReturn"}


def wa_number():
    m = re.search(r'whatsappNumber:\s*"(\d+)"', (SITE / "assets/js/config.js").read_text())
    return m.group(1) if m else ""


def money(n):
    return "$ " + f"{int(round(n)):,}".replace(",", ".")


def rel(u):
    """Ruta de una foto vista desde site/p/<id>/"""
    return u if re.match(r"^https?://", u or "") else "../../" + (u or "").lstrip("./")


def visible(p):
    """Mismo criterio que la tienda: con precio cargado y sin ocultar por falta de stock"""
    if not (p.get("ask_price") or float(p.get("price") or 0) > 0):
        return False
    return not (p.get("hide_no_stock") and p.get("show_stock") and (p.get("stock") or 0) <= 0)


def page(p, wa):
    pid = p["id"]
    e = lambda s: html.escape(str(s or ""), quote=True)
    img, size = og_image(p)
    full = re.sub(r"\s+", " ", p.get("description") or "").strip()
    desc = full or f"{p.get('category') or 'Hardware'} {p.get('brand') or ''} en EXE. Consultá precio y stock por WhatsApp.".replace("  ", " ")
    if len(desc) > 160:
        desc = desc[:157].rsplit(" ", 1)[0] + "…"
    title = f"{p['name']} | EXE"
    url = f"{BASE}p/{pid}/"
    store = f"../../#producto/{pid}"
    price = 0 if p.get("ask_price") else float(p.get("price") or 0)
    imgs = p.get("images") or ([p["image"]] if p.get("image") else [])
    no_stock = not p.get("ask_stock") and p.get("show_stock") and (p.get("stock") or 0) <= 0
    # Datos estructurados (Google): producto con precio, disponibilidad y estado
    ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "sku": pid, "url": url,
          "image": [abs_url(u) for u in imgs[:5]] or [img]}
    if full:
        ld["description"] = full[:5000]
    if p.get("brand"):
        ld["brand"] = {"@type": "Brand", "name": p["brand"]}
    if p.get("category"):
        ld["category"] = p["category"]
    if price > 0:
        ld["offers"] = {"@type": "Offer", "url": url, "priceCurrency": "ARS", "price": round(price),
                        "availability": "https://schema.org/OutOfStock" if no_stock else "https://schema.org/InStock",
                        "itemCondition": "https://schema.org/UsedCondition" if p.get("outlet") else "https://schema.org/NewCondition",
                        "hasMerchantReturnPolicy": RETURN_POLICY,
                        "seller": {"@type": "Organization", "name": "EXE"}}
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE}] + (
        [{"@type": "ListItem", "position": 2, "name": p["category"], "item": f"{BASE}#productos"}] if p.get("category") else []) + [
        {"@type": "ListItem", "position": 3 if p.get("category") else 2, "name": p["name"], "item": url}]}
    jl = lambda o: json.dumps(o, ensure_ascii=False).replace("</", "<\\/")
    wa_msg = urllib.parse.quote(f"Hola EXE! Me interesa: {p['name']} ({url})")
    specs = "".join(
        f'<h3>{e(g.get("title") or "Especificaciones")}</h3><table>' + "".join(
            f"<tr><th>{e(k)}</th><td>{e(v)}</td></tr>" for k, v in (g.get("rows") or [])) + "</table>"
        for g in (p.get("specs") or []) if g.get("rows"))
    stock = ("Sin stock por ahora" if no_stock else
             f"{p['stock']} disponible{'s' if p['stock'] != 1 else ''}" if p.get("show_stock") and not p.get("ask_stock") and (p.get("stock") or 0) > 0 else "")
    first = ' fetchpriority="high"'
    gallery = "".join(f'<img src="{e(rel(u))}" alt="{e(p["name"])} — foto {i + 1}" loading="{"eager" if i == 0 else "lazy"}"{first if i == 0 else ""}>'
                      for i, u in enumerate(imgs[:8]))
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <link rel="canonical" href="{e(url)}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="EXE">
  <meta property="og:locale" content="es_AR">
  <meta property="og:title" content="{e(p['name'])}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{e(url)}">
  <meta property="og:image" content="{e(img)}">
  <meta property="og:image:width" content="{size[0]}">
  <meta property="og:image:height" content="{size[1]}">
  <meta property="og:image:alt" content="{e(p['name'])}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{e(p['name'])}">
  <meta name="twitter:description" content="{e(desc)}">
  <meta name="twitter:image" content="{e(img)}">
  <link rel="icon" href="../../assets/img/favicon.jpg" type="image/jpeg">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&amp;display=swap">
  <link rel="stylesheet" href="../../assets/css/styles.css">
  <script type="application/ld+json">{jl(ld)}</script>
  <script type="application/ld+json">{jl(crumbs)}</script>
  <style>
    .pp {{ max-width: 1100px; margin: 0 auto; padding: 24px 16px 56px; }}
    .pp-top {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; max-width: 1100px; margin: 0 auto; }}
    .pp-crumbs {{ font-size: .88rem; color: var(--muted); margin-bottom: 16px; }} .pp-crumbs a {{ color: inherit; }}
    .pp-grid {{ display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px; align-items: start; }}
    .pp-gal {{ display: grid; gap: 10px; grid-template-columns: repeat(4, 1fr); }}
    .pp-gal img {{ width: 100%; aspect-ratio: 1; object-fit: contain; background: var(--media-bg, #fff); border: 1px solid var(--line); border-radius: 10px; }}
    .pp-gal img:first-child {{ grid-column: 1 / -1; aspect-ratio: 450 / 402; }}
    .pp h1 {{ font-size: clamp(1.4rem, 3vw, 2rem); margin: 6px 0 12px; text-wrap: balance; }}
    .pp-brand {{ font-size: .8rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }}
    .pp-price {{ font-size: 2rem; font-weight: 700; color: var(--c2); margin: 8px 0 2px; }}
    .pp-meta {{ display: grid; gap: 4px; color: var(--muted); margin-bottom: 18px; }}
    .pp-acts {{ display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 24px; }}
    .pp-desc {{ line-height: 1.6; max-width: 65ch; }}
    .pp table {{ width: 100%; border-collapse: collapse; margin: 6px 0 18px; font-size: .92rem; }}
    .pp th, .pp td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }}
    .pp th {{ width: 42%; color: var(--muted); font-weight: 500; }}
    .pp h2 {{ font-size: 1.15rem; margin: 28px 0 8px; }} .pp h3 {{ font-size: 1rem; margin: 16px 0 4px; }}
    @media (max-width: 767px) {{ .pp-grid {{ grid-template-columns: 1fr; gap: 18px; }} }}
  </style>
</head>
<body>
  <header class="site-header"><div class="pp-top">
    <a href="../../" class="logo" aria-label="EXE inicio"><img class="logo-light" src="../../assets/img/logo.png" alt="EXE" width="106" height="55"><img class="logo-dark" src="../../assets/img/logo-oscuro.png" alt="EXE" width="106" height="55"></a>
    <a class="btn btn-outline" href="../../#productos">Ver toda la tienda</a>
  </div></header>
  <main class="pp">
    <nav class="pp-crumbs" aria-label="Ruta"><a href="../../">Inicio</a> › {f'<a href="../../#productos">{e(p["category"])}</a> › ' if p.get("category") else ""}{e(p["name"])}</nav>
    <div class="pp-grid">
      <div class="pp-gal">{gallery}</div>
      <div>
        {f'<span class="pp-brand">Marca: {e(p["brand"])}</span>' if p.get("brand") else ""}
        <h1>{e(p['name'])}</h1>
        <div class="pp-price">{money(price) if price > 0 else "Consultar precio"}</div>
        <div class="pp-meta">
          {"<span>Consultar precio final</span>" if price > 0 else ""}
          {f"<span>Estado: {e(p['condition'])}</span>" if p.get("condition") else ""}
          {"<span>Outlet: usado o reacondicionado, con garantía</span>" if p.get("outlet") else ""}
          {f"<span>{e(stock)}</span>" if stock else ""}
        </div>
        <div class="pp-acts">
          <a class="btn btn-primary" href="{e(store)}">{"Comprar en la tienda" if not no_stock else "Ver en la tienda"}</a>
          {f'<a class="btn btn-outline" href="https://wa.me/{wa}?text={wa_msg}" target="_blank" rel="noopener">Consultar por WhatsApp</a>' if wa else ""}
        </div>
        {f'<h2>Descripción</h2><p class="pp-desc">{e(full)}</p>' if full else ""}
      </div>
    </div>
    {f"<h2>Especificaciones</h2>{specs}" if specs else ""}
    <h2>Devoluciones</h2>
    <p class="pp-desc">Tenés 10 días desde que lo recibís para arrepentirte de la compra, y el envío de la devolución no tiene costo
      para vos. Lo podés devolver por correo o en persona. Para que la devolución sea aceptada, el producto tiene que ser el mismo
      que te enviamos, estar completo (con caja, accesorios y todo lo que incluía) y en las mismas condiciones en que lo recibiste,
      sin daños, golpes ni uso indebido. Para iniciarla, escribinos por WhatsApp.</p>
  </main>
</body>
</html>
"""


def sitemap(products):
    """sitemap.xml: la portada y una página por producto (Google no lee lo que va después del #)"""
    urls = [f"  <url><loc>{BASE}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>"]
    for p in products:
        lm = (p.get("updated_at") or "")[:10]
        last = f"<lastmod>{lm}</lastmod>" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", lm) else ""
        urls.append(f"  <url><loc>{BASE}p/{p['id']}/</loc>{last}<changefreq>weekly</changefreq><priority>0.8</priority></url>")
    (SITE / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n")


def main():
    products = [p for p in load_products() if safe_id(p.get("id")) and p.get("name") and visible(p)]
    wa = wa_number()
    if OUT.exists():
        shutil.rmtree(OUT)
    for p in products:
        d = OUT / p["id"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(p, wa))
    sitemap(products)
    print(f"{len(products)} páginas de producto en site/p/ y en sitemap.xml")


if __name__ == "__main__":
    main()
