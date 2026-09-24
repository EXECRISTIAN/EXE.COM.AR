# Qué se tomó del WordPress original

Fuente: backup del hosting en Google Drive (home de cPanel: `exe.com.ar/`, `Maildir/`, etc.).

## Diseño recuperado
| Origen (WordPress) | Destino |
|---|---|
| `uploads/elementor/css/post-4387.css` (portada 2024) | Estructura de `site/index.html` y `styles.css`: carrusel hero, 3 banners de marca (min-height 500, radius 20, botón outline blanco con fondo `#0000007a` y hover oscuro), sección de marcas con separador 28 %, banner inferior (radius 25), 3 cajas de beneficios, carrusel de logos |
| Breakpoints Elementor 1024 / 767 px | Media queries iguales |
| `uploads/2024/05/login-exe.com_.ar-*.jpg` | `site/assets/img/hero-01/02.webp` |
| `uploads/2024/05/banner-marca-01..03.jpg` | `site/assets/img/banner-marca-0X.webp` |
| `uploads/2024/05/banner-inferior-01.jpg` | `site/assets/img/banner-inferior-01.webp` |
| `uploads/fonts/*.woff2` (Montserrat, Inter, etc.) | Google Fonts Montserrat + Inter |
| Animaciones de entrada / fondo fijo de Elementor | `.reveal` + IntersectionObserver en `app.js` (respeta "reducir movimiento") |

Todas las imágenes pasaron a WebP: ~1,3 MB → ~270 KB.

## Pendiente (falta la base de datos del WordPress)
El backup **no incluye el volcado SQL**, que es donde WordPress guarda textos, productos, precios, menús y los colores exactos de Astra. Por eso:
- Los **colores** son una paleta oscura acorde a los banners (variables `--c0…--c7` en `styles.css`, fáciles de cambiar).
- Los **textos** institucionales son provisorios.
- Los **productos** de `products.json` son los que se identificaron por las fotos del backup, con precio 0 = "Consultar".
- Las **fotos de productos** y el **logo** (`uploads/2024/05/logo-b.png`, `logo-3.png`) hay que copiarlos a `site/assets/img/products/` y `site/assets/img/`.

Con un export `.sql` (phpMyAdmin > Exportar) se completa todo lo anterior automáticamente.

## Descartado (no hace falta en un sitio estático)
Elementor, Essential Addons, Otter, Spectra, Astra, LiteSpeed Cache, UpdraftPlus, Akismet, WPS Hide Login, Admin Custom Login, White Label CMS, LightStart, Code Snippets, Query Monitor, WPForms, WP Mail SMTP, YayCurrency, CartFlows, Cart Abandonment, Variation Swatches, Google/Reddit for WooCommerce. Las funciones que sí importan se reemplazaron según `ARQUITECTURA.md`.
