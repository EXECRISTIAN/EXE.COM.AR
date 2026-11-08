/* Páginas /p/<id>/ (vista previa al compartir): llevan a la ficha del producto en la tienda.
   Se hace con JavaScript y no con <meta refresh> porque Facebook/WhatsApp siguen el meta refresh
   y terminaban leyendo la portada (con el banner) en vez de la foto del producto. */
(() => {
  const m = location.pathname.match(/^(.*\/)p\/([^/]+)\/?/);
  if (m) location.replace(`${m[1]}#producto/${m[2]}`);
})();
