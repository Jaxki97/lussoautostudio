// =============================================================================
// /functions/api/admin/cancel.js
// POST /api/admin/cancel  { id: "<uuid>" }  →  sets booking status to cancelled
//
// PROTECTED: Requires x-admin-token header matching the ADMIN_TOKEN secret.
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "https://lussoautostudio.ca",
  "access-control-allow-methods": "POST, OPTIONS",
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

export async function onRequestPost({ request, env }) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const token = request.headers.get("x-admin-token");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "Missing booking id" }, 400);

  // ── Cancel ───────────────────────────────────────────────────────────────────
  try {
    const result = await env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'active'`
    ).bind(id).run();

    if (result.changes === 0) {
      return json({ ok: false, error: "Booking not found or already cancelled" }, 404);
    }

    return json({ ok: true, id });
  } catch (e) {
    console.error("[admin/cancel] DB error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }
}
