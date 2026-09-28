-- Plantillas de email editables desde el panel (Emails automáticos). Solo emails.manage (RLS).
-- Las del sistema (una por evento del pedido) no se borran ni cambian de evento; se editan o desactivan.
-- La Edge Function send-email usa la activa más reciente de cada evento (fallback: plantillas fijas de _shared/emails.js).
-- (Aplicado en Supabase como migración email_templates; ver el contenido completo y los textos iniciales allí.)
create table if not exists public.email_templates (
  id text primary key check (id ~ '^[a-z0-9_-]{2,40}$'),
  name text not null,
  event text not null default 'manual' check (event in ('order_created','order_paid','order_shipped','order_delivered','order_cancelled','admin_new_order','manual')),
  subject text not null, preheader text, title text not null, body text not null,
  button_label text, button_url text, show_items boolean not null default false, why text,
  active boolean not null default true, system boolean not null default false, updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
create policy email_templates_admin on public.email_templates for all to authenticated
  using (public.has_perm('emails.manage')) with check (public.has_perm('emails.manage'));
revoke all on public.email_templates from anon;

-- Más eventos (recordatorio de pago, pedir opinión, bienvenida, cliente inactivo, volvió el stock, bajó el precio,
-- ofertas, fechas especiales, reapertura, cierre temporal) y condiciones: delay_days, send_at, audience, min_total, category.
-- Consentimiento para publicidad: profiles.marketing_opt_in (+ _at), editable por el propio usuario.
-- (Aplicado en Supabase como migración email_eventos_condiciones.)

-- Estados del pedido con plantilla propia: en proceso, pago en proceso, pago procesado y verificado (order_paid), en preparación,
-- embalado, despachado, entregado al servicio de envío, entregado, listo para retirar (punto de retiro / local).
-- (Aplicado en Supabase como migración email_estados_pedido.)
