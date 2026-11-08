"""Páginas de vista previa para compartir productos: site/p/<id>/index.html

Facebook, WhatsApp, Telegram, etc. no leen lo que va después del # ni ejecutan JavaScript, así que un link
https://exe.com.ar/#producto/<id> siempre mostraba la imagen general de la web. Este script crea, por cada
producto activo, una página mínima con título, descripción y FOTO DEL PRODUCTO (etiquetas og:/twitter:) que
redirige al instante a la ficha en la tienda. La tienda comparte ese link (https://exe.com.ar/p/<id>/).

Corre en cada deploy (pages.yml) y de forma programada, así cubre los productos que se agreguen después.
Lee los productos públicos de Supabase (misma clave pública que usa la web); si no responde, usa
site/data/products.json. Solo datos públicos: nombre, descripción, marca y fotos.
"""
import html, json, re, shutil, sys, urllib.request
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
            f"{url}/rest/v1/products?select=id,name,brand,category,description,images,image&active=eq.true",
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


def page(p):
    pid = p["id"]
    e = lambda s: html.escape(str(s or ""), quote=True)
    img, size = og_image(p)
    desc = re.sub(r"\s+", " ", p.get("description") or "").strip()
    if not desc:
        desc = f"{p.get('category') or 'Hardware'} {p.get('brand') or ''} en EXE. Consultá precio y stock por WhatsApp.".replace("  ", " ")
    if len(desc) > 200:
        desc = desc[:197].rsplit(" ", 1)[0] + "…"
    title = f"{p['name']} | EXE"
    url = f"{BASE}p/{pid}/"
    target = f"../../#producto/{pid}"
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <meta name="robots" content="noindex, follow">
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
  <script src="../../assets/js/go.js"></script>
</head>
<body>
  <p><a href="{e(target)}">Ver {e(p['name'])} en EXE</a></p>
</body>
</html>
"""


def main():
    products = [p for p in load_products() if safe_id(p.get("id")) and p.get("name")]
    if OUT.exists():
        shutil.rmtree(OUT)
    for p in products:
        d = OUT / p["id"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(p))
    print(f"{len(products)} páginas de vista previa en site/p/")


if __name__ == "__main__":
    main()
