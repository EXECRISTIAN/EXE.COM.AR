// Sesión atada al dispositivo (administradores y moderadores).
// El navegador crea una llave ECDSA P-256 que NO se puede exportar (WebCrypto, guardada en IndexedDB) y:
//   bind  { pubkey (JWK pública), ts, sig } → ata la sesión a esa llave (solo justo después de verificar con código o QR)
//   proof { ts, sig }                       → prueba firmada cada pocos minutos; registra desde qué conexión llega
// La firma es sobre "<session_id>|<ts>". Quien copie el token a otra computadora no tiene la llave y no puede
// probar nada, así que la base (has_perm) no le da permisos. Deploy: supabase functions deploy dispositivo
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { clientIp, sessionOf } from "../_shared/sesion.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function verify(jwk: JsonWebKey, msg: string, sig: string) {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || jwk.d) return false;  // solo llaves públicas P-256
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64(sig), new TextEncoder().encode(msg));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const ses = await sessionOf(req, admin);
    if (!ses) return json({ error: "Sesión inválida" }, 401);
    const body = await req.json();
    const ts = Number(body.ts), sig = String(body.sig || "");
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60_000) return json({ error: "Hora del equipo desfasada" }, 400);
    const msg = `${ses.sid}|${ts}`, ip = clientIp(req), ua = req.headers.get("user-agent") ?? "";

    if (body.action === "bind") {
      if (!(await verify(body.pubkey, msg, sig))) return json({ error: "Firma inválida" }, 400);
      const { data, error } = await admin.rpc("_device_bind", { p_uid: ses.uid, p_sid: ses.sid, p_pubkey: { kty: "EC", crv: "P-256", x: body.pubkey.x, y: body.pubkey.y }, p_ip: ip, p_ua: ua });
      if (error) throw error;
      return json({ result: data }, data === "ok" ? 200 : 409);
    }
    if (body.action === "proof") {
      const { data: d, error } = await admin.rpc("_device_get", { p_uid: ses.uid, p_sid: ses.sid });
      if (error) throw error;
      if (!d) return json({ result: "not_bound" }, 409);
      if (!(await verify(d.pubkey, msg, sig))) return json({ result: "bad_signature" }, 403);
      const { data: t, error: e2 } = await admin.rpc("_device_touch", { p_uid: ses.uid, p_sid: ses.sid, p_ts: ts, p_ip: ip, p_ua: ua });
      if (e2) throw e2;
      return json({ result: t }, t === "ok" ? 200 : 409);
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
