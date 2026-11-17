// Configuración editable del sitio.
window.SITE_CONFIG = {
  // Número de WhatsApp en formato internacional, sin "+", espacios ni guiones.
  // Argentina: 549 + código de área sin 0 + número sin 15 -> "5491122334455"
  whatsappNumber: "5491130095254",
  outletWarrantyMonths: 3,   // garantía de los productos outlet (usados / reacondicionados); mínimo legal: 3 meses
  email: "ventas@exe.com.ar",
  currency: "ARS",
  // Google Analytics 4: ID de medición ("G-XXXXXXXXXX"). Vacío = apagado (no se muestra el aviso de cookies).
  // Solo carga si la persona acepta el aviso, y nunca para el equipo de EXE con sesión iniciada.
  ga4Id: "",
  locale: "es-AR",

  // Stock: mostrar la cantidad disponible en la web (global).
  // Cada producto puede sobreescribirlo con "showStock": true/false.
  showStock: true,
  lowStockThreshold: 3,

  // Logos del carrusel de marcas (imágenes en assets/img/marcas/). srcDark: versión transparente para el tema oscuro
  // (sin fondo y con el negro pasado a blanco), así al pasar el mouse se ven los colores reales de la marca.
  brandLogos: [
    // brand: nombre que se muestra al filtrar; match: palabras que se buscan en la marca o el nombre del producto
    { name: "NVIDIA GeForce RTX", brand: "NVIDIA", match: ["nvidia", "geforce"], src: "assets/img/marcas/marca-316.webp" },
    { name: "AMD", brand: "AMD", match: ["amd", "ryzen", "radeon"], src: "assets/img/marcas/marca-amd.svg", srcDark: "assets/img/marcas/marca-amd-osc.svg" },
    { name: "Western Digital", brand: "Western Digital", match: ["western digital", "wd"], src: "assets/img/marcas/marca-wd.svg", srcDark: "assets/img/marcas/marca-wd-osc.svg" },
    { name: "ASUS ROG", brand: "ASUS", match: ["asus", "rog"], src: "assets/img/marcas/marca-331.webp" },
    { name: "Intel", brand: "Intel", match: ["intel"], src: "assets/img/marcas/marca-intel.svg", srcDark: "assets/img/marcas/marca-intel-osc.svg" },
    { name: "HyperX", brand: "HyperX", match: ["hyperx"], src: "assets/img/marcas/marca-365.webp", srcDark: "assets/img/marcas/marca-365-osc.webp" },
    { name: "Steam", brand: "Steam", match: ["steam", "valve"], src: "assets/img/marcas/marca-steam.svg", srcDark: "assets/img/marcas/marca-steam-osc.svg" },   // consola Steam Deck
  ],

  socials: {
    instagram: "",
    facebook: "",
  },

  // Envíos (Envia.com), pago online (Mercado Pago) y facturación (ARCA) NO se configuran acá:
  // se prenden y apagan en Panel → 🔌 Integraciones (ver docs/INTEGRACIONES.md).

  // Backend (Supabase). Dejar vacío hasta crear el proyecto: el sitio funciona igual en modo estático.
  // Clave pública (publishable): es segura de exponer; los datos los protege la base con RLS.
  // Antibots en login/registro (Cloudflare Turnstile, gratis). Clave pública del widget "exe.com.ar".
  // El secret va SOLO en Supabase → Authentication → Attack Protection → Captcha.
  turnstileSiteKey: "0x4AAAAAAFFqiE4e4uABCDg_",

  supabaseUrl: "https://sbayacwjvnxwktrhkgnk.supabase.co",
  supabaseAnonKey: "sb_publishable_vtcKfnXsn9UXQopzVFdAOQ_NFe4v4mK",
};
