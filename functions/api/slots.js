function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export async function onRequestOptions() {
  return json({ ok: true }, 200);
}

function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getUTCDay(); // 0 Sun, 6 Sat
  return day === 0 || day === 6;
}

function daysBetweenUTC(aStr, bStr) {
  const a = new Date(`${aStr}T00:00:00Z`).getTime();
  const b = new Date(`${bStr}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const duration = Number(url.searchParams.get("duration_hours") || "0");

  if (!date || !Number.isFinite(duration) || duration < 1 || duration > 8) {
    return json({ error: "Missing/invalid date or duration_hours" }, 400);
  }

  // Only weekends
  if (!isWeekend(date)) {
    return json({ ok: true, date, duration_hours: duration, slots: [] }, 200);
  }

  // Next 30 days limit
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const diff = daysBetweenUTC(todayStr, date);
  if (diff < 0 || diff > 30) {
    return json({ error: "Date out of allowed range (next 30 days)" }, 400);
  }

  // Working hours: 8 to 20 (8am to 8pm). End hour must be <= 20
  const open = 8;
  const close = 20;

  // Get all bookings for that date
  const rows = await env.DB.prepare(
    `SELECT start_hour, end_hour
     FROM bookings
     WHERE date = ?
       AND status = 'active'`
  ).bind(date).all();

  const booked = (rows?.results || []).map(r => ({
    s: Number(r.start_hour),
    e: Number(r.end_hour)
  }));

  function overlaps(s, e) {
    for (const b of booked) {
      if (!(e <= b.s || s >= b.e)) return true;
    }
    return false;
  }

  const slots = [];
  for (let start = open; start + duration <= close; start++) {
    const end = start + duration;
    const is_booked = overlaps(start, end);
    slots.push({ start_hour: start, end_hour: end, status: is_booked ? "booked" : "available" });
  }

  return json({ ok: true, date, duration_hours: duration, slots });
}
