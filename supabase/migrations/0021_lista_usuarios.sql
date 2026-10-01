-- Panel → Usuarios: lista completa (solo users.read). Datos de contacto, alta, último ingreso,
-- email confirmado, verificación en dos pasos, pedidos y roles. Más los clientes anteriores (WordPress).
create or replace function public.admin_users_full()
returns table(id uuid, email text, full_name text, phone text, created_at timestamptz, last_sign_in_at timestamptz,
              verified boolean, mfa boolean, orders bigint, last_order_at timestamptz, roles text[])
language sql stable security definer set search_path to 'public' as $$
  select pr.id, pr.email, pr.full_name, pr.phone, pr.created_at, u.last_sign_in_at,
         (pr.email_verified_at is not null or u.email_confirmed_at is not null),
         exists (select 1 from auth.mfa_factors f where f.user_id = pr.id and f.status = 'verified'),
         (select count(*) from orders o where o.user_id = pr.id),
         (select max(o.created_at) from orders o where o.user_id = pr.id),
         coalesce((select array_agg(r.name order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = pr.id), '{}')
  from profiles pr left join auth.users u on u.id = pr.id
  where has_perm('users.read')
  order by pr.created_at desc;
$$;
revoke all on function public.admin_users_full() from public, anon;
grant execute on function public.admin_users_full() to authenticated;

create or replace function public.admin_legacy_customers()
returns table(email text, full_name text, phone text, city text, last_order_at timestamptz, claimed boolean)
language sql stable security definer set search_path to 'public' as $$
  select lc.email, lc.full_name, lc.phone, lc.city, lc.last_order_at, lc.claimed_by is not null
  from legacy_customers lc where has_perm('users.read') order by lc.last_order_at desc nulls last;
$$;
revoke all on function public.admin_legacy_customers() from public, anon;
grant execute on function public.admin_legacy_customers() to authenticated;
