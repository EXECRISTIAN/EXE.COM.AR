-- Historial por intervalo (fx_history_bucket: último valor + máx/mín de cada tramo; máx ~3000 puntos) y lecturas cada 10 min.
-- (Aplicado en Supabase como migración fx_history_intervalos.)
select cron.alter_job(jobid, schedule => '*/10 * * * *') from cron.job where jobname = 'fx-refresh';
