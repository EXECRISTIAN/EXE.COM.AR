"""Genera miniaturas livianas (<nombre>-t.webp, 480 px de ancho) de las fotos de productos para las tarjetas de la tienda.
La foto completa se sigue usando en la ficha del producto. Correr después de agregar fotos nuevas al repo:
  python3 tools/miniaturas.py
Las fotos que se suben desde el panel generan su miniatura solas (admin-productos.js)."""
import pathlib
from PIL import Image

DIR = pathlib.Path(__file__).resolve().parent.parent / "site/assets/img/products"
W = 480
n = 0
for f in sorted(DIR.rglob("*.webp")):
    if f.stem.endswith("-t"):
        continue
    out = f.with_name(f.stem + "-t.webp")
    if out.exists() and out.stat().st_mtime >= f.stat().st_mtime:
        continue
    im = Image.open(f)
    if im.width > W:
        im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    im.save(out, "WEBP", quality=78, method=6)
    n += 1
print(f"{n} miniaturas nuevas")
