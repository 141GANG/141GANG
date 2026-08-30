-- Разрешает публиковать игры без комментария автора.
-- Выполни один раз в Supabase → SQL Editor для уже созданной таблицы.

alter table public.games
  alter column author_comment set default '';

alter table public.games
  drop constraint if exists games_author_comment_check,
  drop constraint if exists games_author_comment_length;

alter table public.games
  add constraint games_author_comment_length
  check (char_length(author_comment) <= 1200);
