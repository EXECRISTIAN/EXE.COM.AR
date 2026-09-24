-- =====================================================================
-- EXE — esquema de base de datos (Supabase / PostgreSQL)
-- Usuarios, roles y permisos configurables, productos con stock,
-- pedidos a prueba de manipulación y registro de auditoría.
-- Ejecutar en: Supabase > SQL Editor (o `supabase db push`).
-- =====================================================================

-- ---------- Perfiles (1 por usuario de Supabase Auth) ----------
create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- ---------- Roles y permisos ----------
create table public.permissions (
  key          text primary key,           -- ej: 'orders.read'
  description  text not null
);

create table public.roles (
  id           serial primary key,
  name         text unique not null,       -- ej: 'administrador', 'moderador', 'suscriptor', o cualquiera custom
  description  text,
  is_system    boolean not null default false   -- los de sistema no se pueden borrar
);

create table public.role_permissions (
  role_id         int  references public.roles on delete cascade,
  permission_key  text references public.permissions on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_roles (
  user_id  uuid references public.profiles on delete cascade,
  role_id  int  references public.roles on delete cascade,
  primary key (user_id, role_id)
);

insert into public.permissions (key, description) values
  ('dashboard.access',      'Entrar al panel de administración'),
  ('orders.read',           'Ver todos los pedidos'),
  ('orders.update_status',  'Cambiar estado de pedidos (preparando, enviado, cancelado)'),
  ('orders.mark_paid',      'Marcar un pedido como pagado manualmente (queda auditado)'),
  ('products.read',         'Ver productos inactivos y costos'),
  ('products.write',        'Crear y editar productos y precios'),
  ('stock.write',           'Modificar stock y visibilidad del stock'),
  ('users.read',            'Ver usuarios'),
  ('users.assign_roles',    'Asignar roles a usuarios'),
  ('roles.manage',          'Crear/editar roles y sus permisos'),
  ('emails.manage',         'Editar plantillas de emails automáticos');

insert into public.roles (name, description, is_system) values
  ('administrador', 'Acceso total', true),
  ('moderador',     'Gestiona pedidos y stock', true),
  ('suscriptor',    'Cliente registrado', true);

insert into public.role_permissions (role_id, permission_key)
  select r.id, p.key from public.roles r cross join public.permissions p where r.name = 'administrador';
insert into public.role_permissions (role_id, permission_key)
  select r.id, p from public.roles r,
    unnest(array['dashboard.access','orders.read','orders.update_status','products.read','stock.write']) p
  where r.name = 'moderador';

-- ¿El usuario actual tiene el permiso? (security definer: evita recursión con RLS)
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid() and rp.permission_key = p
  );
$$;

create or replace function public.my_permissions() returns table(permission text)
language sql stable security definer set search_path = public as $$
  select distinct rp.permission_key from user_roles ur
  join role_permissions rp on rp.role_id = ur.role_id
  where ur.user_id = auth.uid();
$$;

-- Alta automática: perfil + rol "suscriptor" al registrarse
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, phone)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone');
  insert into user_roles (user_id, role_id) select new.id, id from roles where name = 'suscriptor';
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Productos y stock ----------
create table public.products (
  id          text primary key,             -- slug, ej: 'cooler-deepcool-ag400-plus'
  name        text not null,
  brand       text,
  category    text,
  description text,
  price       numeric(12,2) not null default 0 check (price >= 0),   -- 0 = "Consultar"
  stock       int not null default 0 check (stock >= 0),              -- nunca puede quedar negativo
  show_stock  boolean not null default true,                          -- mostrar cantidad en la web
  variants    text[],
  image       text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- ---------- Pedidos ----------
create type public.order_status as enum ('pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled');

create table public.orders (
  id           bigserial primary key,
  user_id      uuid references public.profiles,
  status       public.order_status not null default 'pending',
  total        numeric(12,2) not null,
  note         text,
  payment_ref  text,                         -- id de pago de Mercado Pago
  paid_at      timestamptz,
  paid_by      text,                         -- 'mercadopago' o el uuid del admin que lo marcó
  created_at   timestamptz not null default now()
);

create table public.order_items (
  order_id    bigint references public.orders on delete cascade,
  product_id  text references public.products,
  variant     text,
  qty         int not null check (qty > 0),
  unit_price  numeric(12,2) not null,        -- precio copiado del producto AL MOMENTO de la compra
  primary key (order_id, product_id, variant)
);

-- Auditoría: cada cambio de estado queda registrado con quién y cuándo
create table public.order_events (
  id          bigserial primary key,
  order_id    bigint references public.orders on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  actor       text not null,
  created_at  timestamptz not null default now()
);

-- Crear pedido: el precio y el stock los calcula la BASE, no el navegador.
-- items = [{"product_id": "...", "variant": null, "qty": 2}, ...]
create or replace function public.create_order(items jsonb, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_order bigint;
  v_total numeric := 0;
  it jsonb;
  p products%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  if jsonb_array_length(items) = 0 then raise exception 'Pedido vacío'; end if;

  insert into orders (user_id, total, note) values (auth.uid(), 0, p_note) returning id into v_order;

  for it in select * from jsonb_array_elements(items) loop
    select * into p from products where id = it->>'product_id' and active for update;  -- bloquea la fila
    if not found then raise exception 'Producto inexistente: %', it->>'product_id'; end if;
    if (it->>'qty')::int > p.stock then raise exception 'Sin stock suficiente de %', p.name; end if;

    update products set stock = stock - (it->>'qty')::int, updated_at = now() where id = p.id;
    insert into order_items (order_id, product_id, variant, qty, unit_price)
      values (v_order, p.id, it->>'variant', (it->>'qty')::int, p.price);
    v_total := v_total + p.price * (it->>'qty')::int;
  end loop;

  update orders set total = v_total where id = v_order;
  insert into order_events (order_id, to_status, actor) values (v_order, 'pending', auth.uid()::text);
  return v_order;
end $$;

-- Cambiar estado desde el panel. 'paid' exige un permiso aparte y queda auditado.
create or replace function public.set_order_status(p_order bigint, p_status public.order_status) returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.order_status;
begin
  if not has_perm('orders.update_status') then raise exception 'Sin permiso'; end if;
  if p_status = 'paid' and not has_perm('orders.mark_paid') then raise exception 'Sin permiso para marcar pagado'; end if;

  select status into v_old from orders where id = p_order for update;
  if v_old is null then raise exception 'Pedido inexistente'; end if;

  update orders set status = p_status,
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    paid_by = case when p_status = 'paid' then auth.uid()::text else paid_by end
  where id = p_order;

  -- cancelar devuelve el stock
  if p_status = 'cancelled' and v_old <> 'cancelled' then
    update products pr set stock = pr.stock + oi.qty from order_items oi
      where oi.order_id = p_order and oi.product_id = pr.id;
  end if;

  insert into order_events (order_id, from_status, to_status, actor) values (p_order, v_old, p_status, auth.uid()::text);
end $$;

-- ---------- Listados para el panel ----------
create or replace function public.admin_list_users()
returns table(id uuid, email text, full_name text, roles text[])
language sql stable security definer set search_path = public as $$
  select pr.id, pr.email, pr.full_name, coalesce(array_agg(r.name) filter (where r.name is not null), '{}')
  from profiles pr left join user_roles ur on ur.user_id = pr.id left join roles r on r.id = ur.role_id
  where has_perm('users.read')
  group by pr.id order by pr.created_at desc;
$$;

create or replace function public.admin_list_roles()
returns table(id int, name text, perms text[])
language sql stable security definer set search_path = public as $$
  select r.id, r.name, coalesce(array_agg(rp.permission_key) filter (where rp.permission_key is not null), '{}')
  from roles r left join role_permissions rp on rp.role_id = r.id
  where has_perm('roles.manage')
  group by r.id order by r.id;
$$;

-- =====================================================================
-- Row Level Security: la seguridad real. Sin política = acceso denegado.
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.products         enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.order_events     enable row level security;

-- Perfiles: cada uno ve/edita el suyo; staff con users.read ve todos
create policy "perfil propio" on public.profiles for select using (id = auth.uid() or has_perm('users.read'));
create policy "editar perfil propio" on public.profiles for update using (id = auth.uid());

-- Roles/permisos: lectura para gestores; escritura solo con roles.manage / users.assign_roles
create policy "leer permisos" on public.permissions for select using (has_perm('roles.manage'));
create policy "leer roles" on public.roles for select using (has_perm('roles.manage') or has_perm('users.assign_roles'));
create policy "gestionar roles" on public.roles for all using (has_perm('roles.manage')) with check (has_perm('roles.manage'));
create policy "gestionar permisos de rol" on public.role_permissions for all using (has_perm('roles.manage')) with check (has_perm('roles.manage'));
create policy "ver mis roles" on public.user_roles for select using (user_id = auth.uid() or has_perm('users.read'));
create policy "asignar roles" on public.user_roles for all using (has_perm('users.assign_roles')) with check (has_perm('users.assign_roles'));

-- Productos: el público ve los activos; staff ve todos y edita según permiso
create policy "catalogo publico" on public.products for select using (active or has_perm('products.read'));
create policy "editar productos" on public.products for all using (has_perm('products.write') or has_perm('stock.write'))
  with check (has_perm('products.write') or has_perm('stock.write'));

-- Pedidos: SOLO lectura desde el cliente. No hay políticas de insert/update:
-- se crean con create_order() y cambian de estado con set_order_status() o el webhook de pago.
create policy "mis pedidos" on public.orders for select using (user_id = auth.uid() or has_perm('orders.read'));
create policy "items de mis pedidos" on public.order_items for select
  using (exists (select 1 from orders o where o.id = order_id and (o.user_id = auth.uid() or has_perm('orders.read'))));
create policy "auditoria" on public.order_events for select using (has_perm('orders.read'));

-- Sólo el usuario autenticado puede llamar a las funciones de pedidos
revoke execute on function public.create_order(jsonb, text) from public, anon;
revoke execute on function public.set_order_status(bigint, public.order_status) from public, anon;
grant execute on function public.create_order(jsonb, text) to authenticated;
grant execute on function public.set_order_status(bigint, public.order_status) to authenticated;
