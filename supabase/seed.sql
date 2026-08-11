-- ============================================================
-- Seed opcional con datos de ejemplo.
--
-- Sirve para ver los gráficos con algo adentro antes de cargar datos
-- reales. NO se corre solo: hay que ejecutarlo a mano desde el SQL
-- Editor de Supabase DESPUÉS de haber entrado por lo menos una vez con
-- Google (el usuario tiene que existir en auth.users).
--
-- Para borrar todo lo que crea este archivo:
--   delete from public.movements where descripcion like '[demo]%';
--   delete from public.recurrences where descripcion like '[demo]%';
--   delete from public.projects where slug like 'demo-%';
-- ============================================================

do $$
declare
  v_user_id uuid;
  v_proyecto_a uuid;
  v_proyecto_b uuid;
  v_proyecto_c uuid;
  v_cat_ventas uuid;
  v_cat_suscripciones uuid;
  v_cat_infra uuid;
  v_cat_herramientas uuid;
  v_cat_apis uuid;
  v_cat_marketing uuid;
  v_tasa numeric;
  v_fecha date;
  v_mes int;
begin
  -- Toma el primer usuario: es una app de un solo usuario.
  select id into v_user_id from auth.users order by created_at limit 1;

  if v_user_id is null then
    raise exception 'No hay ningún usuario todavía. Entrá con Google primero.';
  end if;

  -- ── Cotizaciones ──────────────────────────────────────────
  -- Serie sintética de los últimos 12 meses con una curva creciente,
  -- para que la conversión histórica tenga de dónde agarrarse.
  for i in 0..365 loop
    v_fecha := current_date - i;
    insert into public.fx_rates (fecha, compra, venta, fuente, fetched_at)
    values (
      v_fecha,
      950 + (365 - i) * 0.9,
      1000 + (365 - i) * 1.0,
      'seed',
      now()
    )
    on conflict (fecha) do nothing;
  end loop;

  -- ── Proyectos ─────────────────────────────────────────────
  -- La ventana fecha_inicio/fecha_fin es lo que decide quién se lleva
  -- parte de cada gasto compartido, y se pregunta contra la fecha DEL
  -- GASTO. Por eso la landing vieja se cierra a mitad del año simulado y
  -- no "hace un año": así el seed muestra el caso interesante —un
  -- proyecto que participa del reparto de enero a junio y deja de
  -- participar después— en vez de uno que nunca participó de nada.
  insert into public.projects (user_id, nombre, slug, color, fecha_inicio, fecha_fin, peso_prorrateo)
  values
    (v_user_id, '[demo] Facturador', 'demo-facturador', '#2a78d6', current_date - 365, null, 1),
    (v_user_id, '[demo] Scraper API', 'demo-scraper-api', '#1baf7a', current_date - 365, null, 2),
    (v_user_id, '[demo] Landing vieja', 'demo-landing-vieja', '#eb6834', current_date - 365, current_date - 180, 1)
  on conflict (user_id, slug) do nothing;

  select id into v_proyecto_a from public.projects where user_id = v_user_id and slug = 'demo-facturador';
  select id into v_proyecto_b from public.projects where user_id = v_user_id and slug = 'demo-scraper-api';
  select id into v_proyecto_c from public.projects where user_id = v_user_id and slug = 'demo-landing-vieja';

  -- ── Categorías (las crea el trigger al dar de alta el usuario) ──
  select id into v_cat_ventas from public.categories where user_id = v_user_id and tipo = 'ingreso' and nombre = 'Ventas';
  select id into v_cat_suscripciones from public.categories where user_id = v_user_id and tipo = 'ingreso' and nombre = 'Suscripciones';
  select id into v_cat_infra from public.categories where user_id = v_user_id and tipo = 'egreso' and nombre = 'Infraestructura';
  select id into v_cat_herramientas from public.categories where user_id = v_user_id and tipo = 'egreso' and nombre = 'Herramientas';
  select id into v_cat_apis from public.categories where user_id = v_user_id and tipo = 'egreso' and nombre = 'Datos y APIs';
  select id into v_cat_marketing from public.categories where user_id = v_user_id and tipo = 'egreso' and nombre = 'Marketing';

  if v_cat_ventas is null then
    raise exception 'Faltan las categorías por defecto. ¿Corrió el trigger seed_default_categories?';
  end if;

  -- ── Movimientos de los últimos 12 meses ───────────────────
  for v_mes in 0..11 loop
    v_fecha := date_trunc('month', current_date - (v_mes || ' months')::interval)::date + 4;

    -- La tasa de cada fecha sale de fx_rates: los montos quedan congelados
    -- con la cotización que correspondía a ese día, como en la app real.
    select venta into v_tasa from public.fx_rates where fecha <= v_fecha order by fecha desc limit 1;

    -- Ingresos por ventas del facturador
    insert into public.movements (
      user_id, project_id, category_id, fecha, descripcion, tipo,
      monto_origen, moneda_origen, monto_ars, monto_usd, tasa_usada, tasa_fecha, estado
    ) values (
      v_user_id, v_proyecto_a, v_cat_ventas, v_fecha,
      '[demo] Licencias vendidas', 'ingreso',
      round((380 + random() * 240)::numeric, 2), 'USD',
      round((380 + random() * 240)::numeric * v_tasa, 2),
      round((380 + random() * 240)::numeric, 2),
      v_tasa, v_fecha, 'efectuado'
    );

    -- Suscripciones del scraper
    insert into public.movements (
      user_id, project_id, category_id, fecha, descripcion, tipo,
      monto_origen, moneda_origen, monto_ars, monto_usd, tasa_usada, tasa_fecha, estado
    ) values (
      v_user_id, v_proyecto_b, v_cat_suscripciones, v_fecha + 6,
      '[demo] Suscripciones mensuales', 'ingreso',
      round((520 + random() * 300)::numeric, 2), 'USD',
      round((520 + random() * 300)::numeric * v_tasa, 2),
      round((520 + random() * 300)::numeric, 2),
      v_tasa, v_fecha, 'efectuado'
    );

    -- Infraestructura del scraper (el que consume)
    insert into public.movements (
      user_id, project_id, category_id, fecha, descripcion, tipo,
      monto_origen, moneda_origen, monto_ars, monto_usd, tasa_usada, tasa_fecha, estado
    ) values (
      v_user_id, v_proyecto_b, v_cat_infra, v_fecha + 2,
      '[demo] Servidores y base de datos', 'egreso',
      round((90 + random() * 60)::numeric, 2), 'USD',
      round((90 + random() * 60)::numeric * v_tasa, 2),
      round((90 + random() * 60)::numeric, 2),
      v_tasa, v_fecha, 'efectuado'
    );

    -- Datos y APIs del scraper
    insert into public.movements (
      user_id, project_id, category_id, fecha, descripcion, tipo,
      monto_origen, moneda_origen, monto_ars, monto_usd, tasa_usada, tasa_fecha, estado
    ) values (
      v_user_id, v_proyecto_b, v_cat_apis, v_fecha + 3,
      '[demo] Proxies residenciales', 'egreso',
      round((70 + random() * 40)::numeric, 2), 'USD',
      round((70 + random() * 40)::numeric * v_tasa, 2),
      round((70 + random() * 40)::numeric, 2),
      v_tasa, v_fecha, 'efectuado'
    );

    -- GASTO COMPARTIDO: la herramienta que usan todos los proyectos.
    -- project_id = null. Se prorratea al vuelo entre los proyectos que
    -- estaban abiertos EN LA FECHA de este movimiento.
    insert into public.movements (
      user_id, project_id, category_id, fecha, descripcion, tipo,
      monto_origen, moneda_origen, monto_ars, monto_usd, tasa_usada, tasa_fecha, estado
    ) values (
      v_user_id, null, v_cat_herramientas, v_fecha + 1,
      '[demo] Claude Pro + Cursor', 'egreso',
      60.00, 'USD',
      round(60.00 * v_tasa, 2), 60.00,
      v_tasa, v_fecha, 'efectuado'
    );

    -- Marketing en pesos, cada dos meses, para tener carga en ARS.
    if v_mes % 2 = 0 then
      insert into public.movements (
        user_id, project_id, category_id, fecha, descripcion, tipo,
        monto_origen, moneda_origen, monto_ars, monto_usd, tasa_usada, tasa_fecha, estado
      ) values (
        v_user_id, v_proyecto_a, v_cat_marketing, v_fecha + 8,
        '[demo] Campaña de ads', 'egreso',
        150000, 'ARS',
        150000, round(150000 / v_tasa, 2),
        v_tasa, v_fecha, 'efectuado'
      );
    end if;
  end loop;

  -- Un par de planificados a futuro, para ver el balance proyectado.
  select venta into v_tasa from public.fx_rates order by fecha desc limit 1;

  insert into public.movements (
    user_id, project_id, category_id, fecha, descripcion, tipo,
    monto_origen, moneda_origen, monto_ars, monto_usd, tasa_usada, tasa_fecha, estado
  ) values
    (v_user_id, v_proyecto_a, v_cat_ventas, current_date + 12,
     '[demo] Renovación anual de un cliente', 'ingreso',
     1200.00, 'USD', round(1200.00 * v_tasa, 2), 1200.00, v_tasa, current_date, 'planificado'),
    (v_user_id, null, v_cat_infra, current_date + 20,
     '[demo] Renovación de dominios', 'egreso',
     45.00, 'USD', round(45.00 * v_tasa, 2), 45.00, v_tasa, current_date, 'planificado');

  -- ── Una recurrencia de ejemplo ────────────────────────────
  insert into public.recurrences (
    user_id, project_id, category_id, descripcion, tipo,
    monto_origen, moneda_origen, frecuencia, dia_del_mes, fecha_inicio, activa
  ) values (
    v_user_id, null, v_cat_herramientas,
    '[demo] Claude Pro + Cursor', 'egreso',
    60.00, 'USD', 'mensual', 5,
    date_trunc('month', current_date)::date, true
  );

  raise notice 'Seed listo. Proyectos: % / % / %', v_proyecto_a, v_proyecto_b, v_proyecto_c;
end $$;
