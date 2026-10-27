-- Compatibilidad entre productos (pedido de Cristian, 27/10). Claves cortas como "LGA1200", "AM4" o "DDR4":
-- dos productos de distinta categoría que comparten una clave se muestran como compatibles en la ficha.
alter table public.products add column if not exists compat text[] not null default '{}';

-- Carga inicial a partir del nombre (después se edita en el panel).
update public.products set compat = array(select distinct k from unnest(array[
  case when name ~* 'lga ?1200' then 'LGA1200' end,
  case when name ~* 'lga ?1151' then 'LGA1151' end,
  case when name ~* '(lga|socket) ?1700' then 'LGA1700' end,
  case when name ~* '\mAM4\M' or name ~* 'ryzen 5 2600' then 'AM4' end,
  case when name ~* '\mAM5\M' then 'AM5' end,
  case when name ~* 'ddr4' then 'DDR4' end,
  case when name ~* 'ddr5' then 'DDR5' end]) k where k is not null)
where compat = '{}';
-- Mothers: memoria según socket (las LGA1151/1200 y AM4 usan DDR4; AM5, DDR5)
update public.products set compat = compat || 'DDR4'::text
  where category = 'Motherboards' and compat && array['LGA1151','LGA1200','AM4'] and not 'DDR4' = any(compat);
update public.products set compat = compat || 'DDR5'::text
  where category = 'Motherboards' and 'AM5' = any(compat) and not 'DDR5' = any(compat);
