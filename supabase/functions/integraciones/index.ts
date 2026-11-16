// Estado de las integraciones para Panel → Integraciones (permiso integrations.manage).
// Acciones: { } → estado · { action: "enable", key } → prende la integración si está completa.
// Dice qué secrets están cargados (SOLO sí/no, nunca el valor) y si cada integración está lista para prenderse.
// Deploy: supabase functions deploy integraciones --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { requirePermFor } from "../_shared/sesion.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Secrets obligatorios de cada integración (si cambia alguna integración, actualizar SOLO esta lista y docs/INTEGRACIONES.md)
const NEEDS: Record<string, string[]> = {
  envios: ["ENVIA_TOKEN"],
  mercadopago: ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"],
  arca: ["ARCA_CERT", "ARCA_KEY"],
};
const OPTIONAL = ["RESEND_API_KEY", "EMAIL_FROM", "ADMIN_EMAIL"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    await requirePermFor(req, db, "integrations.manage");
    const body = await req.json().catch(() => ({}));
    const secrets = Object.fromEntries([...Object.values(NEEDS).flat(), ...OPTIONAL].map((k) => [k, !!env(k)]));
    const ready = Object.fromEntries(Object.entries(NEEDS).map(([k, list]) => [k, list.every((s) => secrets[s])]));
    // Prender: solo si están todas las claves (apagar se puede directo desde el panel).
    if (body.action === "enable") {
      const key = String(body.key ?? "");
      if (!(key in NEEDS)) return json({ error: "Integración desconocida" }, 400);
      if (!ready[key]) return json({ error: "Faltan claves: " + NEEDS[key].filter((s) => !secrets[s]).join(", ") }, 409);
      const { data: row } = await db.from("integrations").select("config").eq("key", key).maybeSingle();
      const c = row?.config || {};
      if (key === "arca" && !/^\d{11}$/.test(String(c.cuit || "").replace(/\D/g, ""))) return json({ error: "Falta el CUIT" }, 409);
      if (key === "envios" && !(c.origin && c.origin.postalCode) && !env("ENVIA_ORIGEN")) return json({ error: "Falta la dirección de despacho" }, 409);
      const { error } = await db.from("integrations").update({ enabled: true }).eq("key", key);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ secrets, ready, needs: NEEDS });
  } catch (e) {
    return json({ error: (e as Error).message }, (e as any).status || 500);
  }
});
