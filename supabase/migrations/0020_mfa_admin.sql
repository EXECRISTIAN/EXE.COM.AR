-- Verificación en dos pasos obligatoria para administrar (aplicada el 30/09/2026).
-- has_perm solo da permisos si la sesión pasó el segundo paso (JWT con aal = 'aal2').
-- Así, una sesión o contraseña robadas de un administrador no sirven para tocar nada.
-- my_permissions sigue devolviendo los permisos (la web los usa para pedir la verificación).
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and exists (
    select 1 from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid() and rp.permission_key = p
  );
$$;
