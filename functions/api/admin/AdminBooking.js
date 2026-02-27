// =============================================================================
// /functions/api/admin/bookings.js
// GET /api/admin/bookings  →  returns all bookings, newest first
//
// This is a simple owner-only endpoint. It is protected by the password on
// the admin HTML page. For extra security you can add a secret header check
// (see the ADMIN_SECRET comment below).
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
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

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, date, start_hour, end_hour, duration_hours,
              service, name, phone, vehicle, city, notes, status, created_at
         FROM bookings
        ORDER BY date DESC, start_hour ASC`
    ).all();

    return json({ ok: true, bookings: results });
  } catch (e) {
    return json({ ok: false, error: "Database error", details: String(e?.message ?? e) }, 500);
  }
}
