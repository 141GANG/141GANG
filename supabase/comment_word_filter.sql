-- 141GANG comment moderation v3
-- Hard denylist supplied by the project owner + predictive high-confidence prefixes.
-- Predictive matching starts only from distinctive prefixes to reduce false positives.

create table if not exists public.comment_blocked_terms (
  term text primary key,
  active boolean not null default true,
  source_tag text not null default 'manual',
  predictive_from smallint,
  created_at timestamptz not null default now()
);

alter table public.comment_blocked_terms
  add column if not exists predictive_from smallint;

alter table public.comment_blocked_terms
  drop constraint if exists comment_blocked_terms_predictive_from_check;

alter table public.comment_blocked_terms
  add constraint comment_blocked_terms_predictive_from_check
  check (
    predictive_from is null
    or (predictive_from between 4 and char_length(term) - 1)
  );

alter table public.comment_blocked_terms enable row level security;
revoke all on table public.comment_blocked_terms from public, anon, authenticated;

-- Keep repository and production on one deterministic list.
delete from public.comment_blocked_terms;

insert into public.comment_blocked_terms (term, active, source_tag, predictive_from)
values
  ('ниггер', true, 'user_twitch_list_2026_09_01', 4),
  ('нига', true, 'user_twitch_list_2026_09_01', null),
  ('нага', true, 'user_twitch_list_2026_09_01', null),
  ('негр', true, 'user_twitch_list_2026_09_01', null),
  ('nigger', true, 'user_twitch_list_2026_09_01', 4),
  ('nigga', true, 'user_twitch_list_2026_09_01', 4),
  ('naga', true, 'user_twitch_list_2026_09_01', null),
  ('пидор', true, 'user_twitch_list_2026_09_01', 4),
  ('пидорас', true, 'user_twitch_list_2026_09_01', 4),
  ('педик', true, 'user_twitch_list_2026_09_01', null),
  ('гомик', true, 'user_twitch_list_2026_09_01', null),
  ('петух', true, 'user_twitch_list_2026_09_01', null),
  ('faggot', true, 'user_twitch_list_2026_09_01', 4),
  ('хиджаб', true, 'user_twitch_list_2026_09_01', 4),
  ('белый', true, 'user_twitch_list_2026_09_01', null),
  ('натурал', true, 'user_twitch_list_2026_09_01', 5),
  ('гетеросексуал', true, 'user_twitch_list_2026_09_01', 6),
  ('хохол', true, 'user_twitch_list_2026_09_01', null),
  ('хач', true, 'user_twitch_list_2026_09_01', null),
  ('жид', true, 'user_twitch_list_2026_09_01', null),
  ('москаль', true, 'user_twitch_list_2026_09_01', null),
  ('ватник', true, 'user_twitch_list_2026_09_01', 4),
  ('сионист', true, 'user_twitch_list_2026_09_01', 5),
  ('куколд', true, 'user_twitch_list_2026_09_01', null),
  ('конча', true, 'user_twitch_list_2026_09_01', null),
  ('даун', true, 'user_twitch_list_2026_09_01', null),
  ('аутист', true, 'user_twitch_list_2026_09_01', 4),
  ('дебил', true, 'user_twitch_list_2026_09_01', null),
  ('retard', true, 'user_twitch_list_2026_09_01', 4),
  ('virgin', true, 'user_twitch_list_2026_09_01', null),
  ('девственник', true, 'user_twitch_list_2026_09_01', 5),
  ('simp', true, 'user_twitch_list_2026_09_01', null),
  ('симп', true, 'user_twitch_list_2026_09_01', null),
  ('incel', true, 'user_twitch_list_2026_09_01', null),
  ('инцел', true, 'user_twitch_list_2026_09_01', null),
  ('cunt', true, 'user_twitch_list_2026_09_01', null),
  ('пизда', true, 'user_twitch_list_2026_09_01', 4),
  ('вагина', true, 'user_twitch_list_2026_09_01', null),

  -- Full transliteration aliases that cannot be represented reliably by
  -- a one-character homoglyph map.
  ('hijab', true, 'matching_alias_v3', 4),
  ('hidzhab', true, 'matching_alias_v3', 4),
  ('khokhol', true, 'matching_alias_v3', null),
  ('hohol', true, 'matching_alias_v3', null),
  ('khach', true, 'matching_alias_v3', null),
  ('hach', true, 'matching_alias_v3', null),
  ('zhid', true, 'matching_alias_v3', null),
  ('cuckold', true, 'matching_alias_v3', null),
  ('koncha', true, 'matching_alias_v3', null),
  ('petukh', true, 'matching_alias_v3', null),
  ('devstvennik', true, 'matching_alias_v3', 5)
on conflict (term) do update
set active = excluded.active,
    source_tag = excluded.source_tag,
    predictive_from = excluded.predictive_from;

-- One-character equivalence groups: Latin/Cyrillic/Greek confusables,
-- common transliteration letters and common leetspeak digits/symbols.
create or replace function public.comment_filter_char_class(p_char text)
returns text
language plpgsql
immutable strict
set search_path = ''
as $$
declare
  ch text := lower(p_char);
begin
  return case ch
    when 'a' then '[aаα@4]'
    when 'а' then '[aаα@4]'
    when 'b' then '[bвβ68]'
    when 'б' then '[бb68]'
    when 'в' then '[вbvβ8]'
    when 'c' then '[cсϲ$]'
    when 'с' then '[сcsϲ$5]'
    when 'd' then '[dд]'
    when 'д' then '[дd]'
    when 'e' then '[eеёε3]'
    when 'е' then '[еёeε3]'
    when 'ё' then '[ёеeε3]'
    when 'f' then '[fф]'
    when 'ф' then '[фf]'
    when 'g' then '[gг9q]'
    when 'г' then '[гgr9]'
    when 'h' then '[hнхη]'
    when 'н' then '[нnhη]'
    when 'i' then '[iіиι1!|l]'
    when 'і' then '[іiиι1!|l]'
    when 'и' then '[иiіι1!|l]'
    when 'j' then '[jйж]'
    when 'й' then '[йjy]'
    when 'ж' then '[жjz]'
    when 'k' then '[kкκ]'
    when 'к' then '[кkκ]'
    when 'l' then '[lл1|]'
    when 'л' then '[лl1|]'
    when 'm' then '[mмμ]'
    when 'м' then '[мmμ]'
    when 'n' then '[nнпη]'
    when 'п' then '[пpn]'
    when 'o' then '[oоο0]'
    when 'о' then '[оoο0]'
    when 'p' then '[pрпρ]'
    when 'р' then '[рprρ]'
    when 'q' then '[qg9]'
    when 'r' then '[rрг]'
    when 's' then '[sсѕ5$]'
    when 'ѕ' then '[ѕsс5$]'
    when 't' then '[tтτ7+]'
    when 'т' then '[тtτ7+]'
    when 'u' then '[uуиυ]'
    when 'у' then '[уuyυ]'
    when 'v' then '[vвν]'
    when 'w' then '[wшщω]'
    when 'x' then '[xхχ]'
    when 'х' then '[хxhχ]'
    when 'y' then '[yуγ]'
    when 'ы' then '[ыy]'
    when 'z' then '[zзж2]'
    when 'з' then '[зz2]'
    when 'ц' then '[цc]'
    when 'ч' then '[чc4]'
    when 'ш' then '[шw]'
    when 'щ' then '[щw]'
    when 'э' then '[эe]'
    when 'ю' then '[юu]'
    when 'я' then '[яa9]'
    else ch
  end;
end;
$$;

create or replace function public.comment_term_regex(p_term text)
returns text
language plpgsql
immutable strict
set search_path = ''
as $$
declare
  chars text[];
  ch text;
  core text := '';
  token text;
begin
  chars := regexp_split_to_array(lower(p_term), '');

  foreach ch in array chars loop
    if ch in ('ь', 'ъ') then
      core := core || '[ьъ''`]{0,2}';
      continue;
    end if;

    if core <> '' then
      core := core || '[^[:alpha:]]{0,12}';
    end if;

    token := public.comment_filter_char_class(ch);
    core := core || token || '{1,8}';
  end loop;

  return '(^|[^[:alpha:]])(' || core || ')([^[:alpha:]]|$)';
end;
$$;

create or replace function public.mask_comment_text(p_text text)
returns text
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  result text := coalesce(p_text, '');
  previous_result text;
  item record;
  prefix_item record;
  pass integer;
  replacement text;
begin
  -- Strip invisible formatting characters commonly used to split words.
  result := replace(result, chr(173), '');
  result := replace(result, chr(8203), '');
  result := replace(result, chr(8204), '');
  result := replace(result, chr(8205), '');
  result := replace(result, chr(8206), '');
  result := replace(result, chr(8207), '');
  result := replace(result, chr(8288), '');
  result := replace(result, chr(65279), '');

  -- 1) Full terms first. This preserves the existing rule: the full blocked
  -- word is replaced by the number of stars equal to its canonical length.
  for item in
    select term, public.comment_term_regex(term) as pattern
    from public.comment_blocked_terms
    where active = true
    order by char_length(term) desc, term
  loop
    replacement := E'\\1' || repeat('*', char_length(item.term)) || E'\\3';

    for pass in 1..8 loop
      previous_result := result;
      result := regexp_replace(result, item.pattern, replacement, 'gi');
      exit when result = previous_result;
    end loop;
  end loop;

  -- 2) Predictive prefixes. Only terms explicitly marked with predictive_from
  -- participate, so common benign prefixes are not censored accidentally.
  for prefix_item in
    select distinct
      left(t.term, prefix_len) as prefix,
      prefix_len
    from public.comment_blocked_terms t
    cross join lateral generate_series(
      greatest(t.predictive_from, 4),
      char_length(t.term) - 1
    ) as prefix_len
    where t.active = true
      and t.predictive_from is not null
    order by prefix_len desc, prefix
  loop
    replacement := E'\\1' || repeat('*', prefix_item.prefix_len) || E'\\3';

    for pass in 1..8 loop
      previous_result := result;
      result := regexp_replace(
        result,
        public.comment_term_regex(prefix_item.prefix),
        replacement,
        'gi'
      );
      exit when result = previous_result;
    end loop;
  end loop;

  return result;
end;
$$;

revoke all on function public.comment_filter_char_class(text) from public, anon, authenticated;
revoke all on function public.comment_term_regex(text) from public, anon, authenticated;
revoke all on function public.mask_comment_text(text) from public, anon, authenticated;

-- Re-mask existing comments under the new policy.
update public.game_comments
set body = public.mask_comment_text(body)
where body is distinct from public.mask_comment_text(body);

notify pgrst, 'reload schema';
