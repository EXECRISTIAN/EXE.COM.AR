// Configuración editable del sitio.
window.SITE_CONFIG = {
  // Número de WhatsApp en formato internacional, sin "+", espacios ni guiones.
  // Argentina: 549 + código de área sin 0 + número sin 15 -> "5491122334455"
  whatsappNumber: "5490000000000",
  email: "ventas@exe.com.ar",
  currency: "ARS",
  locale: "es-AR",

  // Stock: mostrar la cantidad disponible en la web (global).
  // Cada producto puede sobreescribirlo con "showStock": true/false.
  showStock: true,
  lowStockThreshold: 3,

  // Marcas del carrusel inferior.
  brands: ["ASUS", "ROG", "AMD", "NVIDIA", "Antec", "Aerocool", "DeepCool", "Team Group", "T-Force"],

  socials: {
    instagram: "",
    facebook: "",
  },

  // Backend (Supabase). Dejar vacío hasta crear el proyecto: el sitio funciona igual en modo estático.
  supabaseUrl: "",
  supabaseAnonKey: "",
};
