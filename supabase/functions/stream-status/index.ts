const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Streamer = { provider: "twitch" | "kick"; channel: string };
type StreamStatus = Streamer & {
  available: boolean;
  live: boolean;
  title: string;
  category: string;
  thumbnailUrl: string;
  avatarUrl: string;
  startedAt: string;
};

let twitchToken = "";
let twitchTokenExpiresAt = 0;

const clean = (value: unknown, max = 300) => String(value ?? "").trim().slice(0,max);
const unavailable = (streamer: Streamer): StreamStatus => ({ ...streamer, available: false, live: false, title: "", category: "", thumbnailUrl: "", avatarUrl: "", startedAt: "" });
const imageUrl = (value: unknown): string => {
  const url = clean(value,500);
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://kick.com${url}`;
  return /^https?:\/\//i.test(url) ? url : "";
};
const statusFromPayload = (streamer: Streamer,item: Record<string,unknown> | undefined): StreamStatus => ({
  ...streamer,
  available: item?.available !== false,
  live: item?.live === true,
  title: clean(item?.title),
  category: clean(item?.category,120),
  thumbnailUrl: imageUrl(item?.thumbnailUrl),
  avatarUrl: imageUrl(item?.avatarUrl),
  startedAt: clean(item?.startedAt,80),
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body),{ status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=45" } });
}

function requestedStreamers(body: unknown): Streamer[] {
  const input = Array.isArray((body as { streamers?: unknown[] })?.streamers) ? (body as { streamers: unknown[] }).streamers : [];
  const seen = new Set<string>();
  return input.flatMap(item => {
    const provider = clean((item as Streamer)?.provider,10).toLowerCase();
    const channel = clean((item as Streamer)?.channel,40).toLowerCase();
    const key = `${provider}:${channel}`;
    if (!['twitch','kick'].includes(provider) || !/^[a-z0-9_]{2,40}$/.test(channel) || seen.has(key)) return [];
    seen.add(key);
    return [{ provider,channel } as Streamer];
  }).slice(0,30);
}

async function getTwitchToken(clientId: string,clientSecret: string) {
  if (twitchToken && Date.now() < twitchTokenExpiresAt - 60000) return twitchToken;
  const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,{ method: "POST" });
  if (!tokenResponse.ok) throw new Error(`Twitch OAuth: ${tokenResponse.status}`);
  const tokenData = await tokenResponse.json();
  twitchToken = clean(tokenData.access_token,200);
  twitchTokenExpiresAt = Date.now() + Number(tokenData.expires_in || 0) * 1000;
  if (!twitchToken) throw new Error("Twitch OAuth returned no token");
  return twitchToken;
}

async function russianProxyStatuses(streamers: Streamer[]): Promise<StreamStatus[] | null> {
  const endpoint = clean(Deno.env.get("RU_STREAM_STATUS_URL"),500);
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("RU stream status proxy must use HTTPS");
  const token = clean(Deno.env.get("RU_STREAM_STATUS_TOKEN"),500);
  const headers: Record<string,string> = { "Content-Type": "application/json", "Accept": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const proxyResponse = await fetch(url,{
    method: "POST",
    headers,
    body: JSON.stringify({ streamers }),
    signal: AbortSignal.timeout(10000),
  });
  if (!proxyResponse.ok) throw new Error(`RU stream status proxy: ${proxyResponse.status}`);
  const payload = await proxyResponse.json();
  const received = Array.isArray(payload?.streamers) ? payload.streamers as Record<string,unknown>[] : [];
  return streamers.map(streamer => {
    const item = received.find(candidate => clean(candidate?.provider,10).toLowerCase() === streamer.provider
      && clean(candidate?.channel,40).toLowerCase() === streamer.channel);
    return item ? statusFromPayload(streamer,item) : unavailable(streamer);
  });
}

async function twitchStatuses(streamers: Streamer[]): Promise<StreamStatus[]> {
  if (!streamers.length) return [];
  try {
    const regionalResult = await russianProxyStatuses(streamers);
    if (regionalResult) return regionalResult;
  } catch (error) {
    console.error(error);
  }
  const clientId = clean(Deno.env.get("TWITCH_CLIENT_ID"),200);
  const clientSecret = clean(Deno.env.get("TWITCH_CLIENT_SECRET"),300);
  if (!clientId || !clientSecret) return streamers.map(unavailable);
  try {
    const token = await getTwitchToken(clientId,clientSecret);
    const headers = { "Client-Id": clientId, "Authorization": `Bearer ${token}` };
    const streamQuery = streamers.map(({ channel }) => `user_login=${encodeURIComponent(channel)}`).join('&');
    const userQuery = streamers.map(({ channel }) => `login=${encodeURIComponent(channel)}`).join('&');
    const [streamsResponse,usersResponse] = await Promise.all([
      fetch(`https://api.twitch.tv/helix/streams?${streamQuery}`,{ headers }),
      fetch(`https://api.twitch.tv/helix/users?${userQuery}`,{ headers }),
    ]);
    if (!streamsResponse.ok || !usersResponse.ok) throw new Error(`Twitch Helix: ${streamsResponse.status}/${usersResponse.status}`);
    const [streamsPayload,usersPayload] = await Promise.all([streamsResponse.json(),usersResponse.json()]);
    const streams = new Map((streamsPayload.data || []).map((item: Record<string,unknown>) => [clean(item.user_login,40).toLowerCase(),item]));
    const users = new Map((usersPayload.data || []).map((item: Record<string,unknown>) => [clean(item.login,40).toLowerCase(),item]));
    return streamers.map(streamer => {
      const stream = streams.get(streamer.channel) as Record<string,unknown> | undefined;
      const user = users.get(streamer.channel) as Record<string,unknown> | undefined;
      return {
        ...streamer, available: Boolean(user), live: Boolean(stream),
        title: clean(stream?.title), category: clean(stream?.game_name,120),
        thumbnailUrl: clean(stream?.thumbnail_url,500), avatarUrl: clean(user?.profile_image_url,500),
        startedAt: clean(stream?.started_at,80),
      };
    });
  } catch (error) {
    console.error(error);
    return streamers.map(unavailable);
  }
}

async function kickStatus(streamer: Streamer): Promise<StreamStatus> {
  try {
    const result = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(streamer.channel)}`,{ headers: { "Accept": "application/json", "User-Agent": "Predlozhka141/1.0" } });
    if (!result.ok) throw new Error(`Kick: ${result.status}`);
    const data = await result.json();
    const live = data.livestream || null;
    const thumbnail = live?.thumbnail?.url || (typeof live?.thumbnail === "string" ? live.thumbnail : "") || live?.thumbnail_url || data.banner_image?.url || data.banner_image?.src;
    const avatar = data.user?.profile_pic || data.user?.profile_picture || data.profile_picture || data.user?.avatar || data.avatar;
    return {
      ...streamer, available: true, live: Boolean(live), title: clean(live?.session_title),
      category: clean(live?.categories?.[0]?.name || live?.category?.name,120),
      thumbnailUrl: imageUrl(thumbnail),
      avatarUrl: imageUrl(avatar),
      startedAt: clean(live?.start_time || live?.created_at || live?.started_at,80),
    };
  } catch (error) {
    console.error(error);
    return unavailable(streamer);
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok",{ headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" },405);
  try {
    const streamers = requestedStreamers(await request.json());
    const twitch = streamers.filter(item => item.provider === 'twitch');
    const kick = streamers.filter(item => item.provider === 'kick');
    const [twitchResult,kickResult] = await Promise.all([twitchStatuses(twitch),Promise.all(kick.map(kickStatus))]);
    return response({
      streamers: [...twitchResult,...kickResult],
      checkedAt: new Date().toISOString(),
      region: clean(Deno.env.get("SB_REGION"),40),
    });
  } catch (error) {
    console.error(error);
    return response({ error: "Invalid request" },400);
  }
});
