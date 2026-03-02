// =============================================================================
// /functions/api/admin/membership.js
// GET /api/admin/membership  →  returns all membership applications
// Protected by x-admin-token header (same ADMIN_TOKEN secret as bookings)
// =============================================================================

const CORS = {
  "access-control-allow-origin":  "https://lussoautostudio.ca",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = request.headers.get("x-admin-token");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // ── Optional status filter ─────────────────────────────────────────────────
  const url    = new URL(request.url);
  const status = url.searchParams.get("status"); // e.g. ?status=pending

  try {
    let query = `
      SELECT id, name, phone, vehicle, city, parking, preferred_start,
             message, status, rejection_reason, payment_link_sent_at,
             square_subscription_id, next_billing_date, last_payment_status,
             cancel_at, event_log, created_at
        FROM membership_applications
    `;
    const binds = [];
    if (status) {
      query += " WHERE status = ?";
      binds.push(status);
    }
    query += " ORDER BY created_at DESC LIMIT 500";

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return json({ ok: true, applications: results });
  } catch (e) {
    console.error("[admin/membership] DB error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred." }, 500);
  }
}
