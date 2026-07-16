#!/usr/bin/env node
// Run a .sql file (or inline SQL via --q) against the CRM Supabase project through
// the Management API. The repo's convention is hand-applied migrations; this is the
// hand, so an idempotent migration can be applied and re-applied without a psql.
//
//   node scripts/run-sql.mjs scripts/migrations/2026-07-14-fiscal-verifactu.sql
//   node scripts/run-sql.mjs --q "select 1"
//
// SUPABASE_MGMT_TOKEN + SUPABASE_PROJECT_REF come from the environment.
// ⚠️ Cloudflare in front of api.supabase.com 403s (code 1010) on a non-browser
// User-Agent — hence the UA below. Learned the hard way.

import { readFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_MGMT_TOKEN / SUPABASE_PROJECT_REF");
  process.exit(1);
}

const args = process.argv.slice(2);
const inline = args[0] === "--q";
const sql = inline ? args.slice(1).join(" ") : readFileSync(args[0], "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}\n${text}`);
  process.exit(1);
}
console.log(text);
