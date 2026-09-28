"""Descarga la foto principal (og:image) de la página oficial de cada producto, la pasa a fondo blanco,
800x800 WebP, y deja un reporte. Lo corre la Action .github/workflows/fetch-images.yml (el entorno de
desarrollo no tiene salida a internet). Entrada: tools/images.json  [{id, page?, img?}]"""
import json, re, subprocess, sys, urllib.request, urllib.parse, pathlib

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
OUT = pathlib.Path("site/assets/img/products")
PROXY = "https://tmp-exe-img.execomar.workers.dev/?u="   # Worker temporal (solo dominios de fabricantes) por si el sitio bloquea a GitHub
def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es-AR,es;q=0.9,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()
def get(url):
    try:
        return _get(url)
    except Exception:
        return _get(PROXY + urllib.parse.quote(url, safe=""))
def og_image(page):
    html = get(page).decode("utf-8", "ignore")
    for pat in (r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)',
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image',
                r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)'):
        m = re.search(pat, html, re.I)
        if m: return urllib.parse.urljoin(page, m.group(1).replace("&amp;", "&"))
    # sin og:image: primera imagen de producto grande de la página
    for m in re.finditer(r'<img[^>]+(?:data-src|src)=["\']([^"\']+\.(?:jpe?g|png|webp)[^"\']*)', html, re.I):
        u = m.group(1)
        if re.search(r"product|catalog|image/cache|gallery|upload", u, re.I) and not re.search(r"logo|icon|banner|sprite", u, re.I):
            return urllib.parse.urljoin(page, u.replace("&amp;", "&"))
    return None
def corners_white(path):
    # promedio de brillo de las 4 esquinas (0-255)
    out = subprocess.run(["convert", path, "-resize", "20x20!", "-colorspace", "Gray", "txt:-"], capture_output=True, text=True).stdout
    vals = [int(m) for m in re.findall(r"gray\((\d+)", out)] or [int(float(m) * 2.55) for m in re.findall(r"gray\(([\d.]+)%", out)]
    if len(vals) < 400: return None
    c = [vals[0], vals[19], vals[380], vals[399]]
    return sum(c) / 4
report = []
for it in json.load(open("tools/images.json")):
    pid, src = it["id"], it.get("img")
    try:
        if not src: src = og_image(it["page"])
        if not src: raise RuntimeError("sin og:image")
        raw = pathlib.Path("/tmp") / (pid + ".src")
        raw.write_bytes(get(src))
        dst = OUT / f"{pid}.webp"
        subprocess.run(["convert", str(raw), "-background", "white", "-alpha", "remove", "-alpha", "off", "-trim", "+repage",
                        "-resize", "720x720", "-gravity", "center", "-extent", "800x800", "-quality", "82", str(dst)], check=True)
        report.append({"id": pid, "ok": True, "src": src, "kb": round(dst.stat().st_size / 1024), "corners": corners_white(str(raw))})
    except Exception as e:
        report.append({"id": pid, "ok": False, "src": src, "error": str(e)[:200]})
json.dump(report, open("tools/images-report.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps(report, indent=1, ensure_ascii=False))
