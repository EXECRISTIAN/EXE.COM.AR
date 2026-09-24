# Envíos con Envia.com

Integración con la API de Envia.com (https://docs.envia.com), que reemplaza a la integración directa con Andreani: con **una sola cuenta** cotiza y genera guías de varios transportistas (Andreani, Correo Argentino, OCA, etc.). **Está preparada pero apagada** hasta activar Supabase.

## Qué hace
| Dónde | Qué |
|---|---|
| **Carrito** | El cliente pone su código postal y ve las opciones de todos los transportistas configurados, ordenadas de menor a mayor precio, con días estimados. La elegida viaja en el WhatsApp como "cotización estimada". Si el carrito cambia, pide recalcular. |
| **Panel → Pedidos** | Botón **Crear envío** (solo pedidos pagados): genera la guía en Envia con el transportista que eligió el cliente y abre la **etiqueta PDF**. Requiere `shipping.manage` (administrador y moderador). |
| **Mi cuenta** | El cliente ve transportista y número de seguimiento con link al rastreo. |

## Seguridad
- El **token de Envia** vive solo como *secret* de Supabase, dentro de `supabase/functions/envios`. **Nunca** va en `config.js`, en el código ni en GitHub (el sitio es público: cualquiera podría usarlo y generar guías a tu cuenta).
- La cotización usa **precio y peso de la base de datos**, no lo que manda el navegador.
- Generar guías exige `shipping.manage`, verificado en el servidor, y solo sobre pedidos pagados.
- El costo real del envío lo escribe la función en `orders.shipping_cost`; el cliente no puede tocarlo.

## Activación (paso a paso)
1. Tener Supabase funcionando (ver `ARQUITECTURA.md`).
2. Correr `supabase/migrations/0002_envios.sql`.
3. Cargar peso (`weight_kg`) y, si podés, medidas de cada producto (si no, se usa 1 kg y caja de 30×20×15 cm).
4. Secrets en Supabase → Edge Functions → Secrets:
   - `ENVIA_TOKEN` — tu token de Envia.
   - `ENVIA_ENV` — `test` para probar, `prod` para producción.
   - `ENVIA_CARRIERS` — ej. `andreani,correo-argentino,oca` (los que tengas habilitados en Envia).
   - `ENVIA_ORIGEN` — dirección de despacho y datos del remitente (ejemplo en el encabezado de `index.ts`).
5. `supabase functions deploy envios --no-verify-jwt`
6. En `site/assets/js/config.js`: `shipping: { enabled: true }`.
7. Probar con `ENVIA_ENV=test`; cuando esté bien, pasar a `prod` (y cargar saldo en Envia: las guías se descuentan de tu saldo).

## Endpoints usados
| Acción | Endpoint Envia |
|---|---|
| Cotizar (1 transportista por llamada, se piden en paralelo) | `POST /ship/rate/` |
| Generar guía + etiqueta | `POST /ship/generate/` |
| Seguimiento | `POST /ship/generaltrack/` |
| Provincia/localidad por CP | `GET geocodes.envia.com/zipcode/AR/{cp}` |

Base: `https://api-test.envia.com` (pruebas) / `https://api.envia.com` (producción). Autenticación: `Authorization: Bearer <token>`.

> Nota: la documentación de Envia no se pudo abrir desde el entorno donde se escribió esto; los campos siguen la estructura publicada de la API (origin/destination/packages/shipment/settings). Al activarlo se valida contra el entorno de pruebas y se ajusta lo que haga falta (por ejemplo, los códigos exactos de transportista y el link público de rastreo).
