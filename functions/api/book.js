function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}

function isWeekend(dateStr) {
  // dateStr = YYYY-MM-DD
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 Sun, 6 Sat
  return day === 0 || day === 6;
}

function daysBetweenUTC(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((ub - ua) / ms);
}

function serviceDurationHours(service) {
  // You can tweak these anytime
  const s = (service || "").toLowerCase();
  if (s.includes("full")) return 4;          // Full Detail = 4 hours
  if (s.includes("interior")) return 3;      // Interior Deep Clean = 3 hours
  if (s.includes("maintenance")) return 2;   // Maintenance Wash = 2 hours
  return 3; // default
}

function normalizePhone(phone) {
  return (phone || "").replace(/[^\d+]/g, "").slice(0, 20);
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const date = body.date;              // YYYY-MM-DD
  const start_hour = toInt(body.start_hour); // 8..18 etc
  const service = (body.service || "").trim();

  const name = (body.name || "").trim();
  const phone = normalizePhone(body.phone);
  const vehicle = (body.vehicle || "").trim();
  const city = (body.city || "").trim();
  const notes = (body.notes || "").trim();

  if (!date || !Number.isInteger(start_hour) || !service || !name || !phone || !vehicle || !city) {
    return json({ error: "Missing required fields" }, 400);
  }

  // Weekend only
  if (!isWeekend(date)) {
    return json({ error: "Bookings are available on weekends only." }, 400);
  }

  // Next 30 days only
  const now = new Date();
  const [y, m, d] = date.split("-").map(Number);
  const reqDate = new Date(Date.UTC(y, m - 1, d));
  const diff = daysBetweenUTC(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    reqDate
  );

  if (diff < 0 || diff > 30) {
    return json({ error: "Bookings can only be made within the next 30 days." }, 400);
  }

  // Business hours (start time only; duration blocks automatically)
  const duration_hours = serviceDurationHours(service);
  const end_hour = start_hour + duration_hours;

  // Customize hours here (8am to 8pm)
  const OPEN_HOUR = 8;
  const CLOSE_HOUR = 20; // end must be <= 20

  if (start_hour < OPEN_HOUR || end_hour > CLOSE_HOUR) {
    return json({ error: `Please choose a start time between ${OPEN_HOUR}:00 and ${CLOSE_HOUR - 1}:00.` }, 400);
  }

  // Prevent double booking by checking overlap for that date
  const existing = await env.DB.prepare(
    "SELECT start_hour, end_hour FROM bookings WHERE date = ? AND status = 'active'"
  )
    .bind(date)
    .all();

  for (const row of existing.results || []) {
    if (overlap(start_hour, end_hour, row.start_hour, row.end_hour)) {
      return json({ error: "That time is already booked. Please choose another start time." }, 409);
    }
  }

  // Create booking
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO bookings
      (id, date, start_hour, duration_hours, end_hour, service, name, phone, vehicle, city, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  )
    .bind(id, date, start_hour, duration_hours, end_hour, service, name, phone, vehicle, city, notes || null, created_at)
    .run();

  return json({
    ok: true,
    booking: { id, date, start_hour, end_hour, duration_hours, service }
  });
}
