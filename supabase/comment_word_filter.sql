-- 141GANG comment moderation v2
-- Source policy: user-provided Twitch denylist, 2026-09-01.
-- The list is intentionally treated as a hard denylist regardless of contextual notes.

create table if not exists public.comment_blocked_terms (
  term text primary key,
  active boolean not null default true,
  source_tag text not null default 'manual',
  created_at timestamptz not null default now()
);

revoke all on table public.comment_blocked_terms from public, anon, authenticated;

-- Replace the previous curated list with the user's current policy list.
delete from public.comment_blocked_terms;

insert into public.comment_blocked_terms (term, active, source_tag)
values
  ('ниггер', true, 'user_twitch_list_2026_09_01'),
  ('нига', true, 'user_twitch_list_2026_09_01'),
  ('нага', true, 'user_twitch_list_2026_09_01'),
  ('nigger', true, 'user_twitch_list_2026_09_01'),
  ('nigga', true, 'user_twitch_list_2026_09_01'),
  ('naga', true, 'user_twitch_list_2026_09_01'),
  ('пидор', true, 'user_twitch_list_2026_09_01'),
  ('пидорас', true, 'user_twitch_list_2026_09_01'),
  ('педик', true, 'user_twitch_list_2026_09_01'),
  ('гомик', true, 'user_twitch_list_2026_09_01'),
  ('петух', true, 'user_twitch_list_2026_09_01'),
  ('faggot', true, 'user_twitch_list_2026_09_01'),
  ('хиджаб', true, 'user_twitch_list_2026_09_01'),
  ('белый', true, 'user_twitch_list_2026_09_01'),
  ('натурал', true, 'user_twitch_list_2026_09_01'),
  ('гетеросексуал', true, 'user_twitch_list_2026_09_01'),
  ('хохол', true, 'user_twitch_list_2026_09_01'),
  ('хач', true, 'user_twitch_list_2026_09_01'),
  ('жид', true, 'user_twitch_list_2026_09_01'),
  ('москаль', true, 'user_twitch_list_2026_09_01'),
  ('ватник', true, 'user_twitch_list_2026_09_01'),
  ('сионист', true, 'user_twitch_list_2026_09_01'),
  ('куколд', true, 'user_twitch_list_2026_09_01'),
  ('конча', true, 'user_twitch_list_2026_09_01'),
  ('даун', true, 'user_twitch_list_2026_09_01'),
  ('аутист', true, 'user_twitch_list_2026_09_01'),
  ('дебил', true, 'user_twitch_list_2026_09_01'),
  ('retard', true, 'user_twitch_list_2026_09_01'),
  ('virgin', true, 'user_twitch_list_2026_09_01'),
  ('девственник', true, 'user_twitch_list_2026_09_01'),
  ('simp', true, 'user_twitch_list_2026_09_01'),
  ('симп', true, 'user_twitch_list_2026_09_01'),
  ('incel', true, 'user_twitch_list_2026_09_01'),
  ('инцел', true, 'user_twitch_list_2026_09_01'),
  ('cunt', true, 'user_twitch_list_2026_09_01'),
  ('пизда', true, 'user_twitch_list_2026_09_01'),
  ('вагина', true, 'user_twitch_list_2026_09_01'),

  -- Hidden matching aliases for common full transliterations that cannot be
  -- represented by a one-character homoglyph map (kh/ch/zh/soft sign, etc.).
  ('hijab', true, 'matching_alias_v2'),
  ('hidzhab', true, 'matching_alias_v2'),
  ('khokhol', true, 'matching_alias_v2'),
  ('hohol', true, 'matching_alias_v2'),
  ('khach', true, 'matching_alias_v2'),
  ('hach', true, 'matching_alias_v2'),
  ('zhid', true, 'matching_alias_v2'),
  ('cuckold', true, 'matching_alias_v2'),
  ('koncha', true, 'matching_alias_v2'),
  ('petukh', true, 'matching_alias_v2'),
  ('devstvennik', true, 'matching_alias_v2')
on conflict (term) do update
set active = excluded.active,
    source_tag = excluded.source_tag;

-- One-character equivalence groups. They combine Latin/Cyrillic/Greek
-- confusables, common transliteration letters and leetspeak digits/symbols.
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
    -- Soft/hard signs are commonly omitted in transliteration. Treat them as
    -- optional punctuation-like characters rather than mandatory letters.
    if ch in ('ь', 'ъ') then
      core := core || '[ьъ''`]{0,2}';
      continue;
    end if;

    if core <> '' then
      -- Allow digits, punctuation, emoji and whitespace between letters.
      -- Letters themselves must still match one of the confusable classes.
      core := core || '[^[:alpha:]]{0,12}';
    end if;

    token := public.comment_filter_char_class(ch);
    core := core || token || '{1,8}';
  end loop;

  -- Treat any non-letter (including underscore/digits) as a valid boundary.
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
  pass integer;
  replacement text;
begin
  -- Strip invisible formatting characters commonly used to split words.
  result := replace(result, chr(173), '');   -- soft hyphen
  result := replace(result, chr(8203), '');  -- zero width space
  result := replace(result, chr(8204), '');  -- zero width non-joiner
  result := replace(result, chr(8205), '');  -- zero width joiner
  result := replace(result, chr(8206), '');  -- left-to-right mark
  result := replace(result, chr(8207), '');  -- right-to-left mark
  result := replace(result, chr(8288), '');  -- word joiner
  result := replace(result, chr(65279), ''); -- BOM / zero-width no-break space

  for item in
    select term, public.comment_term_regex(term) as pattern
    from public.comment_blocked_terms
    where active = true
    order by char_length(term) desc, term
  loop
    replacement := E'\\1' || repeat('*', char_length(item.term)) || E'\\3';

    -- Multiple passes cover several blocked terms in one sentence while
    -- preserving surrounding separators.
    for pass in 1..8 loop
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

-- Existing comments are re-masked under the current policy.
update public.game_comments
set body = public.mask_comment_text(body)
where body is distinct from public.mask_comment_text(body);

notify pgrst, 'reload schema';
