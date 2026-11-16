-- Auditoría AUD-01: tope general de 5000 eventos por hora (hoy el pico es ~10) además del tope por visitante,
-- y limpieza diaria de eventos de más de 13 meses.
create or replace function public.track(p_events jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0; v text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then return 0; end if;
  for e in select * from jsonb_array_elements(p_events) limit 20 loop
    v := lower(e->>'visitor');
    continue when v is null or v !~ '^[a-z0-9]{8,32}$';
    continue when e->>'type' not in ('view', 'product', 'add', 'cart', 'wa');
    if n = 0 and (select count(*) from analytics_events where visitor = v and at > now() - interval '1 hour') >= 300 then return 0; end if;
    -- tope general: cambiar de identificador no permite saltear el límite
    if n = 0 and (select count(*) from analytics_events where at > now() - interval '1 hour') >= 5000 then return 0; end if;
    insert into analytics_events (visitor, type, product_id, device, os, browser, source, campaign, province, amount)
    values (v, e->>'type', left(e->>'product_id', 120),
      case when e->>'device' in ('mobile', 'desktop', 'tablet') then e->>'device' end,
      left(e->>'os', 20), left(e->>'browser', 20), left(e->>'source', 40), left(e->>'campaign', 60), left(e->>'province', 40),
      case when (e->>'amount') ~ '^\d{1,12}(\.\d+)?$' then (e->>'amount')::numeric end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'analitica_purga';
select cron.schedule('analitica_purga', '17 7 * * *', $$delete from public.analytics_events where at < now() - interval '13 months'$$);
