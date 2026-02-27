// =============================================================================
// /functions/api/book.js  —  Creates a booking after validating all rules.
//
// POST /api/book
// Body (JSON):
//   { date, start_hour, duration_hours, service, name, phone, vehicle, city, notes }
//
// Success: { ok: true, id: "<uuid>" }
// Error:   { ok: false, error: "<message>" }
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const OPEN_HOUR  = 8;   // Earliest allowed start
const CLOSE_HOUR = 20;  // Latest allowed end  (no booking may end after this)

// Allowlist of valid service → duration mappings.
// This is the SINGLE SOURCE OF TRUTH for service durations.
// Update here if you add or change services — nowhere else.
const SERVICES = {
  "Maintenance Wash":   1,
  "Interior Deep Clean": 2,
  "Full Detail":        4,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function sanitizeString(value, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Request body must be valid JSON" }, 400);
  }

  // ── Field extraction ────────────────────────────────────────────────────────
  const date           = sanitizeString(body.date);
  const service        = sanitizeString(body.service);
  const name           = sanitizeString(body.name);
  const phone          = sanitizeString(body.phone);
  const vehicle        = sanitizeString(body.vehicle);
  const city           = sanitizeString(body.city);
  const notes          = sanitizeString(body.notes);
  const start_hour     = Number(body.start_hour);
  const duration_hours = Number(body.duration_hours);

  // ── Input validation ────────────────────────────────────────────────────────

  // Date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, error: "Missing or invalid date (expect YYYY-MM-DD)" }, 400);
  }

  // Start hour must be an integer within operating hours
  if (!Number.isInteger(start_hour) || start_hour < OPEN_HOUR || start_hour >= CLOSE_HOUR) {
    return json({ ok: false, error: `start_hour must be between ${OPEN_HOUR} and ${CLOSE_HOUR - 1}` }, 400);
  }

  // Service must be a recognised name
  if (!SERVICES[service]) {
    return json(
      { ok: false, error: `Unknown service. Valid options: ${Object.keys(SERVICES).join(", ")}` },
      400
    );
  }

  // Duration must match the service — clients cannot send an arbitrary duration
  const expectedDuration = SERVICES[service];
  if (duration_hours !== expectedDuration) {
    return json(
      {
        ok: false,
        error: `Duration mismatch: "${service}" requires ${expectedDuration} hour(s), received ${duration_hours}`,
      },
      400
    );
  }

  // Booking must finish within operating hours
  const end_hour = start_hour + duration_hours;
  if (end_hour > CLOSE_HOUR) {
    return json(
      {
        ok: false,
        error: `Booking would end at ${end_hour}:00, past closing time of ${CLOSE_HOUR}:00`,
      },
      400
    );
  }

  // Required customer fields
  if (!name)    return json({ ok: false, error: "Name is required" }, 400);
  if (!phone)   return json({ ok: false, error: "Phone is required" }, 400);
  if (!vehicle) return json({ ok: false, error: "Vehicle is required" }, 400);

  // ── Date business rules ─────────────────────────────────────────────────────
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) {
    return json({ ok: false, error: "Invalid date" }, 400);
  }

  // Weekend-only
  const dow = d.getUTCDay();
  if (dow !== 0 && dow !== 6) {
    return json({ ok: false, error: "Bookings are only available on weekends" }, 400);
  }

  // 30-day window
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const diffDays = (d.getTime() - todayUTC.getTime()) / 86_400_000;
  if (diffDays < 0) {
    return json({ ok: false, error: "Cannot book a date in the past" }, 400);
  }
  if (diffDays > 30) {
    return json({ ok: false, error: "Bookings can only be made up to 30 days in advance" }, 400);
  }

  // ── Overlap / double-booking check ─────────────────────────────────────────
  // Uses the same interval math as slots.js:
  //   Two intervals [aStart, aEnd) and [bStart, bEnd) overlap when:
  //     aStart < bEnd  AND  aEnd > bStart
  // The SQL equivalent: NOT (end_hour <= ? OR start_hour >= ?)
  try {
    const overlap = await env.DB.prepare(
      `SELECT COUNT(*) AS c
         FROM bookings
        WHERE date = ?
          AND status = 'active'
          AND NOT (end_hour <= ? OR start_hour >= ?)`
    )
      .bind(date, start_hour, end_hour)
      .first();

    if ((overlap?.c ?? 0) > 0) {
      return json(
        { ok: false, error: "That time slot is no longer available. Please choose another time." },
        409
      );
    }
  } catch (e) {
    return json({ ok: false, error: "Database error during overlap check", details: String(e?.message ?? e) }, 500);
  }

  // ── Insert booking ──────────────────────────────────────────────────────────
  const id         = crypto.randomUUID();
  const created_at = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO bookings
         (id, date, start_hour, duration_hours, end_hour,
          service, name, phone, vehicle, city, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
      .bind(
        id,
        date,
        start_hour,
        duration_hours,
        end_hour,
        service,
        name,
        phone,
        vehicle,
        city,
        notes,
        created_at
      )
      .run();
  } catch (e) {
    return json({ ok: false, error: "Failed to save booking", details: String(e?.message ?? e) }, 500);
  }

  return json({ ok: true, id, date, start_hour, end_hour, service }, 201);
}
