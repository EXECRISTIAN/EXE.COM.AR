# Actualización de precios y catálogo (tarea continua)

Pedido del 28/09/2026. Se hace de a poco, sin que haga falta pedirlo cada vez.

## Reglas
- **Precio de venta = precio de referencia × 1,50** (redondeado a $100). En la web se aclara "Consultar precio final".
- Referencia: tiendas líderes de Argentina (CompraGamer primero; luego Mexx, Venex, FullH4rd si se pueden leer).
- **Solo productos nuevos** (nada de outlet, usados, combos ni PCs armadas), con **envío nacional** y entrega de **2 semanas como máximo**.
- Productos de menos de **$2.000.000**, con demanda (gaming / armado de PC / oficina).
- Fotos sobre fondo blanco, descripción y especificaciones en cada producto nuevo.
- **Link de compra y precio de referencia**: solo en Supabase (`product_sources`, visible únicamente para administradores). Nunca en el repo, que es público.
- Si un producto no tiene stock en ninguna tienda de referencia → `"active": false` (no se muestra ni se puede pedir).

## Meta de catálogo (5 productos por categoría)
Procesadores · Motherboards · Memorias RAM · Placas de video · **Almacenamiento (SSD/HDD)** · Fuentes · Gabinetes · Refrigeración · **Monitores** · **Periféricos (teclados, mouses, auriculares)**.

## Límite del plan gratis de Cloudflare (Browser Run)
- **10 minutos de navegador por día** y **1 pedido cada 10 segundos** (docs de Cloudflare, 26/09/2026). En el plan gratis no hay cobro extra: al llegar al límite se corta.
- Objetivo: usar como máximo **8 min/día (80 %)**, nunca más de 9 (90 %). Cada lectura de una página tarda ~13–20 s → **máx. ~25 lecturas por día**.

## Registro de uso
| Fecha (UTC) | Hora | Lecturas | Tiempo aprox. | Trabajo |
|---|---|---|---|---|
| 2026-09-28 | 04:28–04:46 | ~16 | ~4–5 min | Pruebas de acceso (FullH4rd y MercadoLibre bloquean; CompraGamer funciona con /markdown). Búsqueda "i5 13400" (no está en CompraGamer) y "procesador intel". |

## Fotos pendientes (28/09)
28 productos outlet no tienen foto. Intentos sin éxito: páginas oficiales (Gigabyte, MSI, Intel, Zotac, Thermaltake bloquean servidores; Sentey sin og:image), búsqueda de Bing desde GitHub (devuelve fotos que no son del producto), Wikimedia Commons (no tiene esos modelos) y el navegador de Cloudflare (se corta con Gigabyte). Nunca se publica una foto de otro modelo ni con marca de agua.
Siguiente intento en las tandas diarias: leer `og:image` con el navegador de Cloudflare (1 lectura por producto, dentro del cupo) y bajar la foto con la Action. Mientras tanto, lo más rápido es subir fotos propias desde el panel (Productos → Editar → Fotos).
