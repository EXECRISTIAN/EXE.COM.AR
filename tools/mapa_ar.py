"""Genera site/assets/js/mapa-ar.js: mapa de Argentina por provincia (SVG) para Panel → Analítica.

Fuente: Natural Earth 1:10m admin-1 (dominio público), https://www.naturalearthdata.com
Uso: python3 tools/mapa_ar.py ne_10m_admin_1_states_provinces.geojson
Incluye las Islas Malvinas como parte de Tierra del Fuego.
"""
import json, math, sys

SRC = sys.argv[1]
OUT = "site/assets/js/mapa-ar.js"
NAMES = {"Ciudad de Buenos Aires": "CABA"}
TOL = 0.035          # tolerancia de simplificación (grados)
W = 420              # ancho del dibujo en px de SVG
K = math.cos(math.radians(38))


def dp(pts, tol):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy) or 1e-12
    imax, dmax = 0, -1
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L if L > 1e-12 else math.hypot(x - x1, y - y1)
        if d > dmax:
            imax, dmax = i, d
    if dmax > tol:
        return dp(pts[: imax + 1], tol)[:-1] + dp(pts[imax:], tol)
    return [pts[0], pts[-1]]


def rings(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [poly[0] for poly in polys]   # solo el borde exterior


data = json.load(open(SRC))
feats = {}
for f in data["features"]:
    p = f["properties"]
    if p["adm0_a3"] == "ARG":
        feats.setdefault(NAMES.get(p["name"], p["name"]), []).extend(rings(f["geometry"]))
    elif p["adm0_a3"] == "FLK":
        feats.setdefault("Tierra del Fuego", []).extend(rings(f["geometry"]))

allp = [(x * K, -y) for rs in feats.values() for r in rs for x, y in r]
minx, maxx = min(p[0] for p in allp), max(p[0] for p in allp)
miny, maxy = min(p[1] for p in allp), max(p[1] for p in allp)
s = W / (maxx - minx)
H = round((maxy - miny) * s)
P = lambda x, y: ((x * K - minx) * s, (-y - miny) * s)

paths, labels = {}, {}
for name, rs in feats.items():
    parts, best = [], None
    for r in rs:
        tol = TOL / 4 if name == "CABA" else TOL
        q = dp([tuple(pt) for pt in r], tol)
        area = abs(sum(q[i][0] * q[i - 1][1] - q[i - 1][0] * q[i][1] for i in range(len(q)))) / 2
        if name != "CABA" and area < 0.004:      # islotes chicos fuera
            continue
        pts = [P(x, y) for x, y in q]
        parts.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z")
        if best is None or area > best[0]:
            # centroide del polígono (por área), no el promedio de puntos
            A2 = cx = cy = 0.0
            for i in range(len(pts)):
                (x0, y0), (x1, y1) = pts[i - 1], pts[i]
                c = x0 * y1 - x1 * y0
                A2 += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
            cx, cy = (cx / (3 * A2), cy / (3 * A2)) if A2 else (pts[0][0], pts[0][1])
            best = (area, cx, cy)
    paths[name] = "".join(parts)
    labels[name] = [round(best[1], 1), round(best[2], 1)]

js = ("// Generado por tools/mapa_ar.py desde Natural Earth (dominio público). No editar a mano.\n"
      f"window.EXE_MAPA_AR = {json.dumps({'w': W, 'h': H, 'paths': paths, 'labels': labels}, ensure_ascii=False, separators=(',', ':'))};\n")
open(OUT, "w").write(js)
print(OUT, len(js), "bytes", W, "x", H)
