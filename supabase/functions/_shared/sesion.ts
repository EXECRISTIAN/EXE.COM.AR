// Ayudantes de sesión para las funciones del servidor.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

// IP real del navegador (la pone Cloudflare; el navegador no la puede falsificar)
export const clientIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

// Valida el token con Supabase Auth y devuelve usuario, sesión y nivel de verificación
export async function sessionOf(req: Request, admin: SupabaseClient) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  if (claims.sub !== data.user.id || !claims.session_id) return null;
  return { uid: data.user.id as string, sid: claims.session_id as string, aal: String(claims.aal || "") };
}

// Mismo control que has_perm en la base, pero con la IP real del navegador (una llamada desde el servidor
// llegaría a la base con la IP del servidor y no pasaría el control del dispositivo)
export async function requirePermFor(req: Request, admin: SupabaseClient, perm: string) {
  const ses = await sessionOf(req, admin);
  const { data } = ses
    ? await admin.rpc("_has_perm_for", { p_uid: ses.uid, p_sid: ses.sid, p_aal: ses.aal, p_ip: clientIp(req), p_perm: perm })
    : { data: false };
  if (data !== true) throw Object.assign(new Error("Sin permiso (verificá tu identidad de nuevo)"), { status: 403 });
}
