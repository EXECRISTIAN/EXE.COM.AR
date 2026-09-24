# Envíos con Andreani

Integración con la API de Andreani (https://developers.andreani.com). **Está preparada pero apagada** hasta que tengas las credenciales y Supabase activo.

## Qué hace
| Dónde | Qué |
|---|---|
| **Carrito** | El cliente pone su código postal y ve el costo **a domicilio** y **a sucursal**. La opción elegida viaja en el mensaje de WhatsApp como "cotización estimada". Si el carrito cambia, pide recalcular. |
| **Panel → Pedidos** | Botón **Crear envío** (solo pedidos pagados) y **Etiqueta** (PDF para imprimir). Requiere el permiso `shipping.manage` (administrador y moderador lo tienen). |
| **Mi cuenta** | El cliente ve el número de envío con link al seguimiento de Andreani. |

## Seguridad
- Usuario, contraseña y contratos de Andreani viven **solo** como *secrets* de Supabase, dentro de la Edge Function `supabase/functions/andreani`. Nunca llegan al navegador ni a GitHub.
- La cotización usa **precio y peso de la base de datos**, no lo que manda el navegador: nadie puede cotizar un envío más barato tocando el carrito.
- Crear envíos y bajar etiquetas exige `shipping.manage`, verificado en el servidor.
- El costo de envío (`orders.shipping_cost`) no lo puede escribir el cliente.

## Qué necesitás de Andreani
1. **Cuenta corporativa / contrato** con Andreani (lo da tu ejecutivo comercial o desde https://pymes.andreani.com). La API no está disponible sin contrato.
2. Te dan: **usuario y contraseña de API**, **número de cliente** y **números de contrato** (uno para envío a domicilio y otro a sucursal).
3. Primero te habilitan el **entorno de pruebas (QA)** — la función arranca en QA por defecto.

No tiene costo de integración: pagás solo los envíos según tu contrato.

## Activación (paso a paso)
1. Tener Supabase funcionando (ver `ARQUITECTURA.md`).
2. Correr `supabase/migrations/0002_andreani.sql`.
3. Cargar peso (`weight_kg`) y opcionalmente medidas de cada producto.
4. Cargar los secrets (Supabase → Edge Functions → Secrets):
   `ANDREANI_ENV=qa`, `ANDREANI_USER`, `ANDREANI_PASS`, `ANDREANI_CLIENTE`,
   `ANDREANI_CONTRATO_DOMICILIO`, `ANDREANI_CONTRATO_SUCURSAL`,
   `ANDREANI_ORIGEN` (JSON con tu dirección de despacho y datos del remitente; ejemplo en el encabezado de `index.ts`).
5. `supabase functions deploy andreani --no-verify-jwt`
6. En `site/assets/js/config.js`: `andreani: { enabled: true }`.
7. Probar en QA; cuando esté todo bien, `ANDREANI_ENV=prod`.

## Endpoints usados
| Acción | Endpoint Andreani |
|---|---|
| Login (token 24 h) | `GET /login` (Basic auth → header `x-authorization-token`) |
| Cotizar | `GET /v1/tarifas` |
| Sucursales | `GET /v2/sucursales?codigoPostal=` |
| Crear envío | `POST /v2/ordenes-de-envio` |
| Etiqueta | `GET /v2/ordenes-de-envio/{numero}/etiquetas` |
| Seguimiento | `GET /v2/envios/{numero}` y `/trazas` |

Base: `https://apisqa.andreani.com` (pruebas) / `https://apis.andreani.com` (producción).

> Nota: el portal de desarrolladores no se pudo leer desde el entorno donde se escribió esto; los endpoints salen de SDKs públicos que usan la misma API. Al recibir las credenciales, se valida todo contra QA y se ajustan nombres de campos si Andreani los cambió.
