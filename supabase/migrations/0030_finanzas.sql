-- Finanzas (pedido de Cristian, 21/10): Estado de resultados mensual.
-- · Módulos financieros activables y desactivables por partes (finance_modules). Hoy existe "resultados";
--   "facturacion" (ARCA / monotributo / régimen general) y "reportes" (automáticos) quedan reservados, apagados.
-- · Gastos cargados a mano por mes y categoría (expenses). Ventas y costo de lo vendido salen de los pedidos.
-- · Todo requiere el permiso finance.manage (solo administradores) + verificación en dos pasos (has_perm).

insert into public.permissions (key, description) values
  ('finance.manage', 'Finanzas: estado de resultados, gastos y módulos financieros')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
  select r.id, 'finance.manage' from public.roles r where r.name = 'administrador'
on conflict do nothing;

create table if not exists public.finance_modules (
  key text primary key check (key in ('resultados', 'facturacion', 'reportes')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
insert into public.finance_modules (key, enabled) values ('resultados', true), ('facturacion', false), ('reportes', false)
on conflict (key) do nothing;

create table if not exists public.expenses (
  id bigserial primary key,
  month date not null check (extract(day from month) = 1),
  category text not null check (length(btrim(category)) between 1 and 40),
  description text check (description is null or length(description) <= 200),
  amount numeric not null check (amount > 0 and amount < 1e12),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists expenses_month on public.expenses (month);

alter table public.finance_modules enable row level security;
alter table public.expenses enable row level security;
revoke all on public.finance_modules, public.expenses from anon;
revoke insert, delete on public.finance_modules from authenticated;   -- los módulos solo se prenden o apagan

drop policy if exists "finance_modules_admin" on public.finance_modules;
create policy "finance_modules_admin" on public.finance_modules for all to authenticated
  using (public.has_perm('finance.manage')) with check (public.has_perm('finance.manage'));
drop policy if exists "expenses_admin" on public.expenses;
create policy "expenses_admin" on public.expenses for all to authenticated
  using (public.has_perm('finance.manage')) with check (public.has_perm('finance.manage'));
