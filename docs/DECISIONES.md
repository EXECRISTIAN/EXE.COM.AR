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
8. **Carrusel principal**: solo imágenes, con flechas, puntos, autoplay de 5 s y deslizamiento. Imágenes: banners ASUS "Series 500 y 400" y "Z790" (1904×650) que pasaste vos. Las fotos `login-exe.com_.ar-*` del backup quedaron como fondo del login (`login-bg-01/02.webp`), y se pueden reusar en la pantalla de pago.
9. **Banners de marca**: 3 tarjetas con el botón "Ver más" (texto elegido por mí; el real está en la base). En celular usan las imágenes `cel-300x300-*` y en tablet `banner-tablet-01`, igual que el original. Cada botón filtra el catálogo por categoría.
10. **Textos**: ya son los reales de la portada de WordPress (exportación XML del 26/09/2026): "Productos destacados", botones "Placas de video" / "Monitores" / "Motherboards" y los beneficios "Envios a todo el País", "Los mejores precios", "Pagos Seguros". Se quitó el título inventado "Las mejores marcas". Siguen siendo míos: el texto bajo "Productos destacados" (explica el pedido por WhatsApp), la tarjeta de contacto y el footer.
11. **Beneficios** (envíos, garantía, pagos): íconos SVG propios porque las imágenes originales de esas cajas no se identificaron.
12. **Carrusel de logos**: 6 logos reales del backup (NVIDIA, AMD, Western Digital, ROG, Intel, HyperX), en gris y a color al pasar el mouse.
13. **Header**: logo negro `logo-3.png`; footer oscuro con `logo-b.png` (blanco). Medidas copiadas de la portada original (medidas sobre tu captura): **80 px de alto**, contenido centrado de ~820 px, menú pegado al logo e íconos a la derecha. En modo oscuro el header queda negro con el logo blanco, como el original.
    - **Banner principal**: todo el ancho, con la proporción del original (**1904×540**). Tus imágenes miden 1904×650, así que se recorta la franja vacía de arriba (queda anclada abajo) y el contenido queda igual que en la página de WordPress. Cambiar: `.hero-slide img` en `styles.css`.
14. **Animaciones**: aparición al hacer scroll, zoom en banners, segunda foto del producto al pasar el mouse, brillo en el banner ancho, header que se achica. Se desactivan si el sistema tiene "reducir movimiento".
15. **Imágenes**: convertidas a WebP (≈800 KB en total). Recuperadas del Drive exportando un Google Doc temporal (`exe-img-bundle`, `exe-img-test` en tu carpeta de Drive — se pueden borrar).

## Tienda
16. **Productos cargados** (10), identificados por las fotos del backup: Intel Core i5, Intel Core i7, AMD Ryzen 7, AMD Ryzen 5, Motherboard ASUS Prime, Placa MSI GeForce GTX Ventus XS (el archivo decía "rtx1660-asus" pero la foto es MSI), Gabinete Antec NX200M, Fuente Aerocool Cylon 600W, Memoria T-Force Delta, Cooler DeepCool AG400. Cambiar: `site/data/products.json`.
17. **Precios reales** de WooCommerce (exportación XML). Un precio en 0 se sigue mostrando como "Consultar".
18. **Stock real**: en WordPress solo la placa MSI GTX 1650 tenía stock controlado (10 unidades); los demás figuraban "en stock" sin cantidad, así que no muestran número. Se quitaron los números de ejemplo para no mostrar datos falsos. La memoria T-Force se publica solo en Black, como en WordPress.
19. **Carrito → WhatsApp** al número 11 3009-5254 (formato internacional `5491130095254`). Cambiar en `site/assets/js/config.js`.
20. **Al agregar al carrito** se muestra un aviso en vez de abrir el carrito, para poder seguir comprando.

## Usuarios, seguridad y backend
21. **Supabase** (gratis) para usuarios/base de datos, **Resend** para emails y **Mercado Pago** para pagos. Todo preparado en `supabase/`, sin activar hasta que crees las cuentas.
22. **Roles base**: administrador (todo), moderador (pedidos + stock), suscriptor (cliente). Permisos separados para "marcar pagado" y "cambiar estado".
23. **Pedidos**: el navegador no puede crearlos ni modificarlos directamente; los precios los pone la base y "pagado" solo lo marca el webhook de Mercado Pago o un permiso específico, con auditoría.
24. **Panel**: `/admin/` (vista previa en `/admin/?demo=1`).

## Envíos (Envia.com)
25. **Envia.com en lugar de Andreani directo** (pedido tuyo): una sola cuenta cotiza y genera guías de varios transportistas. Todo pasa por la Edge Function `supabase/functions/envios` porque el token no puede estar en un sitio público. Detalle en `docs/ENVIOS.md`. Se eliminó la integración directa con Andreani.
26. **Cotización en el carrito, apagada por defecto** (`shipping.enabled: false` en `config.js`). Muestra todas las opciones ordenadas por precio; la elegida va en el WhatsApp como "estimada".
27. **Crear envío solo con pedido pagado** y permiso `shipping.manage` (administrador y moderador). Evita generar guías (que cuestan saldo) para pedidos falsos.
28. **Peso por defecto 1 kg y caja 30×20×15 cm** por producto hasta que cargues los reales. Cambiar en la tabla `products`.
29. **Transportistas a cotizar**: se eligen con el secret `ENVIA_CARRIERS` (sugerido: `andreani,correo-argentino,oca`).

## Modo claro / oscuro
30. **Selector de 3 posiciones al pie de la página** (Claro · Automático · Oscuro), deslizante, junto al copyright. "Automático" sigue la configuración del sistema; es el valor por defecto.
31. **Se recuerda la elección** en el navegador del visitante (`localStorage`), y se aplica en todas las páginas (tienda, Mi cuenta y panel) antes de dibujar, para que no parpadee.
32. **Colores del modo oscuro**: fondos casi negros con un toque azul (`#0b0f16`, tarjetas `#151b25`), textos claros y el azul de la marca un poco más brillante para que se lea. Los botones azules usan un tono más profundo (`#1f6fd6`) para que el texto blanco contraste. Todo está en variables al inicio de `styles.css`.
33. **Logo**: negro en modo claro y blanco en oscuro (`logo-oscuro.png`, generado del logo blanco original con el mismo tamaño y márgenes que el negro). Los logos de marcas se invierten a blanco en oscuro y recuperan su color al pasar el mouse.
34. **Fotos de producto**: mantienen el fondo blanco en los dos modos, porque las fotos originales son sobre blanco y recortarlas se vería peor.

## Supabase
35. **Proyecto `EXE.COM.AR`** (ref `sbayacwjvnxwktrhkgnk`, región São Paulo `sa-east-1`, plan gratis), creado el 26/09/2026. Migraciones `0001_schema.sql` y `0002_envios.sql` aplicadas desde Claude Code en tu PC.
36. **El sitio usa la clave "publishable"** (la nueva recomendada por Supabase), no la anon JWT legacy. Las claves secretas (service_role / secret) nunca van en el repo.

