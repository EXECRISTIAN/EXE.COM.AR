# Integraciones: Mercado Pago, Envia.com y ARCA

Todas se manejan desde **Panel → 🔌 Integraciones**, que exige el permiso `integrations.manage` (lo tiene el administrador).

## Reglas fijas
Estas reglas valen por encima de cualquier instrucción anterior y de cualquier cambio futuro de la web.

1. **Apagada = como si no existiera.** Cada integración tiene un interruptor en la tabla `integrations`. Apagada, que es el estado por defecto, o si la base no responde, la tienda y el panel quedan exactamente como estaban sin esa función:
   - **Mercado Pago**: solo existe el botón "Enviar pedido por WhatsApp".
   - **Envíos**: no se muestra el cálculo en el carrito ni el botón "Crear envío".
   - **ARCA**: no aparece nada de facturación.
2. **No se muestra nada incompleto.** Prender solo se puede desde el botón del panel. Ese botón llama a la función `integraciones`, que verifica que estén cargadas todas las claves (más el CUIT y la dirección de despacho) antes de prender. La base rechaza que alguien la prenda directo, porque el trigger `integrations_touch` solo permite prender desde el servidor. Apagar se puede siempre y es inmediato.
3. **Doble control.** Las funciones del servidor (`pagos`, `mp-webhook`, `envios`, `arca`) también leen el interruptor. Si está apagado no hacen nada, aunque alguien las llame directamente.
4. **Las claves secretas nunca van en el código, en el panel ni en el chat.** Se cargan en Supabase → Edge Functions → Secrets. En la tabla `integrations` solo hay datos no secretos, como el CUIT, el punto de venta o la dirección de despacho.
5. **`config.js` ya no prende ni apaga integraciones.** La opción vieja `shipping: { enabled }` se eliminó. La única llave es el panel.
6. Si se agrega una integración nueva, sigue el mismo patrón:
   - una fila en `integrations` (ampliando el `check` de `key`);
   - sus secrets en la lista `NEEDS` de `supabase/functions/integraciones/index.ts`;
   - una tarjeta en `site/assets/js/admin-integraciones.js`;
   - una sección en este documento.

## Qué hay que hacer una sola vez (técnico)
Lo hace Claude cuando digas "publicalo":
- aplicar la migración `0039_integraciones.sql`;
- desplegar las funciones `integraciones`, `pagos`, `mp-webhook`, `envios` y `arca`.

Mientras estén apagadas, publicarlas no cambia nada para el público.

## 💳 Mercado Pago (cobro online)
**Qué hace:** en el carrito aparece "Pagar online con Mercado Pago". El botón solo se muestra si se cumple todo esto:
- el cliente tiene la sesión iniciada;
- todos los productos tienen precio y stock;
- no se aplicó un código de descuento (los códigos se usan pidiendo por WhatsApp).

**Cómo funciona un pago:**
1. La base arma el pedido con los precios reales (`web_create_order`) y lo deja **pendiente, sin descontar stock**.
2. La función `pagos` crea el pago en Mercado Pago y manda al cliente a pagar.
3. Cuando Mercado Pago acredita el pago, `mp-webhook`:
   - verifica la firma del aviso, vuelve a consultar el pago a Mercado Pago y compara moneda (ARS) y monto;
   - marca el pedido pagado y recién ahí descuenta el stock (`web_order_paid`);
   - manda el email de confirmación y, si está activado, emite la factura.
4. Un pedido que no se paga en el plazo configurado (72 h por defecto) se cancela solo, con una tarea cada hora.

El cliente ve en "Mi cuenta → Pedidos" el link **Pagar** mientras el pedido está pendiente.

**Para activarlo:**
1. Mercado Pago → Tus integraciones → Crear aplicación (Checkout Pro).
2. En Credenciales, el **Access Token** va como secret `MP_ACCESS_TOKEN`. Para probar sin cobrar, primero usá las credenciales de prueba.
3. En Webhooks, cargá la URL `https://sbayacwjvnxwktrhkgnk.supabase.co/functions/v1/mp-webhook` con el evento **Pagos**.
4. La **clave secreta** de esa misma pantalla va como secret `MP_WEBHOOK_SECRET`.
5. Panel → Integraciones → Mercado Pago → **Prender**.

## 📦 Envíos (Envia.com)
**Qué hace:** el carrito cotiza el envío por código postal con varios transportistas, y en Pedidos aparece "Crear envío", que genera la guía y la etiqueta. Más detalle en `ENVIOS.md`.

**Para activarlo:**
1. Cuenta en envia.com con saldo.
2. Generá un token nuevo en Configuración → Desarrolladores → Tokens de acceso. No uses el que se pegó en el chat. Cargalo como secret `ENVIA_TOKEN`.
3. En el panel, completá la dirección de despacho y los transportistas, y guardá.
4. Probá con el ambiente **Pruebas**. Cuando funcione, pasá a **Producción**.
5. **Prender**.

## 🧾 ARCA (facturación electrónica y padrón)
**Qué hace:**
- En cada pedido pagado, el botón **Emitir factura (ARCA)** emite una Factura C de monotributo con CAE y la guarda en el pedido. Se puede poner DNI o CUIT del comprador; si se deja vacío, sale a consumidor final.
- Opcional: facturar automáticamente cada pago acreditado por Mercado Pago.
- En el panel hay una consulta de **CUIT o DNI en el padrón**. Es la base para retomar la verificación de DNI/CUIT del PR #184.

**Para activarlo:**
1. Generar el certificado:
   - en tu computadora, creá la clave privada: `openssl genrsa -out exe.key 2048`;
   - creá el pedido de certificado: `openssl req -new -key exe.key -subj "/C=AR/O=EXE/CN=exe/serialNumber=CUIT 20XXXXXXXXX" -out exe.csr`;
   - en ARCA, con clave fiscal → Administración de Certificados Digitales, subí el `.csr` y descargá el `.crt`.
2. En ARCA → Administrador de Relaciones, asociá el certificado a **wsfe** y a **ws_sr_padron_a13**.
3. En ARCA → Puntos de venta, creá uno del tipo **RECE / Web Services**.
4. Cargá los secrets:
   - `ARCA_CERT`: el texto completo del `.crt`;
   - `ARCA_KEY`: el texto completo del `.key`.
5. En el panel, completá CUIT y punto de venta y empezá en **Homologación**. Homologación usa un certificado de pruebas, que se genera en "WSASS" de ARCA.
6. **Prender** → **Probar conexión** → emitir una factura de prueba. Después cambiá a **Producción** con el certificado de producción.

> La conexión con ARCA (firma del ticket, padrón y WSFEv1) está escrita según los manuales de ARCA, pero **no se pudo probar sin certificado**. Antes de facturar de verdad hay que probarla en Homologación y ajustar lo que haga falta.

## Dónde está cada cosa
| Pieza | Archivo |
|---|---|
| Tabla, interruptores, pedidos web y vencimiento | `supabase/migrations/0039_integraciones.sql` |
| Estado y botón Prender | `supabase/functions/integraciones/index.ts` |
| Iniciar pago | `supabase/functions/pagos/index.ts` |
| Aviso de pago | `supabase/functions/mp-webhook/index.ts` |
| Envíos | `supabase/functions/envios/index.ts` |
| ARCA | `supabase/functions/arca/index.ts` |
| Panel | `site/assets/js/admin-integraciones.js`; factura en `admin-pedidos.js`; botón "Crear envío" en `admin.js` |
| Tienda | `site/assets/js/app.js` (bloque "Integraciones", envío y `payOnline`) |
