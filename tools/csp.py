#!/usr/bin/env python3
"""Política de seguridad (CSP) de las páginas del sitio.

Cada página HTML de site/ lleva un <meta http-equiv="Content-Security-Policy"> que solo deja
correr JavaScript de archivos propios del sitio (más los scripts chicos escritos dentro del HTML,
identificados por su huella sha256). Así, si alguien lograra meter código en la página
(por ejemplo con un nombre de producto o de cliente malicioso), el navegador no lo ejecuta.

Uso:
  python3 tools/csp.py          # verifica (lo corre el deploy; falla si algo no coincide)
  python3 tools/csp.py --fix    # recalcula las huellas después de editar un <script> dentro del HTML
"""
import base64
import hashlib
import pathlib
import re
import sys

SITE = pathlib.Path(__file__).resolve().parent.parent / "site"
# Orígenes externos de scripts permitidos por página (además de 'self').
EXTRA = {"cuenta.html": ["https://challenges.cloudflare.com"]}  # Turnstile (anti-bots del registro)
META_RE = re.compile(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">')
INLINE_RE = re.compile(r"<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>", re.S)


def policy(page: pathlib.Path, html: str) -> str:
    hashes = []
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)  # los comentarios no cuentan
    for attrs, body in INLINE_RE.findall(html):
        m = re.search(r'type="([^"]+)"', attrs)
        if m and m.group(1) not in ("text/javascript", "module"):
            continue  # bloques de datos (ej. application/ld+json) no se ejecutan
        digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        hashes.append(f"'sha256-{digest}'")
    script = " ".join(["'self'", *hashes, *EXTRA.get(page.name, [])])
    return (f'<meta http-equiv="Content-Security-Policy" content="script-src {script}; '
            "object-src 'none'; base-uri 'self'; form-action 'self'\">")


def main() -> int:
    fix = "--fix" in sys.argv
    bad = 0
    for page in sorted(SITE.rglob("*.html")):
        html = page.read_text(encoding="utf-8")
        want = policy(page, html)
        found = META_RE.findall(html)
        name = page.relative_to(SITE)
        if len(found) != 1:
            print(f"✗ {name}: tiene {len(found)} metas CSP (tiene que tener exactamente 1)")
            bad += 1
            continue
        if found[0] == want:
            print(f"✓ {name}")
        elif fix:
            page.write_text(html.replace(found[0], want), encoding="utf-8")
            print(f"✎ {name}: CSP actualizada")
        else:
            print(f"✗ {name}: la CSP no coincide con los <script> de la página (correr tools/csp.py --fix)")
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
