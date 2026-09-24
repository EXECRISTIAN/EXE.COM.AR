# Roles y permisos

Un **permiso** es una acción concreta (`orders.read`). Un **rol** es un conjunto de permisos. Un usuario puede tener varios roles; sus permisos efectivos son la suma.

## Permisos disponibles

| Permiso | Permite |
|---|---|
| `dashboard.access` | Entrar al panel |
| `orders.read` | Ver todos los pedidos |
| `orders.update_status` | Cambiar estado (preparando, enviado, entregado, cancelado) |
| `orders.mark_paid` | Marcar pagado manualmente (queda auditado) |
| `products.read` | Ver productos inactivos |
| `products.write` | Crear/editar productos y precios |
| `stock.write` | Cambiar stock y si se muestra en la web |
| `users.read` | Ver usuarios |
| `users.assign_roles` | Asignar roles |
| `roles.manage` | Crear/editar roles |
| `emails.manage` | Editar plantillas de email |

## Roles base

| Rol | Permisos |
|---|---|
| administrador | Todos |
| moderador | dashboard.access, orders.read, orders.update_status, products.read, stock.write |
| suscriptor | Ninguno de panel (solo su cuenta y sus pedidos) |

## Crear un rol personalizado (ej. "depósito": solo stock)

En Supabase > SQL Editor:

```sql
insert into roles (name, description) values ('deposito', 'Solo maneja stock');
insert into role_permissions (role_id, permission_key)
  select id, unnest(array['dashboard.access','products.read','stock.write']) from roles where name = 'deposito';
```

## Asignar un rol a un usuario

```sql
insert into user_roles (user_id, role_id)
  select p.id, r.id from profiles p, roles r
  where p.email = 'persona@mail.com' and r.name = 'moderador';
```

## Primer administrador
Registrate en `cuenta.html` y después, en el SQL Editor (una sola vez):

```sql
insert into user_roles (user_id, role_id)
  select p.id, r.id from profiles p, roles r
  where p.email = 'TU_EMAIL' and r.name = 'administrador';
```

## Agregar un permiso nuevo
1. `insert into permissions (key, description) values ('reportes.ver', 'Ver reportes');`
2. Usarlo en una política RLS o función con `has_perm('reportes.ver')`.
3. (Opcional) mostrar la sección en el panel con `data-perm="reportes.ver"`.
