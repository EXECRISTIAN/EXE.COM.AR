-- Valores escritos en el panel (marcas, categorías, etiquetas, datos de especificaciones, tiendas…) para
-- sugerirlos al cargar otros productos, aunque el producto original ya no exista o no tenga stock.
create table if not exists public.panel_vocab (
  kind text not null check (char_length(kind) between 1 and 80),
  norm text not null check (char_length(norm) between 1 and 200),
  value text not null check (char_length(value) between 1 and 200),
  uses int not null default 1,
  created_at timestamptz not null default now(),
  primary key (kind, norm)
);
alter table public.panel_vocab enable row level security;
create policy panel_vocab_ver on public.panel_vocab for select to authenticated using (public.has_perm('products.write'));
create policy panel_vocab_agregar on public.panel_vocab for insert to authenticated with check (public.has_perm('products.write'));
