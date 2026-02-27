// =============================================================================
// /functions/api/admin/cancel.js
// POST /api/admin/cancel  { id: "<uuid>" }  →  sets booking status to cancelled
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
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

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "Missing booking id" }, 400);

  try {
    const result = await env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'active'`
    ).bind(id).run();

    if (result.changes === 0) {
      return json({ ok: false, error: "Booking not found or already cancelled" }, 404);
    }

    return json({ ok: true, id });
  } catch (e) {
    return json({ ok: false, error: "Database error", details: String(e?.message ?? e) }, 500);
  }
}
