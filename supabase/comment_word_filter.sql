
-- Фильтрация запрещённых слов в комментариях.
-- Twitch не публикует полный список запрещённых слуров; этот denylist является
-- внутренним расширяемым набором для комментариев 141GANG.

create table if not exists public.comment_blocked_terms (
  term text primary key,
  active boolean not null default true,
  source_tag text not null default 'curated_ru_en_v1',
  created_at timestamptz not null default now(),
  constraint comment_blocked_terms_term_length
    check (char_length(term) between 3 and 32),
  constraint comment_blocked_terms_single_token
    check (term !~ '[[:space:]]')
);

alter table public.comment_blocked_terms enable row level security;

revoke all on table public.comment_blocked_terms from public, anon, authenticated;

insert into public.comment_blocked_terms (term, source_tag)
values
  ('nigger', 'curated_ru_en_v1'),
  ('nigga', 'curated_ru_en_v1'),
  ('faggot', 'curated_ru_en_v1'),
  ('tranny', 'curated_ru_en_v1'),
  ('kike', 'curated_ru_en_v1'),
  ('chink', 'curated_ru_en_v1'),
  ('spic', 'curated_ru_en_v1'),
  ('wetback', 'curated_ru_en_v1'),
  ('cunt', 'curated_ru_en_v1'),
  ('fuck', 'curated_ru_en_v1'),
  ('shit', 'curated_ru_en_v1'),
  ('bitch', 'curated_ru_en_v1'),
  ('хуй', 'curated_ru_en_v1'),
  ('хуесос', 'curated_ru_en_v1'),
  ('пизда', 'curated_ru_en_v1'),
  ('пиздец', 'curated_ru_en_v1'),
  ('ебать', 'curated_ru_en_v1'),
  ('ебаный', 'curated_ru_en_v1'),
  ('еблан', 'curated_ru_en_v1'),
  ('блять', 'curated_ru_en_v1'),
  ('блядь', 'curated_ru_en_v1'),
  ('пидор', 'curated_ru_en_v1'),
  ('пидорас', 'curated_ru_en_v1'),
  ('гандон', 'curated_ru_en_v1')
on conflict (term) do update
set active = true,
    source_tag = excluded.source_tag;

create or replace function public.comment_filter_char_class(p_char text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  ch text := lower(p_char);
begin
  return case ch
    when 'a' then '[aа@4]'
    when 'а' then '[aа@4]'
    when 'b' then '[bв8]'
    when 'в' then '[bв8]'
    when 'c' then '[cс$]'
    when 'с' then '[cс$]'
    when 'e' then '[eеё3]'
    when 'е' then '[eеё3]'
    when 'ё' then '[eеё3]'
    when 'h' then '[hн]'
    when 'н' then '[hн]'
    when 'i' then '[iіи1!|]'
    when 'і' then '[iіи1!|]'
    when 'и' then '[iіи1!|]'
    when 'k' then '[kк]'
    when 'к' then '[kк]'
    when 'm' then '[mм]'
    when 'м' then '[mм]'
    when 'o' then '[oо0]'
    when 'о' then '[oо0]'
    when 'p' then '[pр]'
    when 'р' then '[pр]'
    when 's' then '[sѕ5$]'
    when 'ѕ' then '[sѕ5$]'
    when 't' then '[tт7]'
    when 'т' then '[tт7]'
    when 'x' then '[xх]'
    when 'х' then '[xх]'
    when 'y' then '[yу]'
    when 'у' then '[yу]'
    when 'б' then '[б6]'
    when 'з' then '[з3]'
    when 'ч' then '[ч4]'
    when 'ш' then '[шw]'
    when 'щ' then '[щw]'
    when 'л' then '[лl]'
    when 'г' then '[гr]'
    when 'д' then '[дd]'
    when 'ж' then '[жj]'
    when 'й' then '[йj]'
    when 'п' then '[пn]'
    when 'ф' then '[фf]'
    when 'ц' then '[цc]'
    when 'ы' then '[ыy]'
    when 'э' then '[эe]'
    when 'ю' then '[юu]'
    when 'я' then '[я9]'
    else ch
  end;
end;
$$;

create or replace function public.comment_term_regex(p_term text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  chars text[];
  ch text;
  core text := '';
begin
  chars := regexp_split_to_array(lower(p_term), '');

  foreach ch in array chars loop
    if core <> '' then
      core := core || '[^[:alnum:]]{0,3}';
    end if;
    core := core || public.comment_filter_char_class(ch) || '{1,4}';
  end loop;

  return '(^|[^[:alnum:]_])(' || core || ')([^[:alnum:]_]|$)';
end;
$$;

create or replace function public.mask_comment_text(p_text text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result text := coalesce(p_text, '');
  previous_result text;
  item record;
  pass integer;
  replacement text;
begin
  -- Убираем невидимые разделители, которыми часто обходят фильтры.
  result := replace(result, chr(8203), '');  -- zero width space
  result := replace(result, chr(8204), '');  -- zero width non-joiner
  result := replace(result, chr(8205), '');  -- zero width joiner
  result := replace(result, chr(8288), '');  -- word joiner
  result := replace(result, chr(65279), ''); -- zero width no-break space

  for item in
    select term, public.comment_term_regex(term) as pattern
    from public.comment_blocked_terms
    where active = true
    order by char_length(term) desc, term
  loop
    replacement := E'\\1' || repeat('*', char_length(item.term)) || E'\\3';

    -- Несколько проходов нужны для соседних совпадений, поскольку regex
    -- сохраняет граничный символ в replacement.
    for pass in 1..4 loop
      previous_result := result;
      result := regexp_replace(result, item.pattern, replacement, 'gi');
      exit when result = previous_result;
    end loop;
  end loop;

  return result;
end;
$$;

revoke all on function public.comment_filter_char_class(text) from public, anon, authenticated;
revoke all on function public.comment_term_regex(text) from public, anon, authenticated;
revoke all on function public.mask_comment_text(text) from public, anon, authenticated;

create or replace function public.add_game_comment(p_game_id bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
  raw_body text := btrim(coalesce(p_body, ''));
  clean_body text;
  new_id bigint;
begin
  if viewer_id is null then
    raise exception 'Требуется авторизация.' using errcode = '42501';
  end if;

  if char_length(raw_body) not between 1 and 500 then
    raise exception 'Комментарий должен содержать от 1 до 500 символов.' using errcode = '22023';
  end if;

  clean_body := btrim(public.mask_comment_text(raw_body));

  if char_length(clean_body) not between 1 and 500 then
    raise exception 'Комментарий должен содержать от 1 до 500 символов.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.games
    where id = p_game_id
      and published = true
  ) then
    raise exception 'Игра не найдена.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.game_comments
    where game_id = p_game_id
      and user_id = viewer_id
  ) then
    raise exception 'Вы уже оставили комментарий к этой игре. Используйте «Изменить».' using errcode = '23505';
  end if;

  begin
    insert into public.game_comments (game_id, user_id, body)
    values (p_game_id, viewer_id, clean_body)
    returning id into new_id;
  exception
    when unique_violation then
      raise exception 'Вы уже оставили комментарий к этой игре. Используйте «Изменить».' using errcode = '23505';
  end;

  return new_id;
end;
$$;

create or replace function public.update_game_comment(p_comment_id bigint, p_body text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
  raw_body text := btrim(coalesce(p_body, ''));
  clean_body text;
  edited_at timestamptz;
begin
  if viewer_id is null then
    raise exception 'Требуется авторизация.' using errcode = '42501';
  end if;

  if char_length(raw_body) not between 1 and 500 then
    raise exception 'Комментарий должен содержать от 1 до 500 символов.' using errcode = '22023';
  end if;

  clean_body := btrim(public.mask_comment_text(raw_body));

  if char_length(clean_body) not between 1 and 500 then
    raise exception 'Комментарий должен содержать от 1 до 500 символов.' using errcode = '22023';
  end if;

  update public.game_comments
  set
    body = clean_body,
    updated_at = now()
  where id = p_comment_id
    and user_id = viewer_id
  returning updated_at into edited_at;

  if edited_at is null then
    raise exception 'Можно изменять только свои комментарии.' using errcode = '42501';
  end if;

  return edited_at;
end;
$$;

revoke all on function public.add_game_comment(bigint, text) from public;
revoke all on function public.update_game_comment(bigint, text) from public;
revoke execute on function public.add_game_comment(bigint, text) from anon;
revoke execute on function public.update_game_comment(bigint, text) from anon;
grant execute on function public.add_game_comment(bigint, text) to authenticated;
grant execute on function public.update_game_comment(bigint, text) to authenticated;

-- Однократно маскируем уже существующие комментарии.
update public.game_comments
set body = public.mask_comment_text(body)
where body is distinct from public.mask_comment_text(body);

notify pgrst, 'reload schema';
