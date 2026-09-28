# Revisión continua de la web (tanda automática cada 2 h)

Cada tanda toma el primer punto sin tildar, lo revisa/arregla, lo prueba (Playwright: claro/oscuro, celular 390 px y escritorio,
panel en `?demo`), hace PR + merge y lo tilda con la fecha. Reglas:
- Solo arreglos y terminaciones. **Cambios grandes de diseño o funciones nuevas NO**: se anotan en "Propuestas para Cristian".
- Seguridad primero (RLS, permisos, nada editable por el público ni desde GitHub). Nada con costo.
- No tocar precios de venta outlet ni costos. No publicar links/costos en el repo.

## Pendiente
- [ ] Rendimiento: peso de imágenes (WebP ≤ 200 KB), lazy-loading, orden de scripts, caché.
- [ ] SEO básico: títulos, descripciones, Open Graph, favicon, sitemap.xml y robots.txt, datos estructurados de productos.
- [ ] Textos: ortografía y tono en toda la web (español rioplatense), páginas legales (términos, privacidad, garantía, envíos).
- [ ] Seguridad: revisar advisors de Supabase, políticas RLS de cada tabla, funciones SECURITY DEFINER, cabeceras (CSP) posibles en Pages.
- [ ] 404 y enlaces rotos en toda la web.
- [ ] Fotos: productos sin foto (seguir con la tanda de precios/fotos).

## Hecho
- [x] 28/09 — Panel en celular: las 11 secciones sin errores de consola; menú en una fila deslizable; la página ya no se desplaza de costado (las tablas se deslizan dentro de su recuadro); indicadores en 2 columnas.
- [x] 28/09 — Mi cuenta: mensajes de error claros en español para ingreso, registro y cambio de contraseña (demasiados intentos, captcha, contraseña débil o repetida, email inválido, sin conexión), sin revelar si un email ya tiene cuenta.
- [x] 28/09 — Carrito: cantidades respetan el stock, variantes y "a consultar" en el total funcionan. Ahora el carrito y el mensaje de WhatsApp aclaran "a pedido" y "consultar stock".
- [x] 28/09 — Accesibilidad: tienda, Mi cuenta y 404 sin imágenes sin alt, campos sin etiqueta ni botones sin nombre; ficha se abre con Enter y se cierra con Esc. Panel: todos los campos reciben nombre para lectores de pantalla (filtros, celdas de la tabla, colores, números). Anillo de foco explícito en chips y etiquetas.
- [x] 28/09 — Contraste (chequeo automático en tienda, Mi cuenta y panel, claro y oscuro): chips/botones seleccionados del panel legibles en oscuro; "disponibles"/"últimas unidades" más oscuros en claro (pasan el mínimo). Sin otros problemas en oscuro.
- [x] 28/09 — Tienda en celular: sin desplazamiento horizontal; etiqueta de categoría y "Outlet" ya no se pisan; "Consultar precio" más compacto; "¡Última unidad!" en singular; la X de la ficha se ve en modo oscuro.

## Propuestas para Cristian (no se aplican sin su OK)
- **Azul de marca un poco más oscuro en modo claro** (#0084d6 → #0073bb): hoy el texto blanco sobre azul y los links azules tienen contraste 3,98 (lo recomendado es 4,5). Cambio casi imperceptible pero mejora la lectura.
- **Botón verde "Enviar pedido por WhatsApp"**: texto blanco sobre verde WhatsApp tiene contraste 2 (bajo). Opciones: verde más oscuro (#128C4A) o texto negro.
