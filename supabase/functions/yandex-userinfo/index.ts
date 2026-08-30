const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown,status = 200) {
  return new Response(JSON.stringify(body),{
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null,{ status: 204, headers: corsHeaders });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' },405);

  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!accessToken) return json({ error: 'missing_access_token' },401);

  try {
    const response = await fetch('https://login.yandex.ru/info?format=json',{
      headers: {
        Accept: 'application/json',
        Authorization: `OAuth ${accessToken}`,
      },
    });
    const profile = await response.json().catch(() => null);
    if (!response.ok || !profile) {
      return json({ error: 'yandex_profile_error' },response.status || 502);
    }

    const subject = String(profile.id || profile.uid || '').trim();
    const email = String(profile.default_email || profile.emails?.[0] || '').trim();
    if (!subject || !email) return json({ error: 'incomplete_yandex_profile' },422);

    const displayName = String(
      profile.real_name
      || profile.display_name
      || profile.login
      || email.split('@')[0]
    ).trim();
    const avatarId = String(profile.default_avatar_id || profile.avatar_id || '').trim();
    const picture = avatarId
      ? `https://avatars.yandex.net/get-yapic/${encodeURIComponent(avatarId)}/islands-200`
      : '';

    return json({
      sub: subject,
      id: subject,
      email,
      email_verified: true,
      name: displayName,
      display_name: displayName,
      preferred_username: String(profile.login || '').trim(),
      picture,
      avatar_url: picture,
    });
  } catch (error) {
    console.error('Yandex userinfo proxy:',error);
    return json({ error: 'yandex_unavailable' },502);
  }
});
