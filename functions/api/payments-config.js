// =============================================================================
// GET /api/payments-config
// Tells the frontend whether card deposits are live and which Square app to
// tokenize against. Only public identifiers — never the access token.
// =============================================================================

import { CORS_HEADERS, json, squareConfigured } from "./_shared.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ env }) {
  if (!squareConfigured(env) || !env.SQUARE_APPLICATION_ID) {
    return json({ ok: true, enabled: false });
  }
  return json({
    ok: true,
    enabled: true,
    application_id: env.SQUARE_APPLICATION_ID,
    location_id: env.SQUARE_LOCATION_ID,
    environment: env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
    deposit_cents: 5000,
  });
}
