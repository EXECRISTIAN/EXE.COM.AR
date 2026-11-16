-- Auditoría AUD-03: el plazo de 24 h para reenviar un pedido con código cuenta desde el primer canje (antes se
-- renovaba en cada reenvío y el código quedaba usable indefinidamente) y el canje bloquea la fila del código.
create or replace function public._promo_eval(p_code text, p_items jsonb, p_record boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c promo_codes; r record; sub numeric := 0; disc numeric; prev promo_redemptions;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  fail text;
begin
  if uid is null then raise exception 'Ingresá a tu cuenta para usar un código de descuento'; end if;
  if (select count(*) from promo_attempts where user_id = uid and at > now() - interval '1 hour') >= 15 then
    raise exception 'Demasiados intentos. Probá de nuevo en una hora';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'El carrito está vacío';
  end if;

  -- con p_record se bloquea la fila del código: dos canjes simultáneos no superan el máximo de usos
  if p_record then select * into c from promo_codes where code = v_code for update;
  else select * into c from promo_codes where code = v_code; end if;
  if c.code is null then fail := 'Ese código no existe. Revisá que esté bien escrito';
  else
    select * into r from public._promo_rules(c);
    if not c.active or not r.enabled then fail := 'Ese código no está activo';
    elsif r.expires is not null and r.expires < now() then fail := 'Ese código venció';
    elsif c.owner = uid then fail := 'No podés usar tu propio código: compartilo con tus amigos';
    end if;
  end if;
  if fail is not null then
    insert into promo_attempts (user_id) values (uid);
    return jsonb_build_object('ok', false, 'error', fail);
  end if;

  -- Subtotal con los precios reales (en pesos) de productos activos con precio
  select coalesce(sum(p.price * least(greatest((i->>'qty')::int, 1), 99)), 0) into sub
  from jsonb_array_elements(p_items) i join products p on p.id = i->>'id' and p.active and p.price > 0;

  select * into prev from promo_redemptions where code = c.code and user_id = uid;
  if prev.id is not null and prev.created_at < now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'error', 'Ya usaste este código en otra compra');
  end if;
  if prev.id is null and r.maxu is not null and c.uses >= r.maxu then
    return jsonb_build_object('ok', false, 'error', 'Ese código ya alcanzó su máximo de usos');
  end if;
  if sub <= 0 then return jsonb_build_object('ok', false, 'error', 'El código se aplica sobre productos con precio'); end if;
  if sub < r.minp then
    return jsonb_build_object('ok', false, 'error', 'La compra mínima para este código es de $' || replace(to_char(r.minp, 'FM999,999,999'), ',', '.'), 'min', r.minp);
  end if;

  disc := case when r.dtype = 'percent' then round(sub * r.dvalue / 100) else least(r.dvalue, sub) end;

  if p_record then
    if prev.id is null then
      insert into promo_redemptions (code, user_id, subtotal, discount, items) values (c.code, uid, sub, disc, p_items) returning * into prev;
      update promo_codes set uses = uses + 1 where code = c.code;
    else   -- reenvío del mismo pedido dentro de las 24 h del primer canje: se actualiza, no suma otro uso ni extiende el plazo
      update promo_redemptions set subtotal = sub, discount = disc, items = p_items where id = prev.id returning * into prev;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', c.code, 'kind', c.kind, 'type', r.dtype, 'value', r.dvalue,
    'subtotal', sub, 'discount', disc, 'total', sub - disc, 'check', case when p_record then prev.id end,
    'label', case when r.dtype = 'percent' then trim_scale(r.dvalue)::text || '% de descuento' else '$' || replace(to_char(r.dvalue, 'FM999,999,999'), ',', '.') || ' de descuento' end);
end $$;
