// =============================================================================
// POST /api/manage/cancel   { token }
// Customer self-service cancel. Live 24h refund/retain decision, server-side.
// =============================================================================

import {
  CORS_HEADERS, json, resolveToken, noticeHours,
  refundDeposit, forfeitDeposit, sendEmail, ownerLine,
  emailCancelRefunded, emailCancelRetained, formatHour, esc,
} from "../_shared.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid request." }, 400); }

  try {
    const booking = await resolveToken(env, body.token);
    if (!booking) return json({ ok: false, error: "expired_link" }, 401);
    if (booking.status !== "active") {
      return json({ ok: false, error: "This appointment is no longer active." }, 409);
    }

    const notice = Math.round(noticeHours(booking.date, booking.start_hour) * 10) / 10;
    const late = notice < 24;
    const at = new Date().toISOString();

    const event = late
      ? { event: "cancel_late", by: "customer", notice_hours: notice, deposit: "retained", at }
      : { event: "cancel",      by: "customer", notice_hours: notice, deposit: "refunded", at };

    // Cancel + free the slot + record deposit outcome, atomically on the row
    const res = await env.DB.prepare(
      `UPDATE bookings
          SET status = 'cancelled',
              deposit_status = ?,
              event_log = json_insert(event_log, '$[#]', json(?))
        WHERE id = ? AND status = 'active'`
    ).bind(late ? "forfeited" : "refunded", JSON.stringify(event), booking.id).run();

    if ((res.meta?.changes ?? 0) === 0) {
      return json({ ok: false, error: "This appointment is no longer active." }, 409);
    }

    if (late) await forfeitDeposit(booking, env);
    else      await refundDeposit(booking, env);

    const mail = late ? emailCancelRetained(booking) : emailCancelRefunded(booking);
    await sendEmail(env, booking.email, mail.subject, mail.html);
    await ownerLine(env, `Cancellation — ${booking.ref}`,
      `${esc(booking.ref)} — ${esc(booking.name)} cancelled (${booking.date} ${formatHour(booking.start_hour)}). Notice: ${notice}h. Deposit: ${late ? "retained" : "refunded"}.`);

    return json({ ok: true, outcome: late ? "retained" : "refunded" });
  } catch (e) {
    console.error("[manage/cancel] error:", e?.message ?? e);
    return json({ ok: false, error: "Something went wrong on our end. Please try again in a moment." }, 500);
  }
}
