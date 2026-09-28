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
    # brillo promedio de las 4 esquinas (0-255); 255 = blanco puro
    from PIL import Image
    im = Image.open(path).convert("L").resize((40, 40))
    px = [im.getpixel((x, y)) for x in (0, 1, 38, 39) for y in (0, 1, 38, 39)]
    return sum(px) / len(px)
PREFER = re.compile(r"(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|c1\.neweggimages\.com|neweggimages\.com|bhphotovideo\.com/images)", re.I)
def bing_candidates(q):
    html = _get("https://www.bing.com/images/search?form=HDRSC2&first=1&qft=+filterui:color2-FGcls_WHITE&q=" + urllib.parse.quote(q)).decode("utf-8", "ignore")
    urls = [urllib.parse.unquote(u).replace("&amp;", "&") for u in re.findall(r'murl&quot;:&quot;(.*?)&quot;', html)]
    bad = re.compile(r"pinterest|pinimg|youtube|ytimg|facebook|fbcdn|instagram|tiktok|reddit|redd\.it|wikia|aliexpress|alicdn", re.I)
    urls = [u for u in urls if u.startswith("https://") and not bad.search(u)]
    return (sorted(urls, key=lambda u: 0 if PREFER.search(u) else 1))[:10]   # primero Amazon/Newegg
def candidates_mode(items):
    """Baja hasta 4 fotos candidatas por producto (sin exigir fondo blanco) para elegir a mano."""
    out = pathlib.Path("tools/candidatas"); out.mkdir(exist_ok=True)
    rep = []
    for it in items:
        html = _get("https://www.bing.com/images/search?form=HDRSC2&first=1&q=" + urllib.parse.quote(it["q"])).decode("utf-8", "ignore")
        urls = [urllib.parse.unquote(u).replace("&amp;", "&") for u in re.findall(r'murl&quot;:&quot;(.*?)&quot;', html)]
        bad = re.compile(r"pinterest|pinimg|youtube|ytimg|facebook|fbcdn|instagram|tiktok|reddit|redd\\.it|aliexpress|alicdn|wallpaper|shutterstock|alamy|dreamstime|123rf|istock|gettyimages|depositphotos", re.I)
        urls = [u for u in urls if u.startswith("http") and not bad.search(u)]
        got = []
        for u in urls:
            if len(got) >= 4: break
            try:
                raw = pathlib.Path("/tmp") / "c.src"; raw.write_bytes(_get(u))
                dst = out / f"{it['id']}-{len(got)}.webp"
                subprocess.run(["convert", str(raw) + "[0]", "-background", "white", "-alpha", "remove", "-alpha", "off", "-resize", "800x800>", "-quality", "82", str(dst)], check=True, timeout=60)
                if dst.stat().st_size < 6000: dst.unlink(); continue
                got.append({"file": dst.name, "src": u})
            except Exception: pass
        rep.append({"id": it["id"], "n": len(got), "cands": got, "found": len(urls)})
    json.dump(rep, open("tools/candidatas/report.json", "w"), indent=1)
    print(json.dumps(rep, indent=1))
items_all = json.load(open("tools/images.json"))
if items_all and items_all[0].get("mode") == "candidatas":
    candidates_mode(items_all[1:]); sys.exit(0)
report = []
for it in json.load(open("tools/images.json")):
    pid, src = it["id"], it.get("img")
    try:
        raw = pathlib.Path("/tmp") / (pid + ".src")
        if it.get("q"):   # búsqueda: primera foto de Amazon/Newegg con fondo blanco
            src = None
            cands = bing_candidates(it["q"]); it["cands"] = len(cands)
            for cand in cands:
                try:
                    raw.write_bytes(_get(cand)); w = corners_white(str(raw))
                    if w is not None and w > 240: src = cand; break
                except Exception: pass
            if not src: raise RuntimeError(f"sin foto de fondo blanco ({it['cands']} candidatas)")
        else:
            if not src: src = og_image(it["page"])
            if not src: raise RuntimeError("sin og:image")
            raw.write_bytes(get(src))
        dst = OUT / f"{pid}.webp"
        subprocess.run(["convert", str(raw), "-background", "white", "-alpha", "remove", "-alpha", "off", "-trim", "+repage",
                        "-resize", "720x720", "-gravity", "center", "-extent", "800x800", "-quality", "82", str(dst)], check=True)
        report.append({"id": pid, "ok": True, "src": src, "kb": round(dst.stat().st_size / 1024), "corners": corners_white(str(raw))})
    except Exception as e:
        report.append({"id": pid, "ok": False, "src": src, "error": str(e)[:200]})
json.dump(report, open("tools/images-report.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps(report, indent=1, ensure_ascii=False))
