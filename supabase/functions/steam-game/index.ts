import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function extractAppId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (/^\d{1,12}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const match = url.pathname.match(/\/app\/(\d+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(year: number, month: number, day = 1): string | null {
  if (!Number.isInteger(year) || year < 1970 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

const ruMonths: Record<string, number> = {
  янв: 1, январь: 1, января: 1,
  фев: 2, февр: 2, февраль: 2, февраля: 2,
  мар: 3, март: 3, марта: 3,
  апр: 4, апрель: 4, апреля: 4,
  май: 5, мая: 5,
  июн: 6, июнь: 6, июня: 6,
  июл: 7, июль: 7, июля: 7,
  авг: 8, август: 8, августа: 8,
  сен: 9, сент: 9, сентябрь: 9, сентября: 9,
  окт: 10, октябрь: 10, октября: 10,
  ноя: 11, нояб: 11, ноябрь: 11, ноября: 11,
  дек: 12, декабрь: 12, декабря: 12,
};

const enMonths: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function normalizeWord(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[.,]/g, "").trim();
}

function parseSteamDate(rawValue: unknown) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return { iso: null, precision: "unknown", approximate: true };
  const normalized = raw.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();

  let match = normalized.match(/^(\d{1,2})\s+([a-zа-яё.]+)\s+(\d{4})/i);
  if (match) {
    const monthWord = normalizeWord(match[2]);
    const month = ruMonths[monthWord] ?? enMonths[monthWord];
    const iso = month ? isoDate(Number(match[3]), month, Number(match[1])) : null;
    if (iso) return { iso, precision: "day", approximate: false };
  }

  match = normalized.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match) {
    const month = enMonths[normalizeWord(match[1])];
    const iso = month ? isoDate(Number(match[3]), month, Number(match[2])) : null;
    if (iso) return { iso, precision: "day", approximate: false };
  }

  match = normalized.match(/(?:q\s*([1-4])|([1-4])(?:-?й)?\s*квартал)\D*(\d{4})/i);
  if (match) {
    const quarter = Number(match[1] ?? match[2]);
    const year = Number(match[3]);
    return { iso: isoDate(year, (quarter - 1) * 3 + 1), precision: "quarter", approximate: true };
  }

  const seasons: Record<string, number> = {
    winter: 1, зима: 1,
    spring: 3, весна: 3,
    summer: 6, лето: 6,
    autumn: 9, fall: 9, осень: 9,
  };
  match = normalized.match(/^(winter|spring|summer|autumn|fall|зима|весна|лето|осень)\s+(\d{4})/i);
  if (match) {
    return { iso: isoDate(Number(match[2]), seasons[normalizeWord(match[1])]), precision: "season", approximate: true };
  }

  match = normalized.match(/^([a-zа-яё.]+)\s+(\d{4})/i);
  if (match) {
    const word = normalizeWord(match[1]);
    const month = ruMonths[word] ?? enMonths[word];
    const iso = month ? isoDate(Number(match[2]), month) : null;
    if (iso) return { iso, precision: "month", approximate: true };
  }

  match = normalized.match(/\b(20\d{2}|21\d{2})\b/);
  if (match) return { iso: isoDate(Number(match[1]), 1, 1), precision: "year", approximate: true };

  return { iso: null, precision: "unknown", approximate: true };
}

type SteamGame = Record<string, any>;
type CoopType = "" | "generic" | "online" | "local" | "mixed";

type PlayerCandidate = {
  min: number;
  max: number;
  score: number;
  source: string;
};

function categoryInfo(game: SteamGame | null | undefined) {
  const categories = Array.isArray(game?.categories) ? game.categories : [];
  const ids = new Set<number>();
  const labels: string[] = [];
  for (const item of categories) {
    const id = Number(item?.id);
    if (Number.isFinite(id)) ids.add(id);
    const label = cleanText(item?.description).toLocaleLowerCase("ru-RU");
    if (label) labels.push(label);
  }
  return { ids, labels };
}

function collectDescriptionText(game: SteamGame | null | undefined): string {
  const categoryLabels = Array.isArray(game?.categories)
    ? game.categories.map((item: Record<string, unknown>) => cleanText(item?.description))
    : [];
  const genreLabels = Array.isArray(game?.genres)
    ? game.genres.map((item: Record<string, unknown>) => cleanText(item?.description))
    : [];
  return [
    game?.name,
    game?.short_description,
    game?.detailed_description,
    game?.about_the_game,
    ...categoryLabels,
    ...genreLabels,
  ].map(cleanText).filter(Boolean).join(". ");
}

function normalizePlayerRange(minValue: number, maxValue: number): { min: number; max: number } | null {
  let min = Math.trunc(minValue);
  let max = Math.trunc(maxValue);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min > max) [min, max] = [max, min];
  if (max < 1 || max > 256) return null;
  min = Math.max(1, Math.min(min, max));
  return { min, max };
}

function addCandidate(candidates: PlayerCandidate[], min: number, max: number, score: number, source: string) {
  const normalized = normalizePlayerRange(min, max);
  if (!normalized) return;
  candidates.push({ ...normalized, score, source });
}

function replacePlayerNumberWords(value: string): string {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    один: 1, одного: 1, одна: 1, двое: 2, два: 2, двух: 2, трое: 3, три: 3, трех: 3, трёх: 3,
    четверо: 4, четыре: 4, четырех: 4, четырёх: 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
    семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10
  };
  return value.replace(/[a-zа-яё]+/giu, word => String(words[word.toLocaleLowerCase('ru-RU')] ?? word));
}

function detectPlayerCount(text: string, supportsMultiplayer: boolean): PlayerCandidate | null {
  if (!supportsMultiplayer || !text) return null;
  const candidates: PlayerCandidate[] = [];
  const segments = replacePlayerNumberWords(text)
    .replace(/[•·|]/g, ".")
    .split(/(?<=[.!?;])\s+|\n+/)
    .map(part => part.trim())
    .filter(Boolean);

  const coopWord = /\bco[ -]?op\b|cooperative|кооператив\w*/iu;
  const playerWord = /players?|player|игрок(?:а|ов)?|человек/iu;

  for (const segment of segments) {
    const hasCoopContext = coopWord.test(segment);
    const hasPlayerContext = playerWord.test(segment);

    if (!hasPlayerContext) {
      for (const match of segment.matchAll(/(?:with\s+up\s+to|с\s+до)\s*(\d{1,2})\s*(?:friends?|друз(?:ьями|ей))/giu)) {
        addCandidate(candidates, 1, Number(match[1]) + 1, hasCoopContext ? 8 : 6, "steam_description_friends_plus_player");
      }
      continue;
    }

    for (const match of segment.matchAll(/(\d{1,2})\s*(?:-|–|—|to|до)\s*(\d{1,2})\s*(?:players?|player|игрок(?:а|ов)?|человек)/giu)) {
      addCandidate(candidates, Number(match[1]), Number(match[2]), hasCoopContext ? 10 : 7, "steam_description_range");
    }

    for (const match of segment.matchAll(/(?:up\s+to|до)\s*(\d{1,2})\s*(?:players?|player|игрок(?:а|ов)?|человек)/giu)) {
      addCandidate(candidates, 2, Number(match[1]), hasCoopContext ? 7 : 5, "steam_description_up_to");
    }

    for (const match of segment.matchAll(/(?:with\s+up\s+to|с\s+до)\s*(\d{1,2})\s*(?:friends?|друз(?:ьями|ей))/giu)) {
      addCandidate(candidates, 1, Number(match[1]) + 1, hasCoopContext ? 8 : 6, "steam_description_friends_plus_player");
    }

    for (const match of segment.matchAll(/(?:team|squad|команд(?:а|е|ой))[^.!?;]{0,24}?(?:up\s+to|до)\s*(\d{1,2})/giu)) {
      addCandidate(candidates, 2, Number(match[1]), hasCoopContext ? 7 : 5, "steam_description_team_size");
    }

    for (const match of segment.matchAll(/(\d{1,2})\s*[- ]?(?:players?|player|игрок(?:а|ов)?|человек)\s*(?:online\s+|local\s+)?(?:co[ -]?op|cooperative|кооператив\w*)/giu)) {
      addCandidate(candidates, 2, Number(match[1]), 8, "steam_description_coop_count");
    }

    for (const match of segment.matchAll(/(?:co[ -]?op|cooperative|кооператив\w*)[^.!?;]{0,60}?(?:for|на|до)?\s*(\d{1,2})\s*(?:players?|player|игрок(?:а|ов)?|человек)/giu)) {
      addCandidate(candidates, 2, Number(match[1]), 8, "steam_description_coop_count");
    }

    if (hasCoopContext) {
      for (const match of segment.matchAll(/\b(\d{1,2})\s*(?:players?|player|игрок(?:а|ов)?|человек)\b/giu)) {
        addCandidate(candidates, 2, Number(match[1]), 4, "steam_description_near_coop");
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || b.max - a.max || a.min - b.min);
  return candidates[0];
}

function detectCoop(gameRu: SteamGame, gameEn: SteamGame) {
  const ru = categoryInfo(gameRu);
  const en = categoryInfo(gameEn);
  const ids = new Set<number>([...ru.ids, ...en.ids]);
  const labels = [...ru.labels, ...en.labels].join(" | ");

  const hasSinglePlayer = ids.has(2) || /single[- ]player|одиночн/iu.test(labels);
  const hasMultiplayer = ids.has(1) || ids.has(36) || ids.has(37)
    || /multi[- ]player|online\s+pvp|shared.*pvp|многопользователь/iu.test(labels);
  const hasGeneric = ids.has(9) || /\bco[ -]?op\b|cooperative|кооператив/iu.test(labels);
  const hasOnline = ids.has(38) || /online\s+co[ -]?op|онлайн[^|]{0,20}кооператив|кооператив[^|]{0,20}(?:по сети|онлайн)/iu.test(labels);
  const hasLocal = ids.has(39) || (ids.has(44) && (hasGeneric || hasMultiplayer)) || ((ids.has(24) || /shared|split screen|раздел.*экран|общ.*экран/iu.test(labels)) && hasGeneric)
    || /local\s+co[ -]?op|локальн[^|]{0,20}кооператив/iu.test(labels);

  const isCoop = hasGeneric || hasOnline || hasLocal;
  let type: CoopType = "";
  if (hasOnline && hasLocal) type = "mixed";
  else if (hasOnline) type = "online";
  else if (hasLocal) type = "local";
  else if (isCoop) type = "generic";

  const text = `${collectDescriptionText(gameRu)}. ${collectDescriptionText(gameEn)}`;
  const playerCount = detectPlayerCount(text, isCoop || hasMultiplayer);
  const playersMin = hasSinglePlayer ? 1 : (playerCount?.min ?? (isCoop || hasMultiplayer ? 2 : 1));
  const playersMax = playerCount?.max ?? (isCoop || hasMultiplayer ? Math.max(playersMin, 2) : 1);

  return {
    isCoop,
    coopType: type,
    coopMinPlayers: isCoop && playerCount ? Math.max(2, playerCount.min) : null,
    coopMaxPlayers: isCoop ? playerCount?.max ?? null : null,
    coopSource: isCoop
      ? (playerCount ? `${playerCount.source}+steam_categories` : "steam_categories")
      : "steam_categories",
    playersMin,
    playersMax,
    playerCountSource: playerCount?.source ?? "steam_categories",
  };
}

async function fetchSteamGame(appId: string, language: "russian" | "english") {
  const endpoint = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=${language}&cc=ru`;
  const response = await fetch(endpoint, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "CR7-Suggestion-Site/1.1",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Steam (${language}) ответил с кодом ${response.status}.`);
  const payload = await response.json();
  const entry = payload?.[appId];
  if (!entry?.success || !entry?.data) throw new Error(`Steam (${language}) не вернул информацию об игре.`);
  return entry.data as SteamGame;
}

async function getSteamData(appId: string) {
  const [ruResult, enResult] = await Promise.allSettled([
    fetchSteamGame(appId, "russian"),
    fetchSteamGame(appId, "english"),
  ]);
  const gameRu = ruResult.status === "fulfilled" ? ruResult.value : null;
  const gameEn = enResult.status === "fulfilled" ? enResult.value : null;
  const game = gameRu ?? gameEn;
  if (!game) {
    const ruError = ruResult.status === "rejected" ? String(ruResult.reason?.message ?? ruResult.reason) : "";
    const enError = enResult.status === "rejected" ? String(enResult.reason?.message ?? enResult.reason) : "";
    throw new Error(`Steam не вернул данные игры. ${ruError || enError}`.trim());
  }
  const releaseDateText = String(game.release_date?.date ?? "").trim();
  const parsedDate = parseSteamDate(releaseDateText);
  return {
    appId: Number(appId),
    title: cleanText(game.name),
    description: cleanText(game.short_description),
    coverUrl: String(game.header_image ?? game.capsule_image ?? "").trim(),
    comingSoon: Boolean(game.release_date?.coming_soon),
    releaseDate: parsedDate.iso,
    releaseDateText,
    releaseDatePrecision: parsedDate.precision,
    releaseDateApproximate: parsedDate.approximate,
    steamUrl: `https://store.steampowered.com/app/${appId}/`,
    ...detectCoop(gameRu ?? game, gameEn ?? game),
  };
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    return String(details.message || details.details || details.hint || JSON.stringify(details));
  }
  return String(error);
}

async function publishSuggestion(
  serviceClient: ReturnType<typeof createClient>,
  suggestionId: number,
  moderatorId: string,
  requestedStatus = "approved",
) {
  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    throw new Error("Некорректный идентификатор заявки.");
  }

  const { data: suggestion, error: suggestionError } = await serviceClient
    .from("game_suggestions")
    .select("id,steam_app_id,steam_url,title,cover_url,description,status,players_min,players_max,player_count_source,steam_snapshot_synced_at")
    .eq("id", suggestionId)
    .maybeSingle();
  if (suggestionError) throw suggestionError;
  if (!suggestion) throw new Error("Заявка не найдена.");

  let steam;
  try {
    steam = await getSteamData(String(suggestion.steam_app_id));
  } catch (error) {
    console.warn("Steam enrichment failed during publication:", readableError(error));
    steam = {
      appId: Number(suggestion.steam_app_id),
      title: cleanText(suggestion.title),
      description: cleanText(suggestion.description),
      coverUrl: String(suggestion.cover_url || ""),
      comingSoon: false,
      releaseDate: null,
      releaseDateText: "",
      releaseDatePrecision: "unknown",
      releaseDateApproximate: false,
      steamUrl: String(suggestion.steam_url),
      isCoop: false,
      coopType: "",
      coopMinPlayers: null,
      coopMaxPlayers: null,
      coopSource: "suggestion_snapshot",
      playersMin: 1,
      playersMax: 1,
      playerCountSource: "suggestion_snapshot",
    };
  }
  const useSuggestionPlayerRange = Boolean(suggestion.steam_snapshot_synced_at)
    || Boolean(String(suggestion.player_count_source || "").trim())
    || Number(suggestion.players_min) > 1
    || Number(suggestion.players_max) > 1;
  const rawPlayersMin = useSuggestionPlayerRange ? Number(suggestion.players_min) : Number(steam.playersMin);
  const rawPlayersMax = useSuggestionPlayerRange ? Number(suggestion.players_max) : Number(steam.playersMax);
  const playersMin = Math.max(1, Math.min(256, Number.isFinite(rawPlayersMin) ? Math.trunc(rawPlayersMin) : 1));
  const playersMax = Math.max(playersMin, Math.min(256, Number.isFinite(rawPlayersMax) ? Math.trunc(rawPlayersMax) : playersMin));
  const playerCountSource = String(
    useSuggestionPlayerRange
      ? (suggestion.player_count_source || "suggestion_snapshot")
      : (steam.playerCountSource || "steam_categories")
  ).slice(0, 120);

  const { data: existingGame, error: existingError } = await serviceClient
    .from("games")
    .select("id,title,cover_url,description,coop_source,is_coop,coop_type,coop_min_players,coop_max_players")
    .eq("steam_app_id", Number(suggestion.steam_app_id))
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  const manualCoop = existingGame?.coop_source === "manual_admin";
  const corePayload = {
    steam_app_id: Number(suggestion.steam_app_id),
    steam_url: String(steam.steamUrl || suggestion.steam_url).slice(0, 500),
    title: cleanText(steam.title || suggestion.title).slice(0, 120),
    cover_url: String(steam.coverUrl || suggestion.cover_url || "").slice(0, 1000),
    description: cleanText(steam.description || suggestion.description || "Описание не указано.").slice(0, 2000),
    published: true,
  };
  const enrichmentPayload = {
    release_date: steam.releaseDate || null,
    release_date_text: String(steam.releaseDateText || "").slice(0, 120),
    coming_soon: steam.comingSoon,
    is_coop: manualCoop ? existingGame.is_coop : steam.isCoop,
    coop_type: manualCoop ? existingGame.coop_type : steam.isCoop ? (steam.coopType || "generic") : "",
    coop_min_players: manualCoop ? existingGame.coop_min_players : steam.coopMinPlayers,
    coop_max_players: manualCoop ? existingGame.coop_max_players : steam.coopMaxPlayers,
    coop_source: manualCoop ? existingGame.coop_source : steam.coopSource,
    players_min: playersMin,
    players_max: playersMax,
    player_count_source: playerCountSource,
    steam_synced_at: new Date().toISOString(),
  };

  let gameId: number;
  if (existingGame) {
    const { data: updated, error: updateError } = await serviceClient
      .from("games")
      .update(corePayload)
      .eq("id", existingGame.id)
      .select("id")
      .single();
    if (updateError) throw updateError;
    gameId = Number(updated.id);
  } else {
    const { data: inserted, error: insertError } = await serviceClient
      .from("games")
      .insert({
        ...corePayload,
        author_comment: "Предложено пользователями",
        display_order: 0,
        created_by: moderatorId,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    gameId = Number(inserted.id);
  }

  const { error: enrichmentError } = await serviceClient
    .from("games")
    .update(enrichmentPayload)
    .eq("id", gameId);
  const enrichmentWarning = enrichmentError ? readableError(enrichmentError) : "";
  if (enrichmentWarning) console.warn("Game published without optional Steam enrichment:", enrichmentWarning);

  const nextStatus = requestedStatus === "selected" ? "selected" : "approved";
  const { error: moderationError } = await serviceClient
    .from("game_suggestions")
    .update({
      status: nextStatus,
      rejection_reason: "",
      moderated_by: moderatorId,
      moderated_at: new Date().toISOString(),
    })
    .eq("id", suggestionId);
  if (moderationError) throw moderationError;

  return {
    suggestionId,
    gameId,
    title: corePayload.title,
    status: nextStatus,
    created: !existingGame,
    published: true,
    warning: enrichmentWarning || undefined,
  };
}

async function deletePublishedGame(
  serviceClient: ReturnType<typeof createClient>,
  gameId: number,
  moderatorId: string,
) {
  if (!Number.isInteger(gameId) || gameId <= 0) throw new Error("Некорректный идентификатор игры.");

  const { data: game, error: gameError } = await serviceClient
    .from("games")
    .select("id,title,steam_app_id")
    .eq("id", gameId)
    .maybeSingle();
  if (gameError) throw gameError;
  if (!game) return { gameId, deleted: true, missing: true, archivedSuggestions: 0 };

  const { error: deleteError } = await serviceClient.from("games").delete().eq("id", gameId);
  if (deleteError) throw deleteError;

  let archivedSuggestions = 0;
  let warning = "";
  if (game.steam_app_id) {
    const { data: archived, error: archiveError } = await serviceClient
      .from("game_suggestions")
      .update({
        status: "archived",
        rejection_reason: "Удалено из каталога администратором",
        moderated_by: moderatorId,
        moderated_at: new Date().toISOString(),
      })
      .eq("steam_app_id", Number(game.steam_app_id))
      .in("status", ["approved", "selected"])
      .select("id");
    archivedSuggestions = archived?.length ?? 0;
    warning = archiveError ? readableError(archiveError) : "";
    if (warning) console.warn("Game deleted, but linked suggestions were not archived:", warning);
  }

  return {
    gameId,
    title: game.title,
    deleted: true,
    archivedSuggestions,
    warning: warning || undefined,
  };
}

function syncApprovedSuggestions() {
  return { checked: 0, missing: 0, published: 0, results: [], automaticRecovery: false };
}

async function syncStaleGames(supabase: ReturnType<typeof createClient>) {
  const { data: games, error } = await supabase
    .from("games")
    .select("id,title,cover_url,description,steam_app_id,coming_soon,release_date,steam_synced_at,is_coop,coop_type,coop_min_players,coop_max_players,coop_source,players_min,players_max,player_count_source")
    .not("steam_app_id", "is", null)
    .order("steam_synced_at", { ascending: true, nullsFirst: true })
    .limit(100);
  if (error) throw error;

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const candidates = (games ?? []).filter((game) => {
    const lastSync = game.steam_synced_at ? new Date(game.steam_synced_at).getTime() : 0;
    const maxAge = game.coming_soon || !game.release_date ? 6 * hour : 7 * 24 * hour;
    return !lastSync || now - lastSync >= maxAge;
  }).slice(0, 18);

  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (let offset = 0; offset < candidates.length; offset += 3) {
    const batch = candidates.slice(offset, offset + 3);
    const settled = await Promise.all(batch.map(async (record) => {
      const steam = await getSteamData(String(record.steam_app_id));
      const manualCoop = record.coop_source === "manual_admin";
      const steamPlayersMin = Math.max(1, Math.min(256, Number(steam.playersMin) || 1));
      const steamPlayersMax = Math.max(steamPlayersMin, Math.min(256, Number(steam.playersMax) || steamPlayersMin));
      const payload = {
        title: steam.title || record.title,
        cover_url: steam.coverUrl || record.cover_url,
        description: steam.description || record.description,
        release_date: steam.releaseDate || null,
        release_date_text: steam.releaseDateText,
        coming_soon: steam.comingSoon,
        is_coop: manualCoop ? record.is_coop : steam.isCoop,
        coop_type: manualCoop ? record.coop_type : steam.isCoop ? (steam.coopType || "generic") : "",
        coop_min_players: manualCoop ? record.coop_min_players : steam.coopMinPlayers,
        coop_max_players: manualCoop ? record.coop_max_players : steam.coopMaxPlayers,
        coop_source: manualCoop ? record.coop_source : steam.coopSource,
        players_min: steamPlayersMin,
        players_max: steamPlayersMax,
        player_count_source: String(steam.playerCountSource || "steam_categories").slice(0, 120),
        steam_synced_at: new Date().toISOString(),
      };
      const { error: updateError } = await supabase.from("games").update(payload).eq("id", record.id);
      if (updateError) throw updateError;
      return record.id as number;
    }));
    settled.forEach((item, index) => {
      const id = Number(batch[index].id);
      if (item.status === "fulfilled") results.push({ id, ok: true });
      else results.push({ id, ok: false, error: String(item.reason?.message ?? item.reason) });
    });
  }
  return { checked: games?.length ?? 0, selected: candidates.length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Используй POST-запрос." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const scheduledRequest = body?.action === "sync-stale" && cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (scheduledRequest) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Сервисные переменные Supabase недоступны." }, 500);
      const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
      return jsonResponse(await syncStaleGames(serviceClient));
    }

    // Preview is read-only Steam metadata. Keep it public so the local file://
    // preview can still resolve real Steam cards without a Supabase auth session.
    if (body?.action === "suggestion-preview") {
      const previewAppId = extractAppId(body?.steamUrl ?? body?.appId);
      if (!previewAppId) return jsonResponse({ error: "Не удалось определить Steam App ID из ссылки." }, 400);
      return jsonResponse(await getSteamData(previewAppId));
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Требуется авторизованная сессия." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return jsonResponse({ error: "Переменные Supabase недоступны функции." }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: "Сессия истекла. Войди заново." }, 401);

    const { data: isAdmin, error: adminError } = await supabase.rpc("is_site_admin");
    if (adminError || isAdmin !== true) return jsonResponse({ error: "У аккаунта нет прав администратора." }, 403);

    if (["publish-suggestion", "sync-approved-suggestions", "delete-published-game"].includes(body?.action)) {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) return jsonResponse({ error: "Сервисный ключ Supabase недоступен функции." }, 500);
      const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (body.action === "publish-suggestion") {
        return jsonResponse(await publishSuggestion(
          serviceClient,
          Number(body?.suggestionId),
          userData.user.id,
        ));
      }
      if (body.action === "delete-published-game") {
        return jsonResponse(await deletePublishedGame(
          serviceClient,
          Number(body?.gameId),
          userData.user.id,
        ));
      }
      return jsonResponse(syncApprovedSuggestions());
    }

    const appId = extractAppId(body?.steamUrl ?? body?.appId);
    if (!appId) return jsonResponse({ error: "Не удалось определить Steam App ID из ссылки." }, 400);

    return jsonResponse(await getSteamData(appId));
  } catch (error) {
    console.error(error);
    const message = readableError(error) || "Неизвестная ошибка.";
    return jsonResponse({ error: `Не удалось выполнить операцию: ${message}` }, 500);
  }
});
