import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "stream-submissions";
const SIGNED_URL_TTL_SECONDS = 600;
const MAX_SUBMISSIONS = 50;

const allowedOrigins = new Set([
  "https://141gang.ru",
  "https://www.141gang.ru",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:8000",
  "http://localhost:8000",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://141gang.ru",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "GET") return json(request, { error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json(request, { error: "service_unavailable" }, 503);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: submissions, error: submissionsError } = await admin
      .from("media_submissions")
      .select("id,title,comment,media_type,updated_at,moderated_at,published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(MAX_SUBMISSIONS);
    if (submissionsError) throw submissionsError;

    const submissionIds = (submissions ?? []).map((submission) => submission.id);
    const { data: files, error: filesError } = submissionIds.length
      ? await admin
        .from("media_submission_files")
        .select("submission_id,storage_path,mime_type,file_size,sort_order")
        .in("submission_id", submissionIds)
        .order("sort_order", { ascending: true })
      : { data: [], error: null };
    if (filesError) throw filesError;

    const filesBySubmission = new Map<string, Array<Record<string, unknown>>>();
    for (const file of files ?? []) {
      const key = String(file.submission_id);
      const group = filesBySubmission.get(key) ?? [];
      group.push(file);
      filesBySubmission.set(key, group);
    }

    const items = await Promise.all((submissions ?? []).map(async (submission, submissionIndex) => {
      const sourceFiles = filesBySubmission.get(String(submission.id)) ?? [];
      const publicFiles = await Promise.all(sourceFiles.map(async (file, fileIndex) => {
        const storagePath = String(file.storage_path ?? "");
        // Legacy paths contained uploader/submission UUIDs. Never put those
        // paths into a visitor-visible signed URL; admins can re-upload them
        // once under the opaque objects/<random> naming scheme.
        if (!/^objects\/[A-Za-z0-9-]{16,100}\.(?:jpe?g|png|webp|gif|mp4|webm|mov)$/i.test(storagePath)) {
          return null;
        }
        const { data, error } = await admin.storage
          .from(BUCKET)
          .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: false });
        if (error || !data?.signedUrl) return null;
        return {
          id: `file-${submissionIndex + 1}-${fileIndex + 1}`,
          mime_type: String(file.mime_type ?? "application/octet-stream"),
          file_size: Number(file.file_size) || 0,
          sort_order: Number(file.sort_order) || 0,
          signed_url: data.signedUrl,
        };
      }));

      return {
        id: `media-${submissionIndex + 1}`,
        title: String(submission.title ?? ""),
        comment: String(submission.comment ?? ""),
        status: "published",
        media_type: String(submission.media_type ?? "photo"),
        updated_at: submission.updated_at,
        moderated_at: submission.moderated_at,
        published_at: submission.published_at,
        media_submission_files: publicFiles.filter(Boolean),
      };
    }));

    return json(request, { items });
  } catch (error) {
    console.error("public-media:", error);
    return json(request, { error: "feed_unavailable" }, 500);
  }
});
