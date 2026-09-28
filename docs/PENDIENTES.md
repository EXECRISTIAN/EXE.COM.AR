# Tareas pendientes / a futuro

## Armador de PC (pedido el 28/09/2026)
Herramienta para que el cliente arme su PC paso a paso y la mande como pedido.
Idea base (a definir con Cristian antes de empezar):
- Pasos: procesador → motherboard → memoria → placa de video → almacenamiento → fuente → gabinete → refrigeración.
- **Compatibilidad automática** usando las especificaciones de cada producto (`specs` en `products.json` / tabla `products`):
  socket CPU ↔ mother, tipo de memoria (DDR4/DDR5) ↔ mother, formato (ATX/M-ATX/ITX) ↔ gabinete,
  consumo estimado ↔ potencia de la fuente, "incluye cooler" del procesador.
- Resumen con total, botón "Agregar todo al carrito" y "Enviar por WhatsApp".
- Requisito previo: completar las fichas técnicas que faltan (i7 13700, GTX 1650, DeepCool AG400) y cargar más productos.

## Fichas técnicas a corregir
En WordPress estas fichas no correspondían al producto, por eso no se muestran:
- Procesador Intel Core i7 13700 → tenía la ficha del i5 13400.
- Placa de video MSI GTX 1650 4GB → tenía la de una Zotac GTX 1660 SUPER 6GB.
- Cooler DeepCool AG400 PLUS → decía "AK400 ZERO DARK".
