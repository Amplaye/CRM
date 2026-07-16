import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api-error";

type RawEvent = {
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
};

type GeoRow = {
  ip: string;
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
  org: string | null;
  fetched_at: string;
};

type Geo = Omit<GeoRow, "ip" | "fetched_at">;

const memCache = new Map<string, { geo: Geo; expiresAt: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

const isPrivateIp = (ip: string) =>
  !ip ||
  ip.startsWith("10.") ||
  ip.startsWith("192.168.") ||
  ip.startsWith("127.") ||
  ip === "::1" ||
  ip.startsWith("172.16.") ||
  ip.startsWith("fc00:") ||
  ip.startsWith("fe80:");

async function fetchGeo(ip: string): Promise<Geo> {
  if (isPrivateIp(ip)) {
    return { country: "Private", country_code: null, city: null, region: null, org: null };
  }
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { "User-Agent": "BaliFlow-CRM-Security/1.0" },
      // Short timeout via AbortSignal
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`ipapi ${res.status}`);
    const j = await res.json();
    return {
      country: j.country_name ?? null,
      country_code: j.country_code ?? null,
      city: j.city ?? null,
      region: j.region ?? null,
      org: j.org ?? null,
    };
  } catch {
    return { country: null, country_code: null, city: null, region: null, org: null };
  }
}

function parseUserAgent(ua: string | null) {
  if (!ua) return { browser: "Unknown", os: "Unknown" };
  let browser = "Other";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  let os = "Other";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Linux/i.test(ua)) os = "Linux";
  return { browser, os };
}

export async function GET(req: NextRequest) {
  try {
    // Auth: caller must be a platform admin
    const userClient = await createServerSupabaseClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const service = createServiceRoleClient();
    const { data: profile } = await service
      .from("users")
      .select("global_role")
      .eq("id", user.id)
      .single();
    if (profile?.global_role !== "platform_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") || 30)));

    // Pull raw login events via RPC (security definer, gated by is_platform_admin).
    // Call via the user client so auth.uid() resolves inside the function.
    const { data: rawData, error: rawErr } = await userClient.rpc("admin_get_login_events", { p_days: days });
    if (rawErr) {
      return NextResponse.json({ error: rawErr.message }, { status: 500 });
    }
    const events: RawEvent[] = (rawData as RawEvent[]) || [];

    // Collect unique IPs
    const uniqueIps = Array.from(new Set(events.map(e => e.ip_address).filter((x): x is string => !!x)));

    // Pull existing cache rows
    const { data: cached } = await service
      .from("ip_geo_cache")
      .select("*")
      .in("ip", uniqueIps.length ? uniqueIps : ["__none__"]);
    const cacheMap = new Map<string, GeoRow>(((cached || []) as GeoRow[]).map((r): [string, GeoRow] => [r.ip, r]));

    // Determine which IPs need a fresh fetch
    const now = Date.now();
    const ipsToFetch: string[] = [];
    for (const ip of uniqueIps) {
      const mem = memCache.get(ip);
      if (mem && mem.expiresAt > now) continue;
      const row = cacheMap.get(ip);
      if (row && now - new Date(row.fetched_at).getTime() < TTL_MS) {
        memCache.set(ip, {
          geo: { country: row.country, country_code: row.country_code, city: row.city, region: row.region, org: row.org },
          expiresAt: now + TTL_MS,
        });
        continue;
      }
      ipsToFetch.push(ip);
    }

    // Fetch missing geos in parallel (cap to 25 per request to avoid hammering ipapi)
    const fetchSlice = ipsToFetch.slice(0, 25);
    const fetched = await Promise.all(fetchSlice.map(async ip => ({ ip, geo: await fetchGeo(ip) })));
    if (fetched.length) {
      // Persist new rows
      await service.from("ip_geo_cache").upsert(
        fetched.map(f => ({ ip: f.ip, ...f.geo, fetched_at: new Date().toISOString() })),
        { onConflict: "ip" }
      );
      for (const f of fetched) {
        memCache.set(f.ip, { geo: f.geo, expiresAt: now + TTL_MS });
      }
    }

    // Resolve geo lookup helper
    const geoFor = (ip: string | null): Geo => {
      if (!ip) return { country: null, country_code: null, city: null, region: null, org: null };
      const mem = memCache.get(ip);
      if (mem) return mem.geo;
      const row = cacheMap.get(ip);
      if (row) return { country: row.country, country_code: row.country_code, city: row.city, region: row.region, org: row.org };
      return { country: null, country_code: null, city: null, region: null, org: null };
    };

    // Build per-user history for anomaly detection (across the queried window).
    // An IP is "new" if it's the first time we see it for that actor; a country
    // is "new" the same way. We walk events oldest -> newest to seed history.
    const seenIpByUser = new Map<string, Set<string>>();
    const seenCountryByUser = new Map<string, Set<string>>();
    const dailyIpCountByUser = new Map<string, Map<string, Set<string>>>(); // user -> day -> set(ip)

    const sortedAsc = [...events].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const enriched = sortedAsc.map(ev => {
      const userKey = ev.actor_id || ev.actor_email || "unknown";
      const geo = geoFor(ev.ip_address);
      const day = ev.created_at.slice(0, 10);

      const ipSet = seenIpByUser.get(userKey) || new Set<string>();
      const countrySet = seenCountryByUser.get(userKey) || new Set<string>();
      const dayMap = dailyIpCountByUser.get(userKey) || new Map<string, Set<string>>();
      const daySet = dayMap.get(day) || new Set<string>();

      const isNewIp = !!ev.ip_address && !ipSet.has(ev.ip_address);
      const isNewCountry = !!geo.country && !countrySet.has(geo.country);

      if (ev.ip_address) {
        ipSet.add(ev.ip_address);
        daySet.add(ev.ip_address);
      }
      if (geo.country) countrySet.add(geo.country);

      seenIpByUser.set(userKey, ipSet);
      seenCountryByUser.set(userKey, countrySet);
      dayMap.set(day, daySet);
      dailyIpCountByUser.set(userKey, dayMap);

      const hour = new Date(ev.created_at).getHours();
      const offHours = hour >= 22 || hour < 7;

      const ua = parseUserAgent(ev.user_agent);

      return {
        ...ev,
        geo,
        browser: ua.browser,
        os: ua.os,
        day,
        flags: {
          new_ip: isNewIp,
          new_country: isNewCountry && countrySet.size > 1, // skip very first ever
          off_hours: offHours,
          // many_ips_same_day computed in a second pass below
          many_ips_same_day: false,
        },
      };
    });

    // Second pass: many_ips_same_day if >3 distinct IPs on same day for same user.
    for (const ev of enriched) {
      const userKey = ev.actor_id || ev.actor_email || "unknown";
      const dayMap = dailyIpCountByUser.get(userKey);
      if (!dayMap) continue;
      const daySet = dayMap.get(ev.day);
      if (daySet && daySet.size > 3) {
        ev.flags.many_ips_same_day = true;
      }
    }

    // Return desc again for UI
    enriched.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

    // Filter out token_refreshed for the main view but keep counts available;
    // we focus on actual login events.
    const logins = enriched.filter(e => e.action === "login" || e.action === "user_signedup");

    return NextResponse.json({
      events: logins,
      total: logins.length,
      anomalies: logins.filter(e => Object.values(e.flags).some(Boolean)).length,
      window_days: days,
    });
  } catch (err: any) {
    return apiError(err, { route: "admin/login-events", publicMessage: "operation_failed", status: 500 });
  }
}
