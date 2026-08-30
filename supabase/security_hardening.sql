-- Обновление 1.0 — защита служебных идентификаторов.
-- Выполни после остальных миграций проекта.

-- Таблица администраторов не должна читаться из клиентского приложения.
revoke all on table public.site_admins from anon, authenticated;

-- Публичный каталог не должен раскрывать created_by (UUID администратора).
-- Список доступных столбцов строится динамически, поэтому миграция совместима
-- с уже установленными дополнительными модулями каталога.
revoke select on table public.games from anon, authenticated;

do $$
declare
  v_public_columns text;
begin
  select string_agg(quote_ident(attribute.attname), ', ' order by attribute.attnum)
    into v_public_columns
    from pg_catalog.pg_attribute attribute
   where attribute.attrelid = 'public.games'::regclass
     and attribute.attnum > 0
     and not attribute.attisdropped
     and attribute.attname <> 'created_by';

  if v_public_columns is null then
    raise exception 'Не удалось определить публичные столбцы таблицы games.';
  end if;

  execute format(
    'grant select (%s) on table public.games to anon, authenticated',
    v_public_columns
  );
end;
$$;

notify pgrst, 'reload schema';
