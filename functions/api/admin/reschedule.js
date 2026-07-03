// =============================================================================
// POST /api/admin/reschedule
// { booking_id, date, start_hour, deposit_action: refund|carry|forfeit, reason }
//
// Owner override: bypasses the 24h cutoff and the reschedule cap entirely.
// Respects the 30-day window and uses the same atomic swap as the customer
// path. Sends the customer the SAME email as a self-service on-time
// reschedule — a phone-arranged change must be indistinguishable.
// =============================================================================

import {
  CORS_HEADERS, json, noticeHours, validateTargetSlot, atomicSwap,
  refundDeposit, forfeitDeposit, getOrCreateManageToken, manageLink,
  sendEmail, ownerLine, emailRescheduleOnTime, formatHour, esc,
} from "../_shared.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const DEPOSIT_ACTIONS = ["refund", "carry", "forfeit"];

export async function onRequestPost({ request, env }) {
  const token = request.headers.get("x-admin-token");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const bookingId     = String(body.booking_id ?? "").trim();
  const newDate       = String(body.date ?? "");
  const newStart      = Number(body.start_hour);
  const depositAction = String(body.deposit_action ?? "");
  const reason        = String(body.reason ?? "").trim().slice(0, 500);

  if (!bookingId) return json({ ok: false, error: "Missing booking_id" }, 400);
  if (!DEPOSIT_ACTIONS.includes(depositAction)) {
    return json({ ok: false, error: "deposit_action must be refund, carry, or forfeit" }, 400);
  }
  if (!reason) return json({ ok: false, error: "A reason is required" }, 400);

  try {
    const booking = await env.DB.prepare(
      "SELECT * FROM bookings WHERE id = ? AND status = 'active'"
    ).bind(bookingId).first();
    if (!booking) return json({ ok: false, error: "Booking not found or not active" }, 404);

    // 30-day window still applies to admin moves
    const target = await validateTargetSlot(env, newDate, newStart, booking.duration_hours);
    if (!target.ok) return json({ ok: false, error: target.error }, 400);
    const newEnd = target.end_hour;

    // Always record notice_hours, even for admin actions
    const notice = Math.round(noticeHours(booking.date, booking.start_hour) * 10) / 10;
    const at = new Date().toISOString();
    const event = {
      event: "admin_reschedule",
      from: { date: booking.date, start_hour: booking.start_hour },
      to:   { date: newDate, start_hour: newStart },
      by: "owner",
      reason,
      deposit: depositAction,
      notice_hours: notice,
      at,
    };

    const depositStatus = depositAction === "refund" ? "refunded"
                        : depositAction === "forfeit" ? "forfeited" : null;

    // Same atomic swap as the customer path; does NOT increment reschedule_count
    const swapped = await atomicSwap(env, booking.id, newDate, newStart, newEnd, event,
      { incrementCount: false, depositStatus });
    if (!swapped) return json({ ok: false, error: "That slot was just taken." }, 409);

    if (depositAction === "refund")  await refundDeposit(booking, env);
    if (depositAction === "forfeit") await forfeitDeposit(booking, env);

    const updated = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(booking.id).first();
    const mToken = await getOrCreateManageToken(env, updated);

    // Customer email: identical to a self-service on-time reschedule
    const mail = emailRescheduleOnTime(updated, manageLink(mToken));
    await sendEmail(env, updated.email, mail.subject, mail.html);
    await ownerLine(env, `Admin reschedule — ${updated.ref}`,
      `${esc(updated.ref)} — Admin reschedule: ${event.from.date} ${formatHour(event.from.start_hour)} → ${newDate} ${formatHour(newStart)}. Deposit: ${depositAction}. Reason: ${esc(reason)}.`);

    return json({ ok: true, id: updated.id, ref: updated.ref, date: updated.date, start_hour: updated.start_hour });
  } catch (e) {
    console.error("[admin/reschedule] error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }
}
