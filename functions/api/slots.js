// =============================================================================
// /functions/api/slots.js  —  Returns available start times for a given date
// and service duration.
//
// GET /api/slots?date=YYYY-MM-DD&duration_hours=4
//
// Response:
//   { ok: true, slots: [{ start_hour, end_hour, label, end_label, status }] }
//
// Architecture: Occupied-hour blocking model.
//   A start time is BOOKED if that hour falls inside any existing booking's
//   [start_hour, end_hour) range. This means only the hours that are literally
//   taken show as grey — regardless of what service the customer is browsing.
//
//   Example: Full Detail booked 1–5 PM → hours 1, 2, 3, 4 are grey.
//            Hour 5 is available. Hours before 1 PM are available.
//
//   Note: book.js still enforces true overlap prevention on write, so a
//   customer cannot book a slot whose duration would run into a booked block.
//   The frontend should also warn the user if their selected start + duration
//   would collide (see end_hour in the response for the booked slots).
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "https://lussoautostudio.ca",
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
    console.error("[slots] DB error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }

  // ── Build a set of all occupied hours ──────────────────────────────────────
  // For each existing booking [start_hour, end_hour), mark every integer hour
  // in that range as occupied. e.g. booking 13–17 → occupies {13,14,15,16}.
  const occupiedHours = new Set();
  for (const { start_hour, end_hour } of existingBookings) {
    for (let h = start_hour; h < end_hour; h++) {
      occupiedHours.add(h);
    }
  }

  // ── Build slot list ─────────────────────────────────────────────────────────
  // Show every hour from OPEN to CLOSE as a potential start time.
  // A slot is "booked" if that specific hour is occupied by an existing booking.
  // Slots where the duration would run past closing are excluded silently.
  const slots = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    const end = h + duration_hours;
    const isOccupied = occupiedHours.has(h);
    const fitsBeforeClose = end <= CLOSE_HOUR;

    // Drop unselectable free slots at end of day (e.g. 8 PM start for 4hr service)
    if (!fitsBeforeClose && !isOccupied) continue;

    slots.push({
      start_hour: h,
      end_hour:   end,
      label:      formatHour(h),
      end_label:  formatHour(Math.min(end, CLOSE_HOUR)),
      // Occupied hours grey out. Hours that don't fit the duration also grey
      // so the grid looks complete near closing time.
      status: (isOccupied || !fitsBeforeClose) ? "booked" : "available",
    });
  }

  return json({ ok: true, slots, date, duration_hours }, 200);
}
