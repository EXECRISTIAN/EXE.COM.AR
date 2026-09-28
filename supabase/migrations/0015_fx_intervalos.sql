-- Historial por intervalo (fx_history_bucket: último valor + máx/mín de cada tramo; máx ~3000 puntos) y lecturas cada 10 min.
-- (Aplicado en Supabase como migración fx_history_intervalos.)
select cron.alter_job(jobid, schedule => '*/10 * * * *') from cron.job where jobname = 'fx-refresh';

-- Accesos rápidos de "Ver cada" editables (fx_settings.quick_steps, RPC fx_quick_steps con permiso products.write).
-- (Aplicado en Supabase como migración fx_accesos_rapidos.)
alter table public.fx_settings add column if not exists quick_steps int[] not null default array[0,10,30,60,360,720,1440];
