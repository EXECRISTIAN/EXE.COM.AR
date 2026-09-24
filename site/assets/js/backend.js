// Conexión con Supabase (auth + base de datos). Si no está configurado en config.js,
// window.EXE_BACKEND queda en null y las páginas muestran el aviso correspondiente.
(() => {
  const cfg = window.SITE_CONFIG || {};
  window.EXE_BACKEND = null;
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return;

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  window.EXE_BACKEND = {
    sb,
    // Permisos efectivos del usuario logueado (suma de todos sus roles). Los calcula la base de datos.
    async permissions() {
      const { data, error } = await sb.rpc("my_permissions");
      if (error) throw error;
      return new Set((data || []).map((r) => r.permission ?? r));
    },
    async user() {
      const { data } = await sb.auth.getUser();
      return data.user;
    },
  };
})();
