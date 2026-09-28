# Revisión continua de la web (tanda automática cada 2 h)

Cada tanda toma el primer punto sin tildar, lo revisa/arregla, lo prueba (Playwright: claro/oscuro, celular 390 px y escritorio,
panel en `?demo`), hace PR + merge y lo tilda con la fecha. Reglas:
- Solo arreglos y terminaciones. **Cambios grandes de diseño o funciones nuevas NO**: se anotan en "Propuestas para Cristian".
- Seguridad primero (RLS, permisos, nada editable por el público ni desde GitHub). Nada con costo.
- No tocar precios de venta outlet ni costos. No publicar links/costos en el repo.

## Pendiente
- [ ] Tienda en celular (390 px): header, buscador, filtros, tarjetas, ficha de producto, carrito, footer — sin desbordes ni textos cortados.
- [ ] Modo oscuro: contraste de todos los textos, badges y botones (tienda, Mi cuenta, panel).
- [ ] Accesibilidad: alt de imágenes, labels de formularios, foco visible, navegación con teclado en ficha/carrito/diálogos.
- [ ] Carrito y pedido por WhatsApp: cantidades, variantes, productos "a pedido"/"consultar", total y mensaje.
- [ ] Mi cuenta: registro, login, recuperar contraseña, configuración, mensajes de error en español.
- [ ] Panel: cada sección en `?demo` sin errores de consola; tablas usables en celular.
- [ ] Rendimiento: peso de imágenes (WebP ≤ 200 KB), lazy-loading, orden de scripts, caché.
- [ ] SEO básico: títulos, descripciones, Open Graph, favicon, sitemap.xml y robots.txt, datos estructurados de productos.
- [ ] Textos: ortografía y tono en toda la web (español rioplatense), páginas legales (términos, privacidad, garantía, envíos).
- [ ] Seguridad: revisar advisors de Supabase, políticas RLS de cada tabla, funciones SECURITY DEFINER, cabeceras (CSP) posibles en Pages.
- [ ] 404 y enlaces rotos en toda la web.
- [ ] Fotos: productos sin foto (seguir con la tanda de precios/fotos).

## Hecho

## Propuestas para Cristian (no se aplican sin su OK)
