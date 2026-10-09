-- La ✕ de las listas de sugerencias oculta una opción mal escrita (aunque siga en algún producto viejo).
alter table public.panel_vocab add column if not exists hidden boolean not null default false;
create policy panel_vocab_editar on public.panel_vocab for update to authenticated
  using (public.has_perm('products.write')) with check (public.has_perm('products.write'));
