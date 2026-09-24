# Qué se tomó del WordPress original

Fuente: backup del hosting en Google Drive (home de cPanel: `exe.com.ar/`, `Maildir/`, etc.).

## Diseño recuperado
| Origen (WordPress) | Destino |
|---|---|
| `uploads/elementor/css/post-4387.css` (portada 2024) | `site/index.html` + `styles.css` con las mismas medidas (ids de Elementor comentados) |
| Breakpoints Elementor 1024 / 767 px | Media queries iguales |
| `uploads/2024/05/login-exe.com_.ar-*.jpg` | `assets/img/login-bg-01/02.webp` (fondo del login) |
| Banners ASUS "Series 500 y 400" y "Z790" (enviados aparte) | `assets/img/hero-01/02.webp` (carrusel principal) |
| `banner-marca-01..03`, `cel-300x300-01/02`, `banner-tablet-01` | Banners de marca (escritorio / celular / tablet) |
| `banner-inferior-01.jpg` | Banner ancho de la sección de marcas |
| `imagen_marca_*` | `assets/img/marcas/` (carrusel de logos) |
| `producto-*`, `EXE.COM_.AR-*`, `exe.com_.ar-*` | `assets/img/products/` (40 fotos originales) |
| `logo-3.png`, `logo-b.png`, `favico.jpg` | Logo del header, del footer y favicon |

Todas las imágenes están en WebP (≈800 KB en total).

## Pendiente (falta la base de datos del WordPress)
El backup **no incluye el volcado SQL**, donde WordPress guarda textos, precios, menús y los colores exactos de Astra. Ver `DECISIONES.md` para lo que se completó provisoriamente. Con un export `.sql` (phpMyAdmin → Exportar) se reemplaza todo por los valores reales.

## Descartado (no hace falta en un sitio estático)
Elementor, Essential Addons, Otter, Spectra, Astra, LiteSpeed Cache, UpdraftPlus, Akismet, WPS Hide Login, Admin Custom Login, White Label CMS, LightStart, Code Snippets, Query Monitor, WPForms, WP Mail SMTP, YayCurrency, CartFlows, Cart Abandonment, Variation Swatches, Google/Reddit for WooCommerce. Las funciones que sí importan se reemplazaron según `ARQUITECTURA.md`.
