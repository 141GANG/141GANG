-- 141GANG comment moderation v4
-- Large RU/EN denylist with scalable candidate filtering.
-- External dictionary: LDNOOBW V2, CC0-1.0, pinned commit
-- e2f7430cde6fcc755eca7243d5cf46fc0766ff29.
-- Only high-confidence toxic roots are imported from the external list;
-- curated slurs remain a stricter project-owned layer.

create extension if not exists http with schema extensions;

create table if not exists public.comment_blocked_terms (
  term text primary key,
  active boolean not null default true,
  source_tag text not null default 'manual',
  predictive_from smallint,
  stem_from smallint,
  match_skeleton text,
  created_at timestamptz not null default now()
);

alter table public.comment_blocked_terms
  add column if not exists predictive_from smallint,
  add column if not exists stem_from smallint,
  add column if not exists match_skeleton text;

alter table public.comment_blocked_terms
  alter column source_tag set default 'manual';

alter table public.comment_blocked_terms
  drop constraint if exists comment_blocked_terms_predictive_from_check,
  drop constraint if exists comment_blocked_terms_stem_from_check;

alter table public.comment_blocked_terms
  add constraint comment_blocked_terms_predictive_from_check
    check (predictive_from is null or predictive_from between 4 and char_length(term) - 1),
  add constraint comment_blocked_terms_stem_from_check
    check (stem_from is null or stem_from between 4 and char_length(term) - 1);

alter table public.comment_blocked_terms enable row level security;
revoke all on table public.comment_blocked_terms from public, anon, authenticated;

-- Cheap lossy fingerprint used only to select regex candidates. Precise regex
-- matching below remains authoritative, so broad equivalence groups are safe.
create or replace function public.comment_match_skeleton(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  ch text;
  mapped text;
  prev text := '';
  out_text text := '';
  normalized text := lower(normalize(coalesce(p_text, ''), NFKC));
begin
  foreach ch in array regexp_split_to_array(normalized, '') loop
    mapped := case
      when ch in ('a','а','α','@','4','á','à','â','ä','ã','å','ā','ă','ą',
                  'c','с','ϲ','$','ç','ć','č','s','ѕ','5','ś','š',
                  '9','g','г','q','h','н','х','η','n','ñ','ń','п','p','р','ρ','r','x','χ','ц','ч','я') then 'A'
      when ch in ('b','в','β','6','8','б','v','ν') then 'B'
      when ch in ('d','д') then 'D'
      when ch in ('e','е','ё','ε','3','э','é','è','ê','ë','ē','ė','ę') then 'E'
      when ch in ('f','ф') then 'F'
      when ch in ('i','і','и','ι','1','!','|','l','л','ł','u','у','υ','y','γ','ы','ю','j','й','ж','z','з','2',
                  'í','ì','î','ï','ī','į','ú','ù','û','ü','ū','ý','ÿ','ž','ź','ż') then 'I'
      when ch in ('k','к','κ') then 'K'
      when ch in ('m','м','μ') then 'M'
      when ch in ('o','о','ο','0','ó','ò','ô','ö','õ','ø','ō') then 'O'
      when ch in ('t','т','τ','7','+') then 'T'
      when ch in ('w','ш','щ','ω') then 'W'
      when ch in ('ь','ъ') then ''
      when ch ~ '^[[:alpha:]]$' then ch
      else ''
    end;

    if mapped <> '' and mapped is distinct from prev then
      out_text := out_text || mapped;
      prev := mapped;
    end if;
  end loop;

  return out_text;
end;
$$;

create or replace function public.sync_comment_blocked_term_skeleton()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.match_skeleton := public.comment_match_skeleton(new.term);
  return new;
end;
$$;

drop trigger if exists comment_blocked_terms_sync_skeleton on public.comment_blocked_terms;
create trigger comment_blocked_terms_sync_skeleton
before insert or update of term on public.comment_blocked_terms
for each row execute function public.sync_comment_blocked_term_skeleton();

-- Deterministic rebuild: curated layer first, external source fills gaps only.
delete from public.comment_blocked_terms;

insert into public.comment_blocked_terms
  (term, active, source_tag, predictive_from, stem_from)
values
  ('ниггер', true, 'curated_strict_v4', 4, 4),
  ('нига', true, 'curated_strict_v4', null, null),
  ('нага', true, 'curated_strict_v4', null, null),
  ('негр', true, 'curated_strict_v4', null, null),
  ('негры', true, 'curated_strict_v4', 4, 4),
  ('нигер', true, 'curated_strict_v4', 4, 4),
  ('nigger', true, 'curated_strict_v4', 4, 4),
  ('nigga', true, 'curated_strict_v4', 4, 4),
  ('naga', true, 'curated_strict_v4', null, null),

  ('пидор', true, 'curated_strict_v4', 4, 4),
  ('пидорас', true, 'curated_strict_v4', 4, 4),
  ('педик', true, 'curated_strict_v4', null, null),
  ('гомик', true, 'curated_strict_v4', null, null),
  ('петух', true, 'curated_strict_v4', null, null),
  ('faggot', true, 'curated_strict_v4', 4, 4),

  ('хиджаб', true, 'curated_strict_v4', 4, null),
  ('белый', true, 'curated_strict_v4', null, null),
  ('натурал', true, 'curated_strict_v4', 5, null),
  ('гетеросексуал', true, 'curated_strict_v4', 6, null),

  ('хохол', true, 'curated_strict_v4', null, null),
  ('хохлы', true, 'curated_strict_v4', 4, 4),
  ('чурка', true, 'curated_strict_v4', null, null),
  ('чурки', true, 'curated_strict_v4', 4, 4),
  ('чурбан', true, 'curated_strict_v4', null, 4),
  ('чурбаны', true, 'curated_strict_v4', 4, 4),
  ('кацап', true, 'curated_strict_v4', null, null),
  ('кацапы', true, 'curated_strict_v4', 5, 5),
  ('хач', true, 'curated_strict_v4', null, null),
  ('хачи', true, 'curated_strict_v4', null, null),
  ('хача', true, 'curated_strict_v4', null, null),
  ('жид', true, 'curated_strict_v4', null, null),
  ('жиды', true, 'curated_strict_v4', null, null),
  ('жида', true, 'curated_strict_v4', null, null),
  ('жидов', true, 'curated_strict_v4', null, null),
  ('москаль', true, 'curated_strict_v4', null, null),
  ('москали', true, 'curated_strict_v4', 6, 6),
  ('ватник', true, 'curated_strict_v4', 4, null),
  ('сионист', true, 'curated_strict_v4', 5, null),
  ('черножопый', true, 'curated_strict_v4', null, null),
  ('узкоглазый', true, 'curated_strict_v4', null, null),
  ('русня', true, 'curated_strict_v4', null, null),
  ('чучмек', true, 'curated_strict_v4', null, null),

  ('куколд', true, 'curated_strict_v4', null, null),
  ('конча', true, 'curated_strict_v4', null, null),
  ('даун', true, 'curated_strict_v4', null, null),
  ('аутист', true, 'curated_strict_v4', 4, null),
  ('дебил', true, 'curated_strict_v4', null, null),
  ('retard', true, 'curated_strict_v4', 4, null),
  ('virgin', true, 'curated_strict_v4', null, null),
  ('девственник', true, 'curated_strict_v4', 5, null),
  ('simp', true, 'curated_strict_v4', null, null),
  ('симп', true, 'curated_strict_v4', null, null),
  ('incel', true, 'curated_strict_v4', null, null),
  ('инцел', true, 'curated_strict_v4', null, null),
  ('cunt', true, 'curated_strict_v4', null, null),
  ('пизда', true, 'curated_strict_v4', 4, 4),
  ('вагина', true, 'curated_strict_v4', null, null),
  ('блядь', true, 'curated_strict_v4', 4, 4),
  ('блять', true, 'curated_strict_v4', 4, 4),
  ('шлюха', true, 'curated_strict_v4', 4, 4),

  -- transliteration aliases not reliably expressible as one-character homoglyphs
  ('hijab', true, 'matching_alias_v4', 4, null),
  ('hidzhab', true, 'matching_alias_v4', 4, null),
  ('khokhol', true, 'matching_alias_v4', null, null),
  ('hohol', true, 'matching_alias_v4', null, null),
  ('khokhly', true, 'matching_alias_v4', null, null),
  ('hohly', true, 'matching_alias_v4', null, null),
  ('churka', true, 'matching_alias_v4', null, null),
  ('churki', true, 'matching_alias_v4', null, null),
  ('khach', true, 'matching_alias_v4', null, null),
  ('hach', true, 'matching_alias_v4', null, null),
  ('zhid', true, 'matching_alias_v4', null, null),
  ('cuckold', true, 'matching_alias_v4', null, null),
  ('koncha', true, 'matching_alias_v4', null, null),
  ('petukh', true, 'matching_alias_v4', null, null),
  ('devstvennik', true, 'matching_alias_v4', 5, null)
on conflict (term) do update
set active = excluded.active,
    source_tag = excluded.source_tag,
    predictive_from = excluded.predictive_from,
    stem_from = excluded.stem_from;

-- Fetch the pinned CC0 dictionary once during migration.
create temporary table _comment_dictionary_import (
  lang text primary key,
  body text not null
) on commit drop;

do $$
declare
  response extensions.http_response;
begin
  response := extensions.http_get(
    'https://raw.githubusercontent.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2/e2f7430cde6fcc755eca7243d5cf46fc0766ff29/data/ru.txt'
  );
  if response.status <> 200 then
    raise exception 'Failed to fetch pinned RU moderation dictionary: HTTP %', response.status;
  end if;
  insert into _comment_dictionary_import(lang, body) values ('ru', response.content);

  response := extensions.http_get(
    'https://raw.githubusercontent.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2/e2f7430cde6fcc755eca7243d5cf46fc0766ff29/data/en.txt'
  );
  if response.status <> 200 then
    raise exception 'Failed to fetch pinned EN moderation dictionary: HTTP %', response.status;
  end if;
  insert into _comment_dictionary_import(lang, body) values ('en', response.content);
end;
$$;

with clean as (
  select distinct
    lang,
    lower(btrim(line)) as term
  from _comment_dictionary_import,
       lateral regexp_split_to_table(body, E'\\r?\\n') line
  where char_length(lower(btrim(line))) between 3 and 32
    and lower(btrim(line)) ~ '^[[:alpha:]]+$'
), selected as (
  select term, lang
  from clean
  where
    (
      lang = 'ru'
      and term ~ '(бляд|блят|пизд|[её]б|ху[еёийяю]|муд|гандон|гондон|долбо|дроч|шлюх|сук|мраз|ублюд|говн|жоп|залуп|чмо|чмыр|сволоч|дебил|пид|педер|педик|кретин|идиот|дегенерат|мудак|шмар|сран|срать|срак|ссан|ссать|гнид|падл|твар|лох|черножоп|додик|гомик|петух|даун|аутист|ретард|хач|жид|москал|ватник|куколд|конч|нацист|чурк|хохл|хохол|негр|нигг|нига|blya|bliad|eb|yeb|huy|hui|pizd|pidor|pidar|mudak|gandon|shlu|suka|dolbo|droch|zalup|svoloch|ublyud|govn|zhop)'
    )
    or
    (
      lang = 'en'
      and term ~ '(fuck|shit|bitch|cunt|dick|cock|pussy|fag|nigg|spic|chink|kike|wetback|retard|trann|whore|slut|bastard|asshole|motherfuck|douche|wanker|prick|twat|bollock|jackass|dumbass|dipshit|bullshit|horseshit|goddamn|piss|crap|sucker|coon|gook|raghead|beaner|zipperhead|redskin|honky|dyke|shemale|cocksuck|motherf|buttfuck|dildo|jerkoff|handjob|blowjob|rimjob|cumshot|clusterfuck|dickhead|fuckwit|shithead|shitbag|fuckface|bitchass)'
    )
)
insert into public.comment_blocked_terms
  (term, active, source_tag, predictive_from, stem_from)
select
  term,
  true,
  'ldnoobwv2_cc0_' || lang,
  null,
  null
from selected
on conflict (term) do nothing;

-- Precise character classes used after the cheap candidate filter.
create or replace function public.comment_filter_char_class(p_char text)
returns text
language plpgsql
immutable strict
set search_path = ''
as $$
declare
  ch text := lower(normalize(p_char, NFKC));
begin
  return case ch
    when 'a' then '[aаα@4áàâäãåāăą]'
    when 'а' then '[aаα@4áàâäãåāăą]'
    when 'b' then '[bвβ68]'
    when 'б' then '[бb68]'
    when 'в' then '[вbvβ8]'
    when 'c' then '[cсϲ$çćč]'
    when 'с' then '[сcsϲ$5çćčśš]'
    when 'd' then '[dд]'
    when 'д' then '[дd]'
    when 'e' then '[eеёε3éèêëēėę]'
    when 'е' then '[еёeε3éèêëēėę]'
    when 'ё' then '[ёеeε3éèêëēėę]'
    when 'f' then '[fф]'
    when 'ф' then '[фf]'
    when 'g' then '[gг9q]'
    when 'г' then '[гgr9]'
    when 'h' then '[hнхη]'
    when 'н' then '[нnhηñń]'
    when 'i' then '[iіиι1!|líìîïīį]'
    when 'і' then '[іiиι1!|líìîïīį]'
    when 'и' then '[иiіι1!|líìîïīį]'
    when 'j' then '[jйж]'
    when 'й' then '[йjy]'
    when 'ж' then '[жjzžźż]'
    when 'k' then '[kкκ]'
    when 'к' then '[кkκ]'
    when 'l' then '[lл1|ł]'
    when 'л' then '[лl1|ł]'
    when 'm' then '[mмμ]'
    when 'м' then '[мmμ]'
    when 'n' then '[nнпηñń]'
    when 'п' then '[пpn]'
    when 'o' then '[oоο0óòôöõøō]'
    when 'о' then '[оoο0óòôöõøō]'
    when 'p' then '[pрпρ]'
    when 'р' then '[рprρ]'
    when 'q' then '[qg9]'
    when 'r' then '[rрг]'
    when 's' then '[sсѕ5$śš]'
    when 'ѕ' then '[ѕsс5$śš]'
    when 't' then '[tтτ7+]'
    when 'т' then '[тtτ7+]'
    when 'u' then '[uуиυúùûüū]'
    when 'у' then '[уuyυúùûüū]'
    when 'v' then '[vвν]'
    when 'w' then '[wшщω]'
    when 'x' then '[xхχ]'
    when 'х' then '[хxhχ]'
    when 'y' then '[yуγýÿ]'
    when 'ы' then '[ыyýÿ]'
    when 'z' then '[zзж2žźż]'
    when 'з' then '[зz2žźż]'
    when 'ц' then '[цc]'
    when 'ч' then '[чc4]'
    when 'ш' then '[шw]'
    when 'щ' then '[щw]'
    when 'э' then '[эeéèêë]'
    when 'ю' then '[юuúùûü]'
    when 'я' then '[яa9@4]'
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
  chars := regexp_split_to_array(lower(normalize(p_term, NFKC)), '');

  foreach ch in array chars loop
    if ch in ('ь', 'ъ') then
      core := core || '[ьъ''`]*';
      continue;
    end if;

    if core <> '' then
      core := core || '[^[:alpha:]]*';
    end if;

    token := public.comment_filter_char_class(ch);
    core := core || token || '+';
  end loop;

  return '(^|[^[:alpha:]])(' || core || ')([^[:alpha:]]|$)';
end;
$$;

create or replace function public.comment_stem_regex(p_prefix text)
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
  chars := regexp_split_to_array(lower(normalize(p_prefix, NFKC)), '');

  foreach ch in array chars loop
    if ch in ('ь', 'ъ') then
      core := core || '[ьъ''`]*';
      continue;
    end if;

    if core <> '' then
      core := core || '[^[:alpha:]]*';
    end if;

    token := public.comment_filter_char_class(ch);
    core := core || token || '+';
  end loop;

  return '(^|[^[:alpha:]])(' || core || '[[:alpha:]]*)([^[:alpha:]]|$)';
end;
$$;

create or replace function public.mask_comment_text(p_text text)
returns text
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  result text := normalize(coalesce(p_text, ''), NFKC);
  input_skeleton text;
  previous_result text;
  item record;
  prefix_item record;
  stem_item record;
  pass integer;
  replacement text;
begin
  -- Invisible formatting characters commonly used to split blocked words.
  result := replace(result, chr(173), '');
  result := replace(result, chr(8203), '');
  result := replace(result, chr(8204), '');
  result := replace(result, chr(8205), '');
  result := replace(result, chr(8206), '');
  result := replace(result, chr(8207), '');
  result := replace(result, chr(8288), '');
  result := replace(result, chr(65279), '');

  input_skeleton := public.comment_match_skeleton(result);

  -- Full-word phase: scan the whole dictionary cheaply, run regex only on
  -- skeleton candidates. This keeps a 3k+ dictionary fast enough for RPC use.
  for item in
    select term, public.comment_term_regex(term) as pattern
    from public.comment_blocked_terms
    where active = true
      and match_skeleton <> ''
      and position(match_skeleton in input_skeleton) > 0
    order by char_length(term) desc, term
  loop
    replacement := E'\\1' || repeat('*', char_length(item.term)) || E'\\3';

    for pass in 1..8 loop
      previous_result := result;
      result := regexp_replace(result, item.pattern, replacement, 'gi');
      exit when result = previous_result;
    end loop;
  end loop;

  -- Strict morphology/stem phase: only explicitly curated high-confidence
  -- roots participate. The entire token is replaced, not just the prefix.
  for stem_item in
    select distinct
      left(t.term, t.stem_from) as prefix,
      t.stem_from as prefix_len
    from public.comment_blocked_terms t
    where t.active = true
      and t.stem_from is not null
    order by prefix_len desc, prefix
  loop
    replacement := E'\\1' || repeat('*', stem_item.prefix_len) || E'\\3';

    for pass in 1..8 loop
      previous_result := result;
      result := regexp_replace(
        result,
        public.comment_stem_regex(stem_item.prefix),
        replacement,
        'gi'
      );
      exit when result = previous_result;
    end loop;
  end loop;

  -- Incomplete-word prediction remains conservative: it only matches a token
  -- that currently ends at the selected prefix, so benign longer words are safe.
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

update public.comment_blocked_terms
set match_skeleton = public.comment_match_skeleton(term)
where match_skeleton is distinct from public.comment_match_skeleton(term);

alter table public.comment_blocked_terms
  alter column match_skeleton set not null;

revoke all on function public.comment_match_skeleton(text) from public, anon, authenticated;
revoke all on function public.sync_comment_blocked_term_skeleton() from public, anon, authenticated;
revoke all on function public.comment_filter_char_class(text) from public, anon, authenticated;
revoke all on function public.comment_term_regex(text) from public, anon, authenticated;
revoke all on function public.comment_stem_regex(text) from public, anon, authenticated;
revoke all on function public.mask_comment_text(text) from public, anon, authenticated;

-- Existing comments are immediately brought under the new policy.
update public.game_comments
set body = public.mask_comment_text(body)
where body is distinct from public.mask_comment_text(body);

-- http was needed only for this deterministic migration import.
drop extension if exists http;

notify pgrst, 'reload schema';
