-- Revisión de seguridad 29/09 (advisors de Supabase).
revoke execute on function public.fx_apply() from public, anon, authenticated;
revoke execute on function public.products_guard() from public, anon, authenticated;
revoke execute on function public.email_templates_guard() from public, anon, authenticated;
revoke execute on function public.profiles_optin_at() from public, anon, authenticated;
revoke execute on function public.has_perm(text) from anon;
revoke execute on function public.my_permissions() from anon;
alter function public.products_fx_price() set search_path = public;
-- (Aplicado en Supabase como migración seguridad_revision_0929.)
