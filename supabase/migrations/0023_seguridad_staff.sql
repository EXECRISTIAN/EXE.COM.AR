-- Seguridad reforzada para administradores y moderadores (09/10/2026, pedido de Cristian)
--
--  · Verificación vigente: el código (o la aprobación por QR) se vuelve a pedir cada 12 h; para acciones
--    críticas (sancionar usuarios, cambiar roles) tiene que tener menos de 30 minutos.
--  · Aprobación por QR: la computadora muestra un QR, un celular ya verificado de la misma cuenta (o de una
--    cuenta vinculada antes) aprueba eligiendo el número de control.
--  · Sesiones: cada uno ve sus sesiones abiertas y puede cerrarlas a distancia. Ninguna sesión dura más de 30 días.
--  · Sesión atada al dispositivo (se activa con security_settings.device_binding): el navegador guarda una llave
--    que no se puede copiar y cada pocos minutos firma una prueba; el panel solo responde desde la conexión
--    que probó tener esa llave. Copiar el "token" a otra computadora no alcanza.
--  · Moderación: banear, suspender por un tiempo, levantar sanciones y cerrar sesiones de usuarios, con historial.

-- ---------- Ajustes ----------
create table if not exists public.security_settings (
  id int primary key default 1 check (id = 1),
  device_binding boolean not null default false,
  staff_reverify_hours int not null default 12 check (staff_reverify_hours between 1 and 168),
  session_max_days int not null default 30 check (session_max_days between 1 and 365)
);
insert into public.security_settings (id) values (1) on conflict do nothing;
alter table public.security_settings enable row level security;

-- ---------- Tablas ----------
create table if not exists public.login_qr (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid not null,
  code smallint not null,
  device text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  decided_at timestamptz,
  decided_by uuid
);
create index if not exists login_qr_session on public.login_qr (session_id, status);
alter table public.login_qr enable row level security;

create table if not exists public.mfa_approvers (
  user_id uuid not null references auth.users on delete cascade,      -- cuenta que entra
  approver_id uuid not null references auth.users on delete cascade,  -- cuenta que puede aprobar desde el celular
  created_at timestamptz not null default now(),
  primary key (user_id, approver_id),
  check (user_id <> approver_id)
);
alter table public.mfa_approvers enable row level security;

create table if not exists public.mfa_link_codes (
  code text primary key,
  user_id uuid not null references auth.users on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.mfa_link_codes enable row level security;

create table if not exists public.session_devices (
  session_id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  pubkey jsonb not null,
  bound_at timestamptz not null default now(),
  last_proof_at timestamptz,
  last_ts bigint not null default 0,
  last_ip text,
  last_ua text
);
alter table public.session_devices enable row level security;

create table if not exists public.user_sanctions (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  action text not null check (action in ('ban', 'suspend', 'logout', 'lift')),
  until timestamptz,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.user_sanctions enable row level security;

create table if not exists public.security_events (
  id bigserial primary key,
  user_id uuid,
  actor uuid,
  event text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.security_events enable row level security;

-- ---------- Ayudantes ----------
create or replace function public._sid() returns uuid language sql stable set search_path = public as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid
$$;
create or replace function public._req_ip() returns text language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
                  btrim(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)))
$$;
create or replace function public._is_staff(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id
                 where ur.user_id = p and rp.permission_key = 'dashboard.access')
$$;
create or replace function public._rank(p uuid) returns int language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id where ur.user_id = p and rp.permission_key = 'roles.manage') then 2
    when public._is_staff(p) then 1 else 0 end
$$;
create or replace function public._log(p_user uuid, p_event text, p_detail jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into security_events (user_id, actor, event, detail) values (p_user, auth.uid(), p_event, p_detail)
$$;
-- Núcleo de la verificación, con los datos explícitos (lo usan la base y las funciones del servidor)
create or replace function public._session_alive_for(p_uid uuid, p_sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null and p_sid is not null
    and exists (select 1 from auth.sessions s where s.id = p_sid and s.user_id = p_uid
                and s.created_at > now() - make_interval(days => (select session_max_days from security_settings where id = 1)))
    and not exists (select 1 from auth.users u where u.id = p_uid and u.banned_until > now())
$$;
create or replace function public._staff_ok_for(p_uid uuid, p_sid uuid, p_aal text, p_ip text, p_minutes int default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s security_settings; v_at timestamptz;
begin
  if not public._session_alive_for(p_uid, p_sid) then return false; end if;
  select * into s from security_settings where id = 1;
  select max(t) into v_at from (
    select greatest(c.created_at, c.updated_at) t from auth.mfa_amr_claims c
      where c.session_id = p_sid and c.authentication_method = 'totp' and coalesce(p_aal, '') = 'aal2'
    union all
    select q.decided_at from login_qr q where q.session_id = p_sid and q.user_id = p_uid and q.status = 'approved'
  ) z;
  if v_at is null or v_at < now() - make_interval(mins => coalesce(p_minutes, s.staff_reverify_hours * 60)) then return false; end if;
  if s.device_binding and not exists (
    select 1 from session_devices d where d.session_id = p_sid and d.user_id = p_uid
      and d.last_proof_at > now() - interval '10 minutes' and d.last_ip is not distinct from p_ip) then
    return false;
  end if;
  return true;
end $$;
-- Para funciones del servidor (Edge Functions): mismo control con la IP real del navegador
create or replace function public._has_perm_for(p_uid uuid, p_sid uuid, p_aal text, p_ip text, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public._staff_ok_for(p_uid, p_sid, p_aal, p_ip) and exists (
    select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id where ur.user_id = p_uid and rp.permission_key = p_perm)
$$;

-- La sesión actual está viva, no venció (30 días) y la cuenta no está suspendida
create or replace function public._session_alive() returns boolean language sql stable security definer set search_path = public as $$
  select public._session_alive_for(auth.uid(), public._sid())
$$;
-- Verificación vigente de la sesión actual (código de la app o aprobación por QR), opcionalmente más estricta
create or replace function public.staff_session_ok(p_minutes int default null) returns boolean
language sql stable security definer set search_path = public as $$
  select public._staff_ok_for(auth.uid(), public._sid(), auth.jwt() ->> 'aal', public._req_ip(), p_minutes)
$$;

-- Permisos: ahora además exigen verificación vigente, sesión viva (y dispositivo si está activado)
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.staff_session_ok() and exists (
    select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid() and rp.permission_key = p)
$$;

-- Estado para la pantalla (qué falta: código, QR, dispositivo)
create or replace function public.staff_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'staff', public._is_staff(auth.uid()),
    'alive', public._session_alive(),
    'verified', public.staff_session_ok(),
    'recent', public.staff_session_ok(30),
    'device_binding', (select device_binding from security_settings where id = 1),
    'device_bound', exists (select 1 from session_devices d where d.session_id = public._sid() and d.user_id = auth.uid()),
    'reverify_hours', (select staff_reverify_hours from security_settings where id = 1))
$$;

-- ---------- Aprobación por QR ----------
create or replace function public.qr_start(p_device text) returns table (token uuid, code smallint, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public._session_alive() then raise exception 'Iniciá sesión de nuevo'; end if;
  if not public._is_staff(auth.uid()) then raise exception 'La aprobación con el celular es solo para el equipo'; end if;
  if (select count(*) from login_qr q where q.user_id = auth.uid() and q.created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Demasiados intentos. Esperá unos minutos.';
  end if;
  update login_qr q set status = 'expired' where q.session_id = public._sid() and q.status = 'pending';
  return query insert into login_qr (user_id, session_id, code, device)
    values (auth.uid(), public._sid(), (10 + get_byte(extensions.gen_random_bytes(1), 0) % 90)::smallint, left(p_device, 160))
    returning login_qr.token, login_qr.code, login_qr.expires_at;
end $$;

create or replace function public.qr_status(p_token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare q login_qr;
begin
  select * into q from login_qr where token = p_token and user_id = auth.uid() and session_id = public._sid();
  if not found then return 'missing'; end if;
  if q.status = 'pending' and q.expires_at < now() then
    update login_qr set status = 'expired' where token = p_token; return 'expired';
  end if;
  return q.status;
end $$;

-- Quién puede aprobar: la misma cuenta o una vinculada antes, desde una sesión con la verificación de la app hecha
create or replace function public._approver_ok(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public._session_alive() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and (auth.uid() = p_owner or exists (select 1 from mfa_approvers a where a.user_id = p_owner and a.approver_id = auth.uid()))
$$;

create or replace function public.qr_view(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q login_qr; c int[]; x int;
begin
  select * into q from login_qr where token = p_token;
  if not found or q.status <> 'pending' or q.expires_at < now() then raise exception 'Este QR ya no es válido. Generá uno nuevo en la computadora.'; end if;
  if not public._approver_ok(q.user_id) then raise exception 'Esta cuenta no puede aprobar ese ingreso'; end if;
  c := array[q.code];
  while array_length(c, 1) < 3 loop
    x := 10 + get_byte(extensions.gen_random_bytes(1), 0) % 90;
    if not x = any (c) then c := c || x; end if;
  end loop;
  return jsonb_build_object('email', (select email from auth.users where id = q.user_id), 'device', q.device,
    'created_at', q.created_at, 'expires_at', q.expires_at,
    'choices', (select jsonb_agg(v order by md5(v::text || q.token::text)) from unnest(c) v));
end $$;

create or replace function public.qr_decide(p_token uuid, p_code int, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare q login_qr;
begin
  select * into q from login_qr where token = p_token for update;
  if not found or q.status <> 'pending' or q.expires_at < now() then raise exception 'Este QR ya no es válido. Generá uno nuevo en la computadora.'; end if;
  if not public._approver_ok(q.user_id) then raise exception 'Esta cuenta no puede aprobar ese ingreso'; end if;
  if p_approve and p_code is distinct from q.code then
    update login_qr set status = 'rejected', decided_at = now(), decided_by = auth.uid() where token = p_token;
    perform public._log(q.user_id, 'qr_wrong_code', jsonb_build_object('device', q.device));
    return 'wrong_code';
  end if;
  update login_qr set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid() where token = p_token;
  perform public._log(q.user_id, case when p_approve then 'qr_approved' else 'qr_rejected' end, jsonb_build_object('device', q.device));
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- ---------- Cuentas que pueden aprobar ----------
create or replace function public.approver_link_start() returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not (public._session_alive() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and public._is_staff(auth.uid())) then
    raise exception 'Hace falta la verificación en dos pasos de esta cuenta';
  end if;
  delete from mfa_link_codes where user_id = auth.uid() or expires_at < now();
  v := upper(encode(extensions.gen_random_bytes(4), 'hex'));
  insert into mfa_link_codes (code, user_id) values (v, auth.uid());
  return v;
end $$;

create or replace function public.approver_link_confirm(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare l mfa_link_codes;
begin
  if not (public._session_alive() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2') then
    raise exception 'Hace falta la verificación en dos pasos de esta cuenta';
  end if;
  delete from mfa_link_codes where code = upper(btrim(p_code)) and expires_at > now() returning * into l;
  if l.user_id is null then raise exception 'Código incorrecto o vencido'; end if;
  if l.user_id = auth.uid() then raise exception 'Usá otra cuenta para vincular'; end if;
  insert into mfa_approvers (user_id, approver_id) values (l.user_id, auth.uid()) on conflict do nothing;
  perform public._log(l.user_id, 'approver_linked', jsonb_build_object('approver', auth.uid()));
  return (select email from auth.users where id = l.user_id);
end $$;

create or replace function public.approver_list() returns table (other uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.approver_id, u.email, 'aprueba mis ingresos', a.created_at from mfa_approvers a join auth.users u on u.id = a.approver_id where a.user_id = auth.uid()
  union all
  select a.user_id, u.email, 'yo apruebo sus ingresos', a.created_at from mfa_approvers a join auth.users u on u.id = a.user_id where a.approver_id = auth.uid()
$$;

create or replace function public.approver_remove(p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._session_alive() then raise exception 'Iniciá sesión de nuevo'; end if;
  delete from mfa_approvers where (user_id = auth.uid() and approver_id = p_other) or (approver_id = auth.uid() and user_id = p_other);
  perform public._log(auth.uid(), 'approver_removed', jsonb_build_object('other', p_other));
end $$;

-- ---------- Mis sesiones (cerrar a distancia) ----------
create or replace function public.my_sessions() returns table (id uuid, created_at timestamptz, last_seen timestamptz, user_agent text, ip text, current boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, greatest(s.updated_at, s.refreshed_at at time zone 'UTC'), s.user_agent, host(s.ip), s.id = public._sid()
  from auth.sessions s where s.user_id = auth.uid() order by 3 desc nulls last
$$;

create or replace function public._can_manage_own_sessions() returns boolean
language sql stable security definer set search_path = public as $$
  -- con la verificación en dos pasos activada, cerrar otras sesiones pide haberla pasado en esta
  select public._session_alive() and (
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2' or public.staff_session_ok()
    or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'))
$$;

create or replace function public.revoke_my_session(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._can_manage_own_sessions() then raise exception 'Verificá tu identidad para cerrar otras sesiones'; end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  perform public._log(auth.uid(), 'session_revoked', jsonb_build_object('session', p_id));
end $$;

create or replace function public.revoke_my_other_sessions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public._can_manage_own_sessions() then raise exception 'Verificá tu identidad para cerrar otras sesiones'; end if;
  delete from auth.sessions where user_id = auth.uid() and id <> public._sid();
  get diagnostics n = row_count;
  perform public._log(auth.uid(), 'sessions_revoked_others', jsonb_build_object('count', n));
  return n;
end $$;

-- ---------- Moderación de usuarios ----------
insert into public.permissions (key, description) values ('users.moderate', 'Banear, suspender y cerrar sesiones de usuarios')
  on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
  select r.id, p from public.roles r, unnest(array['users.moderate', 'users.read']) p
  where r.name in ('administrador', 'moderador') on conflict do nothing;

create or replace function public.admin_sanction(p_user uuid, p_action text, p_minutes int default null, p_reason text default null)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if not public.has_perm('users.moderate') then raise exception 'Sin permiso'; end if;
  if not public.staff_session_ok(30) then raise exception 'REVERIFY: Por seguridad, confirmá de nuevo tu identidad para esta acción'; end if;
  if p_user = auth.uid() then raise exception 'No podés aplicarte una sanción a vos mismo'; end if;
  if public._rank(auth.uid()) <= public._rank(p_user) then raise exception 'No podés sancionar a alguien con un rol igual o superior al tuyo'; end if;
  if p_action not in ('ban', 'suspend', 'logout', 'lift') then raise exception 'Acción inválida'; end if;
  if p_action = 'suspend' and (p_minutes is null or p_minutes < 1 or p_minutes > 5256000) then raise exception 'Duración inválida'; end if;

  v_until := case p_action when 'ban' then now() + interval '100 years' when 'suspend' then now() + make_interval(mins => p_minutes) end;
  if p_action in ('ban', 'suspend') then update auth.users set banned_until = v_until where id = p_user; end if;
  if p_action = 'lift' then update auth.users set banned_until = null where id = p_user; end if;
  if p_action in ('ban', 'suspend', 'logout') then
    delete from auth.sessions where user_id = p_user;
    update login_qr set status = 'expired' where user_id = p_user and status = 'pending';
  end if;
  insert into user_sanctions (user_id, action, until, reason, created_by) values (p_user, p_action, v_until, left(p_reason, 500), auth.uid());
  perform public._log(p_user, 'sanction_' || p_action, jsonb_build_object('until', v_until, 'reason', left(p_reason, 500)));
  return v_until;
end $$;

create or replace function public.admin_user_history(p_user uuid) returns table (action text, until timestamptz, reason text, by_email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.action, s.until, s.reason, u.email, s.created_at from user_sanctions s left join auth.users u on u.id = s.created_by
  where s.user_id = p_user and public.has_perm('users.moderate') order by s.created_at desc limit 50
$$;

-- Lista de usuarios con el estado de sanción y las sesiones abiertas
create or replace function public.admin_users_list() returns table (
  id uuid, email text, full_name text, phone text, created_at timestamptz, last_sign_in_at timestamptz, verified boolean, mfa boolean,
  orders bigint, last_order_at timestamptz, roles text[], banned_until timestamptz, sessions bigint, rank int)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.email, pr.full_name, pr.phone, pr.created_at, u.last_sign_in_at,
         (pr.email_verified_at is not null or u.email_confirmed_at is not null),
         exists (select 1 from auth.mfa_factors f where f.user_id = pr.id and f.status = 'verified'),
         (select count(*) from orders o where o.user_id = pr.id),
         (select max(o.created_at) from orders o where o.user_id = pr.id),
         coalesce((select array_agg(r.name order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = pr.id), '{}'),
         case when u.banned_until > now() then u.banned_until end,
         (select count(*) from auth.sessions s where s.user_id = pr.id),
         public._rank(pr.id)
  from profiles pr left join auth.users u on u.id = pr.id
  where public.has_perm('users.read')
  order by pr.created_at desc
$$;

-- ---------- Sesión atada al dispositivo (lo usa la función "dispositivo" con la clave de servicio) ----------
create or replace function public._device_get(p_uid uuid, p_sid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pubkey', d.pubkey, 'last_ts', d.last_ts) from session_devices d where d.session_id = p_sid and d.user_id = p_uid
$$;
create or replace function public._device_bind(p_uid uuid, p_sid uuid, p_pubkey jsonb, p_ip text, p_ua text) returns text
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if not exists (select 1 from auth.sessions s where s.id = p_sid and s.user_id = p_uid) then return 'no_session'; end if;
  if exists (select 1 from session_devices where session_id = p_sid) then return 'already_bound'; end if;
  -- Solo se puede atar justo después de verificar (código o QR) en esa misma sesión
  select max(t) into v_at from (
    select greatest(c.created_at, c.updated_at) t from auth.mfa_amr_claims c where c.session_id = p_sid and c.authentication_method = 'totp'
    union all select q.decided_at from login_qr q where q.session_id = p_sid and q.user_id = p_uid and q.status = 'approved') z;
  if v_at is null or v_at < now() - interval '10 minutes' then return 'verify_first'; end if;
  insert into session_devices (session_id, user_id, pubkey, last_proof_at, last_ip, last_ua) values (p_sid, p_uid, p_pubkey, now(), p_ip, left(p_ua, 300));
  insert into security_events (user_id, actor, event, detail) values (p_uid, p_uid, 'device_bound', jsonb_build_object('ip', p_ip));
  return 'ok';
end $$;
create or replace function public._device_touch(p_uid uuid, p_sid uuid, p_ts bigint, p_ip text, p_ua text) returns text
language plpgsql security definer set search_path = public as $$
begin
  update session_devices set last_proof_at = now(), last_ts = p_ts, last_ip = p_ip, last_ua = left(p_ua, 300)
    where session_id = p_sid and user_id = p_uid and p_ts > last_ts;
  return case when found then 'ok' else 'replay' end;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public._device_get(uuid, uuid), public._device_bind(uuid, uuid, jsonb, text, text),
  public._device_touch(uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public._device_get(uuid, uuid), public._device_bind(uuid, uuid, jsonb, text, text),
  public._device_touch(uuid, uuid, bigint, text, text) to service_role;
revoke execute on function public._log(uuid, text, jsonb), public._rank(uuid), public._is_staff(uuid),
  public._session_alive_for(uuid, uuid), public._staff_ok_for(uuid, uuid, text, text, int), public._has_perm_for(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._has_perm_for(uuid, uuid, text, text, text) to service_role;
revoke execute on function public.staff_status(), public.qr_start(text), public.qr_status(uuid), public.qr_view(uuid),
  public.qr_decide(uuid, int, boolean), public.approver_link_start(), public.approver_link_confirm(text), public.approver_list(),
  public.approver_remove(uuid), public.my_sessions(), public.revoke_my_session(uuid), public.revoke_my_other_sessions(),
  public.admin_sanction(uuid, text, int, text), public.admin_user_history(uuid), public.admin_users_list() from public, anon;
grant execute on function public.staff_status(), public.qr_start(text), public.qr_status(uuid), public.qr_view(uuid),
  public.qr_decide(uuid, int, boolean), public.approver_link_start(), public.approver_link_confirm(text), public.approver_list(),
  public.approver_remove(uuid), public.my_sessions(), public.revoke_my_session(uuid), public.revoke_my_other_sessions(),
  public.admin_sanction(uuid, text, int, text), public.admin_user_history(uuid), public.admin_users_list() to authenticated;

-- Lectura para el panel (historial de seguridad y ajustes)
create policy security_events_ver on public.security_events for select to authenticated using (public.has_perm('users.moderate'));
create policy security_settings_ver on public.security_settings for select to authenticated using (public.has_perm('roles.manage'));
create policy security_settings_editar on public.security_settings for update to authenticated
  using (public.has_perm('roles.manage') and public.staff_session_ok(30)) with check (public.has_perm('roles.manage') and public.staff_session_ok(30));

-- Cambiar roles es crítico: verificación de menos de 30 minutos
alter policy "asignar roles" on public.user_roles
  using (public.has_perm('users.assign_roles') and public.staff_session_ok(30))
  with check (public.has_perm('users.assign_roles') and public.staff_session_ok(30));

-- ---------- Limpieza automática: sesiones de más de 30 días y QR/códigos viejos ----------
select cron.schedule('seguridad-limpieza', '17 * * * *', $$
  delete from auth.sessions where created_at < now() - make_interval(days => (select session_max_days from public.security_settings where id = 1));
  delete from public.login_qr where created_at < now() - interval '30 days';
  delete from public.mfa_link_codes where expires_at < now();
  delete from public.session_devices d where not exists (select 1 from auth.sessions s where s.id = d.session_id);
$$);
