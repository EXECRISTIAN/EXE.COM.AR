// Sesión atada al dispositivo (panel de administración).
// Crea una llave ECDSA P-256 que el navegador no deja copiar ni exportar (se guarda en IndexedDB como CryptoKey
// "no extraíble") y cada 4 minutos firma una prueba para la función "dispositivo". Si alguien copia el token
// de la sesión a otra computadora, ahí no está la llave: no puede probar nada y la base no le da permisos.
(() => {
  const be = window.EXE_BACKEND;
  if (!be || !window.crypto?.subtle || !window.indexedDB) return;
  const sb = be.sb, cfg = window.SITE_CONFIG;
  const DB = "exe-dispositivo", STORE = "llaves";

  const idb = (mode, fn) => new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onerror = () => ko(r.error);
    r.onsuccess = () => { const tx = r.result.transaction(STORE, mode); const q = fn(tx.objectStore(STORE)); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => ko(tx.error); };
  });
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function session() {
    const { data } = await sb.auth.getSession();
    const s = data.session; if (!s) return null;
    const claims = JSON.parse(atob(s.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { token: s.access_token, sid: claims.session_id };
  }
  async function call(body, token) {
    const r = await fetch(`${cfg.supabaseUrl}/functions/v1/dispositivo`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }
  const sign = async (key, sid, ts) => b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${sid}|${ts}`)));

  // Ata la sesión a este navegador (se llama justo después de verificar con código o QR)
  async function bind() {
    const s = await session(); if (!s?.sid) return "no_session";
    let pair = await idb("readonly", (st) => st.get(s.sid)).catch(() => null);
    if (!pair) {
      pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      await idb("readwrite", (st) => st.put(pair, s.sid));
    }
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);  // solo la parte pública se puede exportar
    const ts = Date.now();
    const r = await call({ action: "bind", pubkey: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, ts, sig: await sign(pair.privateKey, s.sid, ts) }, s.token);
    if (r.data.result === "ok" || r.data.result === "already_bound") await prove();
    return r.data.result || r.data.error;
  }

  // Prueba firmada: "sigo siendo el mismo dispositivo, desde esta conexión"
  let last = 0;
  async function prove() {
    const s = await session(); if (!s?.sid) return "no_session";
    const pair = await idb("readonly", (st) => st.get(s.sid)).catch(() => null);
    if (!pair) return "no_key";
    const ts = Date.now();
    const r = await call({ action: "proof", ts, sig: await sign(pair.privateKey, s.sid, ts) }, s.token);
    if (r.status === 200) last = Date.now();
    return r.data.result || r.data.error;
  }
  const fresh = () => Date.now() - last < 3 * 60 * 1000;
  async function ensure() { return fresh() ? "ok" : prove(); }

  // Mientras el panel está abierto: prueba cada 4 minutos y al volver a la pestaña
  let timer = null;
  function keepAlive() {
    if (timer) return;
    timer = setInterval(() => { if (!document.hidden) prove().catch(() => {}); }, 4 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !fresh()) prove().catch(() => {}); });
  }

  window.EXE_DEVICE = { bind, prove, ensure, keepAlive };
})();
