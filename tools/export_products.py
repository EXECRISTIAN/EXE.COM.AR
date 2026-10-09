"""Regenera site/data/products.json (respaldo de la tienda si Supabase no responde).

Uso: guardar en un archivo el resultado JSON de
  select id,name,brand,category,description,price,price_usd,stock,show_stock,images,image,specs,outlet,condition,
         weight_kg,variants,tags,ask_price,ask_stock,cart_ok,hide_no_stock,active,sort
  from products order by sort, name;
y correr:  python3 tools/export_products.py <archivo.json>
Solo columnas públicas (las mismas que la tienda lee de la base). Nunca costos ni links de proveedores.
Mismo formato que fromDb() en site/assets/js/app.js.
"""
import json, sys
from pathlib import Path

rows = json.load(open(sys.argv[1]))
out = []
for r in rows:
    stock = r.get("stock") or 0
    ask_stock, cart_ok, show = bool(r.get("ask_stock")), r.get("cart_ok") is not False, bool(r.get("show_stock"))
    active = bool(r.get("active")) and not (r.get("hide_no_stock") and show and stock <= 0)
    p = {"id": r["id"], "name": r["name"], "brand": r.get("brand"), "category": r.get("category"),
         "description": r.get("description"), "price": 0 if r.get("ask_price") else float(r.get("price") or 0),
         "askStock": ask_stock, "cartOk": cart_ok, "noStock": not ask_stock and show and stock <= 0 and cart_ok}
    if not r.get("ask_price") and r.get("price_usd") is not None and float(r["price_usd"]) > 0:
        p["priceUsd"] = float(r["price_usd"])   # vendido en dólares: la tienda muestra US$
    if show and not ask_stock and not (stock <= 0 and cart_ok):
        p["stock"] = stock
    p["images"] = r.get("images") or ([r["image"]] if r.get("image") else [])
    if r.get("specs"): p["specs"] = r["specs"]
    p.update({"outlet": r.get("outlet"), "condition": r.get("condition"), "weightKg": float(r.get("weight_kg") or 1)})
    if r.get("variants"): p["variants"] = r["variants"]
    p["tags"] = r.get("tags") or []
    if p["price"] == int(p["price"]): p["price"] = int(p["price"])
    if p["weightKg"] == int(p["weightKg"]): p["weightKg"] = int(p["weightKg"])
    if not active: p["active"] = False
    out.append(p)

dest = Path(__file__).resolve().parent.parent / "site/data/products.json"
dest.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
missing = [i for p in out for i in p["images"] if not i.startswith("http") and not (dest.parent.parent / i).exists()]
print(f"{len(out)} productos ({sum(p.get('active', True) for p in out)} activos) -> {dest}")
if missing: print("FALTAN imágenes:", missing)
