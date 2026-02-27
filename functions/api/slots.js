// =============================================================================
// /functions/api/slots.js  —  Returns available start times for a given date
// and service duration.
//
// GET /api/slots?date=YYYY-MM-DD&duration_hours=4
//
// Response:
//   { ok: true, slots: [{ start_hour, label, end_label, status }] }
//
// Architecture: Start-time blocking model.
//   A candidate slot [start, start+duration) is AVAILABLE if and only if it
//   does NOT overlap with any existing booking's [start_hour, end_hour).
//   Two intervals overlap when: start < bEnd && end > bStart
//   (equivalently, NOT (end <= bStart || start >= bEnd))
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const OPEN_HOUR  = 8;   // 8:00 AM  — first possible start
const CLOSE_HOUR = 20;  // 8:00 PM  — no booking may end after this

// Map duration (hours) → friendly service name for reference / error messages
const DURATION_LABELS = {
  1: "Maintenance Wash (1 hr)",
  2: "Interior Deep Clean (2 hrs)",
  4: "Full Detail (4 hrs)",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

// Format integer hour → "8:00 AM" / "1:00 PM"
function formatHour(h) {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const rawDuration = url.searchParams.get("duration_hours");

  // ── Input validation ────────────────────────────────────────────────────────
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, error: "Missing or invalid date (expect YYYY-MM-DD)" }, 400);
  }

  const duration_hours = Number(rawDuration);
  if (!Number.isInteger(duration_hours) || duration_hours < 1 || duration_hours > 8) {
    return json({ ok: false, error: "duration_hours must be an integer 1–8" }, 400);
  }

  // ── Weekend-only guard ──────────────────────────────────────────────────────
  // Parse as UTC midnight so the weekday is always stable regardless of server TZ
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) {
    return json({ ok: false, error: "Invalid date" }, 400);
  }
  const dow = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (dow !== 0 && dow !== 6) {
    // Return an empty slot list — not an error.  The frontend can show a
    // "weekends only" message based on the empty array.
    return json({ ok: true, slots: [], reason: "weekday" }, 200);
  }

  // ── 30-day booking window guard ─────────────────────────────────────────────
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const diffDays = (d.getTime() - todayUTC.getTime()) / 86_400_000;
  if (diffDays < 0) {
    return json({ ok: true, slots: [], reason: "past" }, 200);
  }
  if (diffDays > 30) {
    return json({ ok: true, slots: [], reason: "too_far" }, 200);
  }

  // ── Fetch existing bookings ─────────────────────────────────────────────────
  let existingBookings;
  try {
    const { results } = await env.DB.prepare(
      `SELECT start_hour, end_hour
         FROM bookings
        WHERE date = ? AND status = 'active'`
    )
      .bind(date)
      .all();
    existingBookings = results; // [{ start_hour, end_hour }, ...]
  } catch (e) {
    return json({ ok: false, error: "Database error", details: String(e?.message ?? e) }, 500);
  }

  // ── Core overlap check ──────────────────────────────────────────────────────
  // Candidate slot  : [candidateStart, candidateEnd)
  // Existing booking: [bStart,         bEnd)
  // They overlap when: candidateStart < bEnd  &&  candidateEnd > bStart
  function wouldOverlap(candidateStart, candidateEnd) {
    for (const { start_hour: bStart, end_hour: bEnd } of existingBookings) {
      if (candidateStart < bEnd && candidateEnd > bStart) return true;
    }
    return false;
  }

  // ── Build slot list ─────────────────────────────────────────────────────────
  // A start time `h` is valid only if the booking would finish by CLOSE_HOUR.
  // Last valid start = CLOSE_HOUR - duration_hours
  const slots = [];
  for (let h = OPEN_HOUR; h <= CLOSE_HOUR - duration_hours; h++) {
    const end = h + duration_hours;
    const blocked = wouldOverlap(h, end);

    slots.push({
      start_hour: h,           // Integer — use for API calls
      end_hour:   end,         // Integer — useful for display
      label:      formatHour(h),      // e.g. "9:00 AM"
      end_label:  formatHour(end),    // e.g. "1:00 PM"
      status:     blocked ? "booked" : "available",
    });
  }

  return json({ ok: true, slots, date, duration_hours }, 200);
}
