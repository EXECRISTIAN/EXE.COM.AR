-- rls_auto_enable es la función del event trigger que activa RLS en tablas nuevas.
-- No tiene que poder llamarse por la API (/rest/v1/rpc): se le quita EXECUTE a los roles públicos.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
