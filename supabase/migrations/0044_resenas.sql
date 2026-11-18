-- Reseñas de clientes (reales): solo puede opinar quien compró el producto (pedido pagado, en preparación,
-- enviado o entregado), una vez por producto. Cada reseña queda "pendiente" hasta que EXE la aprueba en el panel
-- (permiso reviews.manage). La tienda y Google ven solo las aprobadas (estrellas en los resultados de búsqueda).
insert into public.permissions (key, description) values
  ('reviews.manage', 'Aprobar, rechazar y ocultar reseñas de clientes')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
  select id, 'reviews.manage' from public.roles where name in ('administrador', 'moderador')
on conflict do nothing;

create table if not exists public.reviews (
  id          bigserial primary key,
  product_id  text not null references public.products(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  order_id    bigint references public.orders(id) on delete set null,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (comment is null or length(comment) <= 1000),
  author      text not null check (length(author) between 1 and 60),   -- nombre e inicial del apellido, se muestra en público
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reply       text check (reply is null or length(reply) <= 1000),     -- respuesta de EXE (opcional)
  created_at  timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id),
  unique (user_id, product_id)
);
create index if not exists reviews_product_ok on public.reviews (product_id) where status = 'approved';
alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;

-- Públicas: solo aprobadas. El autor ve las suyas (aunque estén pendientes). El equipo ve todas.
create policy reviews_ver on public.reviews for select
  using (status = 'approved' or user_id = auth.uid() or public.has_perm('reviews.manage'));

-- Nombre público: nombre + inicial del apellido ("Juan P."), nunca el email
create or replace function public._review_author(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(split_part(coalesce(full_name, ''), ' ', 1)
         || case when split_part(coalesce(full_name, ''), ' ', 2) <> '' then ' ' || left(split_part(full_name, ' ', 2), 1) || '.' else '' end), ''), 'Cliente')
  from profiles where id = p_uid
$$;
revoke all on function public._review_author(uuid) from public, anon, authenticated;

-- El cliente opina (o edita su opinión, que vuelve a quedar pendiente)
create or replace function public.submit_review(p_product text, p_rating int, p_comment text) returns text
language plpgsql security definer set search_path = public as $$
declare v_order bigint;
begin
  if auth.uid() is null then raise exception 'Ingresá a tu cuenta para opinar'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Elegí de 1 a 5 estrellas'; end if;
  select o.id into v_order from orders o join order_items i on i.order_id = o.id
   where o.user_id = auth.uid() and i.product_id = p_product and o.status in ('paid', 'preparing', 'shipped', 'delivered')
   order by o.created_at desc limit 1;
  if v_order is null then raise exception 'Solo pueden opinar quienes compraron este producto'; end if;
  insert into reviews (product_id, user_id, order_id, rating, comment, author)
    values (p_product, auth.uid(), v_order, p_rating, nullif(left(btrim(coalesce(p_comment, '')), 1000), ''),
            coalesce(public._review_author(auth.uid()), 'Cliente'))
  on conflict (user_id, product_id) do update
    set rating = excluded.rating, comment = excluded.comment, status = 'pending', created_at = now(), moderated_at = null, moderated_by = null;
  return 'pending';
end $$;
revoke all on function public.submit_review(text, int, text) from public, anon;
grant execute on function public.submit_review(text, int, text) to authenticated;

-- El equipo aprueba, rechaza o responde
create or replace function public.moderate_review(p_id bigint, p_status text, p_reply text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('reviews.manage') then raise exception 'Sin permiso'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Estado inválido'; end if;
  update reviews set status = p_status, reply = nullif(left(btrim(coalesce(p_reply, '')), 1000), ''),
         moderated_at = now(), moderated_by = auth.uid() where id = p_id;
  if not found then raise exception 'Reseña inexistente'; end if;
end $$;
revoke all on function public.moderate_review(bigint, text, text) from public, anon;
grant execute on function public.moderate_review(bigint, text, text) to authenticated;
