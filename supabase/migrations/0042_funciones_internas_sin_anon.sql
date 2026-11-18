-- Auditoría 18/11 (S4): funciones internas que un visitante sin cuenta no necesita llamar.
-- Solo las usan otras funciones SECURITY DEFINER (que corren con permisos del dueño), nunca la web ni una política RLS,
-- así que quitarles el acceso de "anon" no cambia nada para la tienda ni para el panel.
-- NO se tocan has_perm, staff_session_ok, my_permissions, track ni popular_products: las usan políticas RLS
-- que también evalúan los visitantes (catálogo público), la web sin sesión o la analítica.
revoke execute on function public._approver_ok(uuid) from public, anon;
revoke execute on function public._session_alive() from public, anon;
revoke execute on function public._can_manage_own_sessions() from public, anon;
grant execute on function public._approver_ok(uuid) to authenticated;
grant execute on function public._session_alive() to authenticated;
grant execute on function public._can_manage_own_sessions() to authenticated;
