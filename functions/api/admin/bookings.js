// =============================================================================
// /functions/api/admin/bookings.js
// GET /api/admin/bookings  →  returns all bookings, newest first
//
// PROTECTED: Requires a secret token sent as the x-admin-token request header.
// The token value must match the ADMIN_TOKEN environment variable set as a
// Cloudflare Secret (Pages → Settings → Environment Variables → Add secret).
//
// Setup:
//   1. Go to Cloudflare Dashboard → your Pages project → Settings → Environment Variables
//   2. Under "Secrets", click Add secret
//   3. Name: ADMIN_TOKEN   Value: make up a long random string (e.g. lusso-admin-a7f3k9x2)
//   4. Save → Redeploy
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "https://lussoautostudio.ca",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  // Read the token the browser sent in the x-admin-token header
  const token = request.headers.get("x-admin-token");

  // Compare it against the secret stored in Cloudflare env
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // ── Fetch bookings ───────────────────────────────────────────────────────────
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, date, start_hour, end_hour, duration_hours,
              service, name, phone, vehicle, city, notes, status, created_at
         FROM bookings
        ORDER BY date DESC, start_hour ASC
        LIMIT 500`
    ).all();

    return json({ ok: true, bookings: results });
  } catch (e) {
    // Log internally but never expose DB details to the client
    console.error("[admin/bookings] DB error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }
}
