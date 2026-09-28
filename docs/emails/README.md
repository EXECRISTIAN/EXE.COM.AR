# Plantillas de email (generadas)

No editar estos archivos: editar `supabase/functions/_shared/emails.js` y correr `node scripts/build-emails.mjs`.

| Archivo | Asunto |
|---|---|
| [pedido-order_created.html](pedido-order_created.html) | Recibimos tu pedido #1024 |
| [pedido-order_paid.html](pedido-order_paid.html) | Pago confirmado — pedido #1024 |
| [pedido-order_shipped.html](pedido-order_shipped.html) | Tu pedido #1024 está en camino |
| [pedido-order_delivered.html](pedido-order_delivered.html) | Pedido #1024 entregado |
| [pedido-order_cancelled.html](pedido-order_cancelled.html) | Pedido #1024 cancelado |
| [pedido-admin_new_order.html](pedido-admin_new_order.html) | 🛒 Nuevo pedido #1024 — $ 723.880 |
| [cuenta-confirmation.html](cuenta-confirmation.html) | Confirmá tu cuenta en EXE |
| [cuenta-recovery.html](cuenta-recovery.html) | Restablecé tu contraseña de EXE |
| [cuenta-email_change.html](cuenta-email_change.html) | Confirmá tu nuevo email en EXE |

Los `cuenta-*.html` se pegan en Supabase → Authentication → Email Templates (Confirm signup, Reset password, Change email).
