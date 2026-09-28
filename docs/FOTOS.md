# Cola de fotos (se trabaja de a partes)

Flujo por producto: **pendiente → candidata** (URL de la foto oficial encontrada y anotada acá) **→ descargada** (la Action
`tools/fetch_images.py` la baja y convierte a WebP; revisada a ojo: modelo exacto, sin marca de agua) **→ subida** (en `images`
del producto en Supabase). Cada tanda avanza lo que pueda (búsquedas sin gastar cupo de Cloudflare primero; Cloudflare solo
para páginas que bloquean) y deja anotado dónde quedó. Nunca se usa una foto de otro modelo.

| Producto (id) | Estado | Notas / candidata |
|---|---|---|
| outlet-steam-deck-512 | pendiente | |
| outlet-aorus-p750w-nueva | pendiente | |
| outlet-aorus-p750w-usada | pendiente | |
| outlet-gigabyte-p1000gm | pendiente | |
| outlet-gigabyte-p650b | pendiente | |
| outlet-gigabyte-p750gm | pendiente | |
| outlet-gigabyte-p850gm | pendiente | |
| outlet-redragon-850w | pendiente | |
| outlet-thermaltake-smart-700w | pendiente | |
| outlet-thermaltake-smart-rgb-700w | pendiente | |
| outlet-sentey-r20 | pendiente | |
| outlet-sentey-x10 | pendiente | |
| outlet-biostar-z490a-silver | pendiente | |
| outlet-gigabyte-b460m-ds3h-v2 | pendiente | |
| outlet-z390-aorus-elite | pendiente | |
| outlet-msi-h510m-a-pro | pendiente | |
| outlet-msi-mpg-z490-gaming-plus | pendiente | |
| outlet-pc-gamer-ryzen5 | pendiente | |
| outlet-rtx3090-zotac-trinity | pendiente | |
| outlet-celeron-g5905 | pendiente | |
| outlet-celeron-g5925-full | pendiente | |
| outlet-celeron-g5925-sin-caja | pendiente | |
| outlet-i3-10100 | pendiente | |
| outlet-i3-10100f | pendiente | |
| outlet-i3-10105 | pendiente | |
| outlet-i3-12100f | pendiente | |
| outlet-i5-10400 | pendiente | |
| outlet-pentium-g5420 | pendiente | |
