# Arquitectura del nuevo exe.com.ar

Objetivo: reemplazar WordPress + WooCommerce + Elementor por un sitio **rápido, seguro y con costo $0**, alojado en GitHub.

## Piezas

| Pieza | Servicio | Costo | Para qué |
|---|---|---|---|
| Sitio web (HTML/CSS/JS) | **GitHub Pages** | $0 | Tienda, catálogo, carrito, "Mi cuenta", panel |
| Usuarios + base de datos | **Supabase** (plan Free) | $0 | Login, roles, productos, stock, pedidos |
| Emails automáticos | **Resend** (plan Free, 3.000/mes) | $0 | Bienvenida, pedido recibido, pago confirmado, envío |
| Pagos (opcional, fase 3) | **Mercado Pago** | Solo comisión por venta | Cobro online y confirmación automática |
| Dominio | exe.com.ar (ya lo tenés) | Renovación NIC | Apunta a GitHub Pages |

Límites del plan gratis de Supabase (sobran para una tienda chica/mediana): 50.000 usuarios activos por mes, 500 MB de base de datos, 1 GB de archivos, 500.000 invocaciones de funciones. **Ojo:** los proyectos Free se pausan tras 7 días sin actividad; con visitas normales no pasa, y si pasa se reactiva desde el panel.

```
Navegador ──► GitHub Pages (site/)            ← archivos estáticos, públicos
    │
    └──► Supabase ── Auth (login/registro)
                  ├─ PostgreSQL + Row Level Security   ← los datos, protegidos
                  └─ Edge Functions
                       ├─ mp-webhook  ◄── Mercado Pago (confirma pagos)
                       └─ send-email  ──► Resend (emails)
```

## 1. Lista de clientes
Cada registro crea automáticamente un **perfil** (`profiles`: nombre, email, teléfono) y le asigna el rol **suscriptor** (trigger `handle_new_user`). El panel lista todos los usuarios para quien tenga el permiso `users.read`. Exportar a Excel/CSV: Supabase > Table Editor > `profiles` > Export.

## 2. Historial de pedidos del cliente
Cada pedido queda en `orders` + `order_items` asociado al usuario. En **Mi cuenta** (`cuenta.html`) el cliente ve solo *sus* pedidos: la base lo garantiza con la política RLS `mis pedidos` (`user_id = auth.uid()`), no el JavaScript.

## 3. Contenido/precios solo para registrados
Se resuelve con otra política RLS sobre `products` (ej. una columna `price_wholesale` visible solo para usuarios con un permiso `prices.wholesale`). Queda preparado: es agregar la columna, el permiso y la política.

## Control de stock
- `products.stock` es un entero con `check (stock >= 0)`: **nunca puede quedar negativo**.
- Al crear un pedido, `create_order()` bloquea la fila del producto (`for update`), verifica stock y lo descuenta en la misma transacción → dos clientes no pueden comprar la última unidad a la vez.
- Cancelar un pedido devuelve el stock automáticamente.
- **Mostrar u ocultar el stock en la web**: global en `site/assets/js/config.js` (`showStock`) y por producto (`show_stock` en la base / `"showStock"` en `products.json`). Si está oculto se muestra solo "En stock" / "Sin stock". Umbral de "¡Últimas unidades!": `lowStockThreshold`.
- Mientras no esté Supabase, el stock se edita en `site/data/products.json` y el carrito ya respeta el máximo disponible.

## Roles y permisos
Ver [ROLES-Y-PERMISOS.md](ROLES-Y-PERMISOS.md). Roles base: **administrador**, **moderador**, **suscriptor**. Se pueden crear roles personalizados combinando permisos sin tocar código.

## Dashboard
`site/admin/` — solo entra quien tenga `dashboard.access`, y cada sección exige su propio permiso (pedidos, productos/stock, usuarios, roles, emails). Importante: ocultar botones en el navegador **no es** la seguridad; la seguridad está en la base (RLS + funciones que llaman a `has_perm()`). Aunque alguien edite el JS o llame a la API directamente, la base rechaza lo que no le corresponde.

Vista previa sin backend: `admin/?demo=1`.

## Emails automáticos
`supabase/functions/send-email` con plantillas: pedido recibido, pago confirmado, pedido enviado. Los de registro, confirmación de email y recuperación de contraseña los manda Supabase Auth (plantillas editables en Supabase > Authentication > Email Templates, configurando Resend como SMTP para usar ventas@exe.com.ar).

## Que no puedan existir pedidos falsos ni "pagados" truchos
1. **El navegador no puede escribir pedidos directamente**: `orders` no tiene políticas de insert/update para clientes.
2. **Los precios los pone la base**: `create_order()` ignora cualquier precio enviado y copia `products.price` al `order_items.unit_price`. Manipular el carrito no cambia lo que se cobra.
3. **"Pagado" solo lo marca**:
   - el webhook de Mercado Pago, que **re-consulta el pago a la API de MP con el token secreto** y verifica que el monto coincida con el total; o
   - un usuario con el permiso específico `orders.mark_paid` (separado de `orders.update_status`).
4. **Auditoría**: cada cambio de estado queda en `order_events` con quién (`mercadopago` o el id del admin) y cuándo. No se puede borrar desde el cliente.
5. Solo usuarios logueados pueden crear pedidos (con email verificado si activás "Confirm email" en Supabase).

## Fases
1. ✅ **Ahora**: sitio estático con el diseño, catálogo desde `products.json`, carrito → WhatsApp.
2. **Usuarios y panel**: crear el proyecto Supabase, correr `supabase/migrations/0001_schema.sql`, pegar URL y anon key en `config.js`, cargar productos en la tabla `products` y cambiar el catálogo para leer de ahí.
3. **Pagos online**: Mercado Pago Checkout Pro + `mp-webhook`.
