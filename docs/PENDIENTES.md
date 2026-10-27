# Tareas pendientes / a futuro

## Armador de PC — hecho (27/10)
Tienda → "Armá tu PC" (#armador). Filtra por socket y DDR (claves de Compatibilidad) y la fuente por la placa de video.
Para sumar a futuro: claves de formato (`ATX`, `M-ATX`, `ITX`) para gabinete ↔ mother y consumo del procesador.

## Necesitan a Cristian
- **Revocar claves pegadas en el chat**: token `sbp_…` de Supabase, token de Envia.com y la primera clave de Resend (`re_CXX…`).
- **Edge Functions** (`send-email`, `envios`, `mp-webhook`): no están desplegadas. Necesitan secrets que solo carga Cristian
  (`RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, `ENVIA_TOKEN`, `MP_ACCESS_TOKEN`) en Supabase → Edge Functions → Secrets.
- **Protección de contraseñas filtradas** (HaveIBeenPwned) en Supabase Auth: es función del plan Pro (pago), queda apagada.
- **Mercado Pago**: crear la cuenta de integración y el token para cobrar online.
- **Dominio**: pasar exe.com.ar a GitHub Pages cuando se decida (hoy sigue el WordPress).

## Recordar a Cristian (28/09)
- Panel → Resumen sigue igual que antes. Opciones propuestas: Resumen más completo (productos activos, sin stock y sin foto, dólar del día, últimos pedidos, alertas) y/o links "Ir a la tienda" e "Ir a mi cuenta" en el menú lateral. Definir cuál quiere.
