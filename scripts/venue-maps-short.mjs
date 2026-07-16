#!/usr/bin/env node
// One-off + reusable: generate a SHORT Google-Maps link (da.gd) for each tenant that
// has an address, and store it at settings.venue.maps_short. The WhatsApp bot then shows
// only the short link instead of the long bare URL. Idempotent: skips when maps_short
// already matches the current long URL. Pass --dry to preview without writing.
import fs from "node:fs";

const DRY = process.argv.includes("--dry");
const ONLY = process.argv.find(a => a.startsWith("--ids="));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL");
const KEY = get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_ || !KEY) { console.error("Missing Supabase env"); process.exit(1); }

// Same formula as kb-generator.ts mapsLink() and n8n _venueMapsLink().
function mapsLink(address, city) {
  const q = [address, city].map((s) => (s || "").trim()).filter(Boolean).join(", ");
  return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : "";
}

// da.gd: free, no API key, no Cloudflare, redirects straight to the target (no tracker).
async function shorten(longUrl) {
  const r = await fetch("https://da.gd/s?url=" + encodeURIComponent(longUrl), {
    headers: { "User-Agent": "baliflow-crm/1.0" },
  });
  const text = (await r.text()).trim();
  if (!r.ok || !/^https?:\/\/da\.gd\//.test(text)) {
    throw new Error(`da.gd failed (HTTP ${r.status}): ${text.slice(0, 120)}`);
  }
  return text;
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function main() {
  const filter = ONLY
    ? `id=in.(${ONLY.split("=")[1]})`
    : `settings->venue->>address=not.is.null`;
  const res = await fetch(
    `${URL_}/rest/v1/tenants?${filter}&select=id,name,slug,settings`,
    { headers }
  );
  if (!res.ok) throw new Error(`fetch tenants HTTP ${res.status}: ${await res.text()}`);
  const tenants = await res.json();

  for (const t of tenants) {
    const venue = t.settings?.venue;
    if (!venue || !venue.address) { console.log(`- ${t.name}: no venue address, skip`); continue; }
    const longUrl = mapsLink(venue.address, venue.city);
    if (!longUrl) { console.log(`- ${t.name}: empty maps url, skip`); continue; }

    // Idempotency: store the long url we shortened from, so we only re-shorten on change.
    if (venue.maps_short && venue.maps_short_src === longUrl) {
      console.log(`= ${t.name}: maps_short up to date (${venue.maps_short})`);
      continue;
    }

    const short = await shorten(longUrl);
    console.log(`${DRY ? "[dry] " : ""}+ ${t.name}: ${short}  <-  ${longUrl}`);
    if (DRY) continue;

    const newSettings = {
      ...t.settings,
      venue: { ...venue, maps_short: short, maps_short_src: longUrl },
    };
    const up = await fetch(`${URL_}/rest/v1/tenants?id=eq.${t.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ settings: newSettings }),
    });
    if (!up.ok) throw new Error(`PATCH ${t.name} HTTP ${up.status}: ${await up.text()}`);
    console.log(`  saved.`);
  }
  console.log("done.");
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
