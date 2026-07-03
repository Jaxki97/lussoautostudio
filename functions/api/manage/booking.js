// =============================================================================
// GET /api/manage/booking?token=…
// Returns the booking summary + computed policy status for manage.html.
// The endpoint is the source of truth: within_cutoff is computed NOW.
// =============================================================================

import {
  CORS_HEADERS, json, resolveToken, noticeHours, appointmentUtcMs,
  formatTorontoInstant, RESCHEDULE_CAP,
} from "../_shared.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function bookingSummary(b) {
  const notice = noticeHours(b.date, b.start_hour);
  const cutoffMs = appointmentUtcMs(b.date, b.start_hour) - 24 * 3_600_000;
  return {
    ref:              b.ref,
    service:          b.service,
    date:             b.date,
    start_hour:       b.start_hour,
    end_hour:         b.end_hour,
    duration_hours:   b.duration_hours,
    city:             b.city || null,
    vehicle:          b.vehicle || null,
    status:           b.status,
    deposit_status:   b.deposit_status,
    reschedule_count: b.reschedule_count,
    reschedule_remaining: Math.max(0, RESCHEDULE_CAP - (b.reschedule_count ?? 0)),
    within_cutoff:    notice < 24,
    past:             notice <= 0,
    cutoff_label:     formatTorontoInstant(cutoffMs),
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  let booking;
  try {
    booking = await resolveToken(env, token);
  } catch (e) {
    console.error("[manage/booking] DB error:", e?.message ?? e);
    return json({ ok: false, error: "Something went wrong on our end. Please try again in a moment." }, 500);
  }

  if (!booking) {
    return json({ ok: false, error: "expired_link" }, 401);
  }

  return json({ ok: true, booking: bookingSummary(booking) });
}
