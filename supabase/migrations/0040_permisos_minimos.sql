-- Auditoría AUD-05 (defensa en profundidad): permisos de tabla mínimos para anon y authenticated.
-- Regla: cada rol conserva SELECT/INSERT/UPDATE/DELETE en una tabla SOLO si existe una política RLS para ese comando
-- (o ALL) que se aplique a ese rol. Lo que hoy funciona no cambia (sin política RLS ya estaba bloqueado);
-- solo se quita el permiso que sobraba. TRUNCATE, REFERENCES y TRIGGER no los usa nunca la web: se quitan siempre.
-- Los permisos por columna (ej. profiles, integrations) no se tocan. Se puede volver a correr sin problema.
do $$
declare t record; r text; c text; ok boolean;
begin
  for t in select c2.relname from pg_class c2 where c2.relnamespace = 'public'::regnamespace and c2.relkind in ('r', 'p') loop
    foreach r in array array['anon', 'authenticated'] loop
      execute format('revoke truncate, references, trigger on public.%I from %I', t.relname, r);
      foreach c in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        select exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                         and p.cmd in (c, 'ALL') and (p.roles @> array['public']::name[] or p.roles @> array[r]::name[])) into ok;
        if not ok then execute format('revoke %s on public.%I from %I', c, t.relname, r); end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Los visitantes sin cuenta (anon) nunca escriben directo en una tabla: todo lo que hacen pasa por funciones
-- (ej. track). Se les quita escribir en todas, aunque una política "public" lo permitiría si has_perm diera true.
do $$
declare t record;
begin
  for t in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') loop
    execute format('revoke insert, update, delete on public.%I from anon', t.relname);
  end loop;
end $$;

-- pg_net fuera del esquema public (aviso de Supabase). Sus funciones siguen en el esquema "net" (net.http_post),
-- que es como las usa _reports_run, así que no cambia nada.
drop extension if exists pg_net;
create extension if not exists pg_net schema extensions;
