function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function requireAdmin(env, request) {
  const url = new URL(request.url);
  const token =
    request.headers.get("x-admin-token") ||
    url.searchParams.get("token") ||
    "";

  return env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

function isWeekend(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  return day === 0 || day === 6;
}

function daysBetweenUTC(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((ub - ua) / ms);
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export async function onRequest({ env, request }) {
  if (!requireAdmin(env, request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);

  // GET /api/admin?date=YYYY-MM-DD  -> list bookings for date
  if (request.method === "GET") {
    const date = url.searchParams.get("date");
    if (date) {
      const { results } = await env.DB.prepare(
        "SELECT * FROM bookings WHERE date = ? ORDER BY start_hour ASC"
      ).bind(date).all();
      return json({ ok: true, bookings: results });
    } else {
      const { results } = await env.DB.prepare(
        "SELECT * FROM bookings ORDER BY date DESC, start_hour ASC LIMIT 200"
      ).all();
      return json({ ok: true, bookings: results });
    }
  }

  // POST actions: cancel, move
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const action = body.action;

    // Cancel booking
    if (action === "cancel") {
      const id = body.id;
      if (!id) return json({ error: "Missing id" }, 400);

      await env.DB.prepare(
        "UPDATE bookings SET status='cancelled' WHERE id=?"
      ).bind(id).run();

      return json({ ok: true });
    }

    // Move booking (keeps same duration)
    if (action === "move") {
      const id = body.id;
      const date = body.date; // YYYY-MM-DD
      const start_hour = Number(body.start_hour);

      if (!id || !date || !Number.isInteger(start_hour)) {
        return json({ error: "Missing fields" }, 400);
      }

      // rules: weekend + within 30 days + within hours
      if (!isWeekend(date)) return json({ error: "Weekend bookings only." }, 400);

      const now = new Date();
      const [y, m, d] = date.split("-").map(Number);
      const reqDate = new Date(Date.UTC(y, m - 1, d));
      const diff = daysBetweenUTC(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        reqDate
      );
      if (diff < 0 || diff > 30) return json({ error: "Must be within 30 days." }, 400);

      const booking = await env.DB.prepare(
        "SELECT * FROM bookings WHERE id=?"
      ).bind(id).first();

      if (!booking) return json({ error: "Booking not found." }, 404);
      if (booking.status !== "active") return json({ error: "Only active bookings can be moved." }, 400);

      const duration = booking.duration_hours;
      const end_hour = start_hour + duration;

      const OPEN_HOUR = 8;
      const CLOSE_HOUR = 20;
      if (start_hour < OPEN_HOUR || end_hour > CLOSE_HOUR) {
        return json({ error: "Outside business hours." }, 400);
      }

      // Check overlap against other bookings on that date
      const existing = await env.DB.prepare(
        "SELECT id, start_hour, end_hour FROM bookings WHERE date=? AND status='active'"
      ).bind(date).all();

      for (const row of existing.results || []) {
        if (row.id === id) continue;
        if (overlap(start_hour, end_hour, row.start_hour, row.end_hour)) {
          return json({ error: "Target time is already booked." }, 409);
        }
      }

      await env.DB.prepare(
        "UPDATE bookings SET date=?, start_hour=?, end_hour=? WHERE id=?"
      ).bind(date, start_hour, end_hour, id).run();

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  }

  return json({ error: "Method not allowed" }, 405);
}
