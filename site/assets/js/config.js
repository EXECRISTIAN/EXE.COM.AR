// Configuración editable del sitio.
window.SITE_CONFIG = {
  // Número de WhatsApp en formato internacional, sin "+", espacios ni guiones.
  // Argentina: 549 + código de área sin 0 + número sin 15 -> "5491122334455"
  whatsappNumber: "5491130095254",
  email: "ventas@exe.com.ar",
  currency: "ARS",
  locale: "es-AR",

  // Stock: mostrar la cantidad disponible en la web (global).
  // Cada producto puede sobreescribirlo con "showStock": true/false.
  showStock: true,
  lowStockThreshold: 3,

  // Logos del carrusel de marcas (imágenes en assets/img/marcas/).
  brandLogos: [
    { name: "NVIDIA GeForce RTX", src: "assets/img/marcas/marca-316.webp" },
    { name: "AMD", src: "assets/img/marcas/marca-320.webp" },
    { name: "Western Digital", src: "assets/img/marcas/marca-322.webp" },
    { name: "ASUS ROG", src: "assets/img/marcas/marca-331.webp" },
    { name: "Intel", src: "assets/img/marcas/marca-364.webp" },
    { name: "HyperX", src: "assets/img/marcas/marca-365.webp" },
  ],

  socials: {
    instagram: "",
    facebook: "",
  },

  // Envíos con Envia.com (Andreani, Correo Argentino, OCA…): cotización en el carrito.
  // Requiere Supabase + la función "envios" (ver docs/ENVIOS.md).
  shipping: { enabled: false },

  // Backend (Supabase). Dejar vacío hasta crear el proyecto: el sitio funciona igual en modo estático.
  // Clave pública (publishable): es segura de exponer; los datos los protege la base con RLS.
  supabaseUrl: "https://sbayacwjvnxwktrhkgnk.supabase.co",
  supabaseAnonKey: "sb_publishable_vtcKfnXsn9UXQopzVFdAOQ_NFe4v4mK",
};
