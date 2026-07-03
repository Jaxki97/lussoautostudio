// One-time backfill: generate LAS-B-YYMMDD-XXXX refs for bookings (and
// LAS-M-… for membership applications) that don't have one yet.
//
// Usage:
//   node scripts/backfill-refs.mjs           # local .wrangler sqlite via wrangler
//   node scripts/backfill-refs.mjs --remote  # production D1 (run after migrations)
//
// Requires: wrangler logged in. Uses `wrangler d1 execute lusso_bookings`.

import { execSync } from "node:child_process";

const REMOTE = process.argv.includes("--remote") ? "--remote" : "--local";
const DB = "lusso_bookings";
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function d1(sql) {
  const out = execSync(
    `npx wrangler d1 execute ${DB} ${REMOTE} --json --command ${JSON.stringify(sql)}`,
    { encoding: "utf8" }
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

function refFor(type, createdAt) {
  const d = new Date(createdAt || Date.now());
  // Toronto local date for the label
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "2-digit", month: "2-digit", day: "2-digit" })
      .formatToParts(d).map(x => [x.type, x.value])
  );
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `LAS-${type}-${p.year}${p.month}${p.day}-${suffix}`;
}

function backfill(table, type) {
  let rows;
  try {
    rows = d1(`SELECT id, created_at FROM ${table} WHERE ref IS NULL`);
  } catch {
    console.log(`${table}: table or ref column missing — skipped`);
    return;
  }
  console.log(`${table}: ${rows.length} row(s) need a ref`);
  for (const row of rows) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const ref = refFor(type, row.created_at);
      try {
        d1(`UPDATE ${table} SET ref = '${ref}' WHERE id = '${row.id}'`);
        console.log(`  ${row.id} → ${ref}`);
        break;
      } catch (e) {
        if (attempt === 4) throw e; // 5 collisions in a row is not a collision problem
      }
    }
  }
}

backfill("bookings", "B");
backfill("membership_applications", "M");
console.log("Done.");
