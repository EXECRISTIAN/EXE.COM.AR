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


GUARD_RE = re.compile(r'<script src="(?:\.\./)*assets/js/guard\.js"></script>')


def add_guard(page: pathlib.Path, html: str) -> str:
    """Agrega guard.js como primer script del <head> (después de la CSP o del <base> de la 404)."""
    depth = len(page.relative_to(SITE).parts) - 1
    tag = f'  <script src="{"../" * depth}assets/js/guard.js"></script>\n'
    base = re.search(r"<script>document\.write\('<base[^\n]*\n", html)
    anchor = base or META_RE.search(html)
    pos = html.index("\n", anchor.end() - 1) + 1 if anchor else html.index("<head>") + len("<head>\n")
    return html[:pos] + tag + html[pos:]


def main() -> int:
    # --fix agrega lo que falte en páginas nuevas (CSP y bloqueo del modo desarrollador) y recalcula
    # las huellas. El deploy lo corre siempre, así cualquier página que se sume queda protegida sola.
    fix = "--fix" in sys.argv
    bad = 0
    for page in sorted(SITE.rglob("*.html")):
        html = page.read_text(encoding="utf-8")
        name = page.relative_to(SITE)
        found = META_RE.findall(html)
        if not found and fix and "<head>" in html:
            m = re.search(r"<meta charset=[^>]*>\n?", html) or re.search(r"<head>\n?", html)
            html = html[:m.end()] + '  <meta http-equiv="Content-Security-Policy" content="">\n' + html[m.end():]
            found = META_RE.findall(html)
            print(f"✎ {name}: CSP agregada")
        if len(found) != 1:
            print(f"✗ {name}: tiene {len(found)} metas CSP (tiene que tener exactamente 1)")
            bad += 1
            continue
        if not GUARD_RE.search(html.split("</head>", 1)[0]):
            if fix:
                html = add_guard(page, html)
                print(f"✎ {name}: bloqueo del modo desarrollador agregado")
            else:
                print(f"✗ {name}: falta assets/js/guard.js en el <head> (correr tools/csp.py --fix)")
                bad += 1
        want = policy(page, html)
        found = META_RE.findall(html)
        if found[0] != want:
            if fix:
                html = html.replace(found[0], want)
                print(f"✎ {name}: CSP actualizada")
            else:
                print(f"✗ {name}: la CSP no coincide con los <script> de la página (correr tools/csp.py --fix)")
                bad += 1
        if fix:
            page.write_text(html, encoding="utf-8")
        print(f"✓ {name}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
