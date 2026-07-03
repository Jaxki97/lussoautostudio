// =============================================================================
// POST /api/manage/reschedule   { token, date, start_hour }
// Customer self-service reschedule. Enforces the reschedule cap, the 30-day
// window, and the live 24h deposit decision — all server-side, at action time.
// =============================================================================

import {
  CORS_HEADERS, json, resolveToken, noticeHours, validateTargetSlot,
  atomicSwap, RESCHEDULE_CAP, collectDeposit, forfeitDeposit, refundDeposit,
  squareConfigured, getOrCreateManageToken, manageLink, sendEmail, ownerLine,
  emailRescheduleOnTime, emailRescheduleLate, formatHour, esc,
} from "../_shared.js";
import { bookingSummary } from "./booking.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid request." }, 400); }

  const newDate  = String(body.date ?? "");
  const newStart = Number(body.start_hour);

  try {
    // 1. Token → active booking
    const booking = await resolveToken(env, body.token);
    if (!booking) return json({ ok: false, error: "expired_link" }, 401);
    if (booking.status !== "active") {
      return json({ ok: false, error: "This appointment is no longer active." }, 409);
    }

    // 2. Reschedule cap
    if ((booking.reschedule_count ?? 0) >= RESCHEDULE_CAP) {
      return json({ ok: false, error: "reschedule limit reached" }, 409);
    }

    // 3. Target slot validity (30-day window, weekend, hours, blocked dates)
    const target = await validateTargetSlot(env, newDate, newStart, booking.duration_hours);
    if (!target.ok) return json({ ok: false, error: target.error }, 400);
    const newEnd = target.end_hour;

    if (newDate === booking.date && newStart === booking.start_hour) {
      return json({ ok: false, error: "That's already your appointment time." }, 400);
    }

    // 4. Live 24h decision on the CURRENT appointment
    const notice = Math.round(noticeHours(booking.date, booking.start_hour) * 10) / 10;
    const late = notice < 24;

    // 5–6. Deposit + atomic swap
    let event, emailBuilder;
    const from = { date: booking.date, start_hour: booking.start_hour };
    const to   = { date: newDate, start_hour: newStart };
    const at   = new Date().toISOString();

    if (late) {
      // Original deposit is forfeited; a fresh $50 secures the new slot.
      // The customer consented (and entered a card) in the confirm step.
      if (squareConfigured(env) && !body.payment_token) {
        return json({ ok: false, error: "deposit_required" }, 402);
      }
      const collected = await collectDeposit(booking, env, body.payment_token);
      if (!collected.ok) {
        return json({ ok: false, error: "Your card couldn't be charged. Please check the details and try again." }, 402);
      }
      await forfeitDeposit(booking, env);
      event = { event: "reschedule_late", from, to, by: "customer", notice_hours: notice, deposit: "forfeited_new_required", at };
      emailBuilder = emailRescheduleLate;

      const swapped = await atomicSwap(env, booking.id, newDate, newStart, newEnd, event,
        { incrementCount: true, depositStatus: "held", squarePaymentId: collected.square_payment_id });
      if (!swapped) {
        // Slot vanished between charge and swap — put the fresh deposit back.
        if (collected.square_payment_id) {
          await refundDeposit({ id: booking.id, square_payment_id: collected.square_payment_id, deposit_amount_cents: booking.deposit_amount_cents }, env);
        }
        return json({ ok: false, error: "slot_taken" }, 409);
      }
    } else {
      event = { event: "reschedule", from, to, by: "customer", notice_hours: notice, deposit: "carried", at };
      emailBuilder = emailRescheduleOnTime;

      const swapped = await atomicSwap(env, booking.id, newDate, newStart, newEnd, event,
        { incrementCount: true });
      if (!swapped) return json({ ok: false, error: "slot_taken" }, 409);
    }

    // Refresh state + extend the manage token to the new appointment
    const updated = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(booking.id).first();
    const token = await getOrCreateManageToken(env, updated);
    const link = manageLink(token);

    // 7. Emails — customer + owner
    const mail = emailBuilder(updated, link);
    await sendEmail(env, updated.email, mail.subject, mail.html);
    await ownerLine(env, `Reschedule — ${updated.ref}`,
      `${esc(updated.ref)} — ${esc(updated.name)} rescheduled: ${from.date} ${formatHour(from.start_hour)} → ${to.date} ${formatHour(to.start_hour)}. Notice: ${notice}h. Deposit: ${late ? "new deposit required" : "carried"}.`);

    return json({ ok: true, booking: bookingSummary(updated) });
  } catch (e) {
    console.error("[manage/reschedule] error:", e?.message ?? e);
    return json({ ok: false, error: "Something went wrong on our end. Please try again in a moment." }, 500);
  }
}
