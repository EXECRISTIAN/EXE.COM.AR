# Decisiones tomadas por Claude

Registro de lo que decidí sin consultarte, para que puedas revisarlo o cambiarlo. Cada punto dice **qué**, **por qué** y **cómo cambiarlo**.

## Proyecto y repositorios
1. **Todo el proyecto vive en el repo `exe.com.ar`**, separado de CentralControlHub. Cerré el PR que había abierto por error en CentralControlHub.
   - La rama `claude/wizardly-galileo-epqkju` de CentralControlHub **no se pudo borrar** (el sistema bloqueó la acción). Borrala desde GitHub: *Branches → papelera* si querés.
2. **Estructura**: `site/` (lo que se publica), `supabase/` (backend), `docs/`. El sitio se publica desde `site/` con GitHub Actions.
3. **Sin herramientas de compilación** (HTML/CSS/JS puros): se edita directo, no hay que instalar nada y no se rompe con actualizaciones. Si más adelante crece mucho, se puede pasar a Astro.

## Diseño (réplica de WordPress)
4. **Fuente de verdad del diseño**: `uploads/elementor/css/post-4387.css` (portada 2024). Las medidas de `styles.css` están copiadas de ahí y comentadas con el id del elemento original (ej. `9986b28`).
5. **Tema claro**: el original tenía fondo `#ffffff`, secciones `color4` y títulos `#383838`. En la primera versión lo había hecho oscuro; lo corregí.
6. **Colores**: la paleta exacta de Astra está en la base de datos (que no está en el backup). Usé la **paleta por defecto de Astra** (`#046bd2`, `#1e293b`, `#f0f5fa`…), que es la que usan las plantillas cuando no se cambió. Cambiar: variables `--c0…--c7` al inicio de `site/assets/css/styles.css`.
7. **Tipografías**: Montserrat (títulos) + Inter (texto). Ambas estaban descargadas en `uploads/fonts`; no se sabe cuál usaba exactamente cada parte. Cambiar: `--font` y `--font-head` en `styles.css` y el link de Google Fonts en los HTML.
8. **Carrusel principal**: solo imágenes (como el widget "image carousel" original), con flechas, puntos, autoplay de 5 s y deslizamiento con el dedo. Imágenes: `login-exe.com_.ar-*.jpg` del backup.
9. **Banners de marca**: 3 tarjetas con el botón "Ver más" (texto elegido por mí; el real está en la base). En celular usan las imágenes `cel-300x300-*` y en tablet `banner-tablet-01`, igual que el original. Cada botón filtra el catálogo por categoría.
10. **Textos**: títulos y párrafos ("Productos", "Las mejores marcas", beneficios, contacto) son provisorios — los reales están en la base de datos.
11. **Beneficios** (envíos, garantía, pagos): íconos SVG propios porque las imágenes originales de esas cajas no se identificaron.
12. **Carrusel de logos**: 6 logos reales del backup (NVIDIA, AMD, Western Digital, ROG, Intel, HyperX), en gris y a color al pasar el mouse.
13. **Header**: logo negro `logo-3.png`; footer oscuro con `logo-b.png` (blanco).
14. **Animaciones**: aparición al hacer scroll, zoom en banners, segunda foto del producto al pasar el mouse, brillo en el banner ancho, header que se achica. Se desactivan si el sistema tiene "reducir movimiento".
15. **Imágenes**: convertidas a WebP (≈800 KB en total). Recuperadas del Drive exportando un Google Doc temporal (`exe-img-bundle`, `exe-img-test` en tu carpeta de Drive — se pueden borrar).

## Tienda
16. **Productos cargados** (10), identificados por las fotos del backup: Intel Core i5, Intel Core i7, AMD Ryzen 7, AMD Ryzen 5, Motherboard ASUS Prime, Placa MSI GeForce GTX Ventus XS (el archivo decía "rtx1660-asus" pero la foto es MSI), Gabinete Antec NX200M, Fuente Aerocool Cylon 600W, Memoria T-Force Delta, Cooler DeepCool AG400. Cambiar: `site/data/products.json`.
17. **Precios en 0 = "Consultar"** (no había precios en el backup).
18. **Stock de ejemplo** (números inventados para mostrar cómo funciona; el cooler en 0 para mostrar "Sin stock"). La placa MSI tiene `showStock: false` como ejemplo de stock oculto.
19. **Carrito → WhatsApp** con número de ejemplo `5490000000000`. Cambiar en `site/assets/js/config.js`.
20. **Al agregar al carrito** se muestra un aviso en vez de abrir el carrito, para poder seguir comprando.

## Usuarios, seguridad y backend
21. **Supabase** (gratis) para usuarios/base de datos, **Resend** para emails y **Mercado Pago** para pagos. Todo preparado en `supabase/`, sin activar hasta que crees las cuentas.
22. **Roles base**: administrador (todo), moderador (pedidos + stock), suscriptor (cliente). Permisos separados para "marcar pagado" y "cambiar estado".
23. **Pedidos**: el navegador no puede crearlos ni modificarlos directamente; los precios los pone la base y "pagado" solo lo marca el webhook de Mercado Pago o un permiso específico, con auditoría.
24. **Panel**: `/admin/` (vista previa en `/admin/?demo=1`).
