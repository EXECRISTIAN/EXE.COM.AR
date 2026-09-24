# exe.com.ar

Tienda de hardware y componentes de PC. Migración del WordPress/WooCommerce original a un sitio estático alojado gratis en GitHub Pages, con backend opcional en Supabase.

## Estructura

```
exe.com.ar/
├── site/                     ← TODO lo que se publica en la web
│   ├── index.html            Tienda: hero, banners, catálogo, marcas, contacto
│   ├── cuenta.html           Login / registro / mis pedidos
│   ├── admin/index.html      Panel de administración (por permisos)
│   ├── data/products.json    Catálogo (mientras no esté Supabase)
│   └── assets/
│       ├── css/              styles.css (sitio) · panel.css (cuenta + panel)
│       ├── js/               config.js · app.js · backend.js · cuenta.js · admin.js
│       └── img/              imágenes del sitio (+ products/ para fotos de productos)
├── supabase/
│   ├── migrations/0001_schema.sql   Usuarios, roles, permisos, productos, stock, pedidos, seguridad
│   └── functions/                   mp-webhook (pagos) · send-email (emails automáticos)
├── docs/                     ARQUITECTURA · ROLES-Y-PERMISOS · MIGRACION-WORDPRESS · DECISIONES
└── .github/workflows/pages.yml      Publica site/ en GitHub Pages en cada push a main
```

## Uso rápido
- **WhatsApp, email, marcas, mostrar stock**: `site/assets/js/config.js`
- **Productos, precios y stock**: `site/data/products.json` (`price: 0` = "Consultar"; `stock` opcional; `showStock` opcional)
- **Colores**: variables `--c0` … `--c7` al inicio de `site/assets/css/styles.css`
- **Probar en local**: `cd site && python3 -m http.server 8000` → http://localhost:8000
- **Ver el panel sin backend**: http://localhost:8000/admin/?demo=1

## Publicar gratis
1. Settings → Pages → Source: **GitHub Actions**.
2. Custom domain: `exe.com.ar`; en el DNS del dominio apuntar registros A a GitHub Pages y `www` (CNAME) a `execristian.github.io`.

Más detalle en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
- `docs/ANDREANI.md`: envíos con Andreani.
