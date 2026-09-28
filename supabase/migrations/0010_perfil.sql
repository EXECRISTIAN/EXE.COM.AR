-- Los usuarios solo pueden editar nombre y teléfono de su propio perfil.
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
