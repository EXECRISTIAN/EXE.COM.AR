-- Grados de estado para productos outlet (usados / reacondicionados), pedido de Cristian 16/11.
--   A = Excelente, B = Muy bueno, C = Bueno, D = No funciona (repuesto, cualquier estado). Vacío (null) = grado general "A a C" mientras no se defina.
alter table public.products add column if not exists grade text check (grade in ('A','B','C','D'));

-- Configuración editable desde el panel (Panel → Grados outlet). Todos pueden leerla (la usa la tienda);
-- solo quien tiene products.write la cambia.
create table if not exists public.outlet_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,          -- sistema de grados prendido / apagado
  ack_enabled boolean not null default true,      -- ventana "Leí y acepto" antes de enviar el pedido
  base_text text not null default 'Producto usado o reacondicionado, con mantenimiento y pruebas de funcionamiento hechas por EXE.',
  warranty_months int not null default 3 check (warranty_months between 0 and 120),
  img_note text not null default 'Las imágenes son ilustrativas: el empaque, el color o detalles menores pueden variar sin afectar las características ni el funcionamiento.',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.outlet_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.outlet_grades (
  code text primary key check (code in ('A','B','C','D','G')),   -- G = general "A a C" (sin grado cargado)
  enabled boolean not null default true,
  in_list boolean not null default true,          -- aparece en "¿Qué significa cada grado?"
  sort int not null default 0,
  name text not null,
  txt text not null,
  list_name text,                                 -- nombre/texto distinto en la lista (si es null, usa los de arriba)
  list_txt text,
  own_base text,                                  -- reemplaza el texto base y la garantía (ej. D: sin garantía)
  updated_at timestamptz not null default now()
);
insert into public.outlet_grades (code, sort, in_list, name, txt, list_name, list_txt, own_base) values
  ('A', 1, true, 'Grado A · Excelente', 'Como nuevo: sin marcas de uso a la vista.', null, null, null),
  ('B', 2, true, 'Grado B · Muy bueno', 'Puede tener alguna marca leve de uso, como pequeños rayones o desgaste, que no afecta el funcionamiento.', null, null, null),
  ('C', 3, true, 'Grado C · Bueno', 'Puede tener marcas de uso visibles o detalles estéticos (rayones, desgaste, alguna tapa o etiqueta faltante). Funciona perfecto.', null, null, null),
  ('G', 4, true, 'Grado A a C · Seleccionado', 'Según la unidad, puede estar entre como nuevo y/o con posibles marcas de uso, visibles o no a simple vista. Todas funcionan perfecto.',
     'Grado A a C · Asignado automáticamente', 'Es el grado que se asigna automáticamente a las unidades que todavía no fueron clasificadas a mano. Según la unidad, puede estar entre como nuevo y/o con posibles marcas de uso, visibles o no a simple vista. Todas funcionan perfecto.', null),
  ('D', 5, false, 'Grado D · No funciona', 'No funciona y puede estar en cualquier estado. Se vende para repuesto o reparación.', null, null, 'Sin garantía de funcionamiento.')
on conflict (code) do nothing;

alter table public.outlet_settings enable row level security;
alter table public.outlet_grades enable row level security;
create policy "outlet_settings_read" on public.outlet_settings for select using (true);
create policy "outlet_grades_read" on public.outlet_grades for select using (true);
create policy "outlet_settings_write" on public.outlet_settings for update to authenticated
  using (public.has_perm('products.write')) with check (public.has_perm('products.write'));
create policy "outlet_grades_write" on public.outlet_grades for update to authenticated
  using (public.has_perm('products.write')) with check (public.has_perm('products.write'));
grant select on public.outlet_settings, public.outlet_grades to anon, authenticated;
grant update on public.outlet_settings, public.outlet_grades to authenticated;
