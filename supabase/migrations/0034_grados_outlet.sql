-- Grados de estado para productos outlet (usados / reacondicionados), pedido de Cristian 16/11.
--   A = Excelente, B = Muy bueno, C = Bueno. Vacío (null) = grado general "A a C" mientras no se defina.
alter table public.products add column if not exists grade text check (grade in ('A','B','C'));
