-- Pruebas de seguridad de la base (solo lectura: todo corre dentro de una transacción que se deshace al final).
-- Simulan a un visitante sin cuenta (anon) y a un cliente registrado cualquiera (authenticated, sin roles)
-- e intentan lo que NO deberían poder hacer. Si algo pasa que no debería, la prueba falla con un error claro.
-- Uso: correr el archivo completo en el SQL Editor de Supabase (o psql). Resultado esperado: un aviso "RESULTADO OK: N pruebas superadas"
-- (se informa como error a propósito, así la transacción se deshace siempre). Cualquier otro mensaje es una falla.
begin;

create temp table _t (n int);
insert into _t values (0);
grant all on _t to anon, authenticated;

-- Bloqueado = da error de permiso, o no afecta ninguna fila (así responde RLS a un UPDATE/DELETE sin permiso)
create or replace function pg_temp.must_fail(sql text, what text) returns void language plpgsql as $$
declare rc bigint;
begin
  begin execute sql; get diagnostics rc = row_count;
  exception when insufficient_privilege or raise_exception or check_violation or with_check_option_violation or invalid_authorization_specification then
    update _t set n = n + 1; return;
  end;
  if rc = 0 and sql !~* '^\s*select' then update _t set n = n + 1; return; end if;
  raise exception 'FALLA DE SEGURIDAD: %', what;
end $$;
create or replace function pg_temp.must_be_zero(sql text, what text) returns void language plpgsql as $$
declare c bigint;
begin
  begin execute sql into c;
  exception when insufficient_privilege then update _t set n = n + 1; return;   -- ni siquiera puede consultar: mejor todavía
  end;
  if c <> 0 then raise exception 'FALLA DE SEGURIDAD: % (% filas visibles)', what, c; end if;
  update _t set n = n + 1;
end $$;
grant execute on function pg_temp.must_fail(text, text), pg_temp.must_be_zero(text, text) to anon, authenticated;

-- ===== Visitante sin cuenta =====
set local role anon;
select pg_temp.must_be_zero('select count(*) from orders', 'un visitante ve pedidos');
select pg_temp.must_be_zero('select count(*) from order_items', 'un visitante ve ítems de pedidos');
select pg_temp.must_be_zero('select count(*) from profiles', 'un visitante ve perfiles');
select pg_temp.must_be_zero('select count(*) from user_roles', 'un visitante ve roles de usuarios');
select pg_temp.must_be_zero('select count(*) from product_costs', 'un visitante ve costos');
select pg_temp.must_be_zero('select count(*) from expenses', 'un visitante ve gastos');
select pg_temp.must_be_zero('select count(*) from promo_codes', 'un visitante ve códigos de descuento');
select pg_temp.must_be_zero('select count(*) from analytics_events', 'un visitante ve la analítica');
select pg_temp.must_be_zero('select count(*) from legacy_customers', 'un visitante ve clientes');
select pg_temp.must_fail($$update products set price = 1$$, 'un visitante cambia precios');
select pg_temp.must_fail($$insert into products (id, name) values ('x-test', 'x')$$, 'un visitante crea productos');
select pg_temp.must_fail($$delete from products$$, 'un visitante borra productos');
select pg_temp.must_fail($$insert into user_roles (user_id, role_id) select gen_random_uuid(), id from roles limit 1$$, 'un visitante se asigna un rol');
select pg_temp.must_fail($$insert into storage.objects (bucket_id, name) values ('productos', 'x-test.webp')$$, 'un visitante sube fotos');
select pg_temp.must_be_zero('select count(*) from public.admin_list_users()', 'un visitante lista usuarios');   -- sin permiso: error o lista vacía
select pg_temp.must_fail($$select public.set_order_status(1, 'paid')$$, 'un visitante marca un pedido como pagado');
select pg_temp.must_fail($$select public._session_alive()$$, 'un visitante llama funciones internas');
do $$ begin if (select count(*) from products) = 0 then raise exception 'REGRESIÓN: el catálogo público no se ve'; end if; end $$;
update _t set n = n + 1;

-- ===== Cliente registrado sin roles (usuario inventado) =====
reset role;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
set local role authenticated;
select pg_temp.must_be_zero('select count(*) from orders', 'un cliente ve pedidos ajenos');
select pg_temp.must_be_zero('select count(*) from profiles', 'un cliente ve perfiles ajenos');
select pg_temp.must_be_zero('select count(*) from product_costs', 'un cliente ve costos');
select pg_temp.must_be_zero('select count(*) from promo_codes', 'un cliente ve códigos de descuento');
select pg_temp.must_fail($$update products set price = 1$$, 'un cliente cambia precios');
select pg_temp.must_fail($$insert into user_roles (user_id, role_id) select (current_setting('request.jwt.claims')::json->>'sub')::uuid, id from roles where name = 'administrador'$$, 'un cliente se hace administrador');
select pg_temp.must_be_zero('select count(*) from public.admin_list_users()', 'un cliente lista usuarios');   -- sin permiso: error o lista vacía
select pg_temp.must_fail($$select public.set_order_status(1, 'paid')$$, 'un cliente marca un pedido como pagado');
select pg_temp.must_fail($$select public.admin_create_order('{}'::jsonb, '[]'::jsonb, 0, 1, null)$$, 'un cliente crea pedidos manuales');
select pg_temp.must_fail($$insert into storage.objects (bucket_id, name) values ('productos', 'x-test.webp')$$, 'un cliente sube fotos');

-- ===== Estructura =====
reset role;
do $$ begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
    then raise exception 'FALLA DE SEGURIDAD: hay tablas sin RLS'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))
    then raise exception 'FALLA DE SEGURIDAD: un visitante tiene permiso de escritura en alguna tabla'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%'))
    then raise exception 'FALLA DE SEGURIDAD: función con permisos elevados sin search_path fijo'; end if;
end $$;
update _t set n = n + 1;

-- Fin: se informa el resultado y se deshace todo (nada queda escrito)
do $$ begin raise exception 'RESULTADO OK: % pruebas superadas (todo se deshizo)', (select n from _t); end $$;
rollback;
