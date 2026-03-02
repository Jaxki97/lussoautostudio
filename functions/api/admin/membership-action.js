// =============================================================================
// /functions/api/admin/membership-action.js
// POST /api/admin/membership-action
//
// Body: { id, action, reason? }
// action: "accept" | "reject" | "cancel" | "cancel_immediate"
// Protected by x-admin-token header.
// =============================================================================

const CORS = {
  "access-control-allow-origin":  "https://lussoautostudio.ca",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function sanitize(val, max = 1000) {
  return typeof val === "string" ? val.trim().slice(0, max) : "";
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = request.headers.get("x-admin-token");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON." }, 400); }

  const id     = sanitize(body.id, 40);
  const action = sanitize(body.action, 30);
  const reason = sanitize(body.reason, 1000);

  if (!id)     return json({ ok: false, error: "Missing id." }, 400);
  if (!action) return json({ ok: false, error: "Missing action." }, 400);

  const VALID_ACTIONS = ["accept", "reject", "cancel", "cancel_immediate"];
  if (!VALID_ACTIONS.includes(action)) {
    return json({ ok: false, error: `Invalid action. Valid: ${VALID_ACTIONS.join(", ")}` }, 400);
  }

  if (action === "reject" && !reason) {
    return json({ ok: false, error: "Rejection reason is required." }, 400);
  }

  // ── Fetch existing record ──────────────────────────────────────────────────
  let existing;
  try {
    existing = await env.DB.prepare(
      `SELECT id, status, event_log FROM membership_applications WHERE id = ?`
    ).bind(id).first();
  } catch (e) {
    console.error("[membership-action] DB fetch error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred." }, 500);
  }

  if (!existing) {
    return json({ ok: false, error: "Application not found." }, 404);
  }

  const now      = new Date().toISOString();
  let eventLog   = [];
  try { eventLog = JSON.parse(existing.event_log || "[]"); } catch {}

  // ── Apply action ──────────────────────────────────────────────────────────
  let updateSQL   = "";
  let updateBinds = [];

  if (action === "accept") {
    if (!["pending"].includes(existing.status)) {
      return json({ ok: false, error: `Cannot accept an application with status '${existing.status}'.` }, 409);
    }
    eventLog.push({ event: "accepted", note: "Application accepted by admin.", at: now });
    updateSQL   = `UPDATE membership_applications SET status = 'accepted', event_log = ? WHERE id = ?`;
    updateBinds = [JSON.stringify(eventLog), id];

  } else if (action === "reject") {
    if (!["pending"].includes(existing.status)) {
      return json({ ok: false, error: `Cannot reject an application with status '${existing.status}'.` }, 409);
    }
    eventLog.push({ event: "rejected", note: `Rejected. Reason: ${reason}`, at: now });
    updateSQL   = `UPDATE membership_applications SET status = 'rejected', rejection_reason = ?, event_log = ? WHERE id = ?`;
    updateBinds = [reason, JSON.stringify(eventLog), id];

  } else if (action === "cancel") {
    // Graceful cancel — membership stays active for 30 more days
    if (!["active", "accepted"].includes(existing.status)) {
      return json({ ok: false, error: `Cannot cancel an application with status '${existing.status}'.` }, 409);
    }
    const cancelAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    eventLog.push({ event: "cancel_scheduled", note: `Membership will end on ${cancelAt.slice(0,10)}.`, at: now });
    updateSQL   = `UPDATE membership_applications SET status = 'cancel_scheduled', cancel_at = ?, event_log = ? WHERE id = ?`;
    updateBinds = [cancelAt, JSON.stringify(eventLog), id];

  } else if (action === "cancel_immediate") {
    eventLog.push({ event: "cancelled_immediate", note: "Membership cancelled immediately by admin.", at: now });
    updateSQL   = `UPDATE membership_applications SET status = 'cancelled', cancelled_at = ?, event_log = ? WHERE id = ?`;
    updateBinds = [now, JSON.stringify(eventLog), id];
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    const result = await env.DB.prepare(updateSQL).bind(...updateBinds).run();
    if (result.changes === 0) {
      return json({ ok: false, error: "No rows updated. Application may not exist." }, 404);
    }
  } catch (e) {
    console.error("[membership-action] DB update error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred." }, 500);
  }

  return json({ ok: true, id, action });
}
