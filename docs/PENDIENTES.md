# Tareas pendientes / a futuro

## Armador de PC (pedido el 28/09/2026)
Herramienta para que el cliente arme su PC paso a paso y la mande como pedido.
Idea base (a definir con Cristian antes de empezar):
- Pasos: procesador → motherboard → memoria → placa de video → almacenamiento → fuente → gabinete → refrigeración.
- **Compatibilidad automática** usando las especificaciones de cada producto (`specs` en `products.json` / tabla `products`):
  socket CPU ↔ mother, tipo de memoria (DDR4/DDR5) ↔ mother, formato (ATX/M-ATX/ITX) ↔ gabinete,
  consumo estimado ↔ potencia de la fuente, "incluye cooler" del procesador.
- Resumen con total, botón "Agregar todo al carrito" y "Enviar por WhatsApp".
- Requisito previo: cargar más productos (las fichas técnicas de los 10 actuales ya están completas).

## Necesitan a Cristian
- **Revocar claves pegadas en el chat**: token `sbp_…` de Supabase, token de Envia.com y la primera clave de Resend (`re_CXX…`).
- **Edge Functions** (`send-email`, `envios`, `mp-webhook`): no están desplegadas. Necesitan secrets que solo carga Cristian
  (`RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, `ENVIA_TOKEN`, `MP_ACCESS_TOKEN`) en Supabase → Edge Functions → Secrets.
- **Protección de contraseñas filtradas** (HaveIBeenPwned) en Supabase Auth: es función del plan Pro (pago), queda apagada.
- **Mercado Pago**: crear la cuenta de integración y el token para cobrar online.
- **Dominio**: pasar exe.com.ar a GitHub Pages cuando se decida (hoy sigue el WordPress).
