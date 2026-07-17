// Cron dispatch — maps a Cloudflare Cron Trigger tick to the /api/cron/*
// endpoints that must run at that hour.
//
// WHY a dispatcher (not one trigger per cron): Cloudflare Workers Free caps an
// account at 5 Cron Triggers. The CRM has 8 cron endpoints. So a single hourly
// trigger ("0 * * * *") fires the scheduled() handler, and this module decides
// which endpoints to call based on the UTC hour — the same hours vercel.json
// used (Vercel ran those schedules in UTC).
//
// The six daily jobs keep their exact vercel.json hour. booking-reminders and
// post-visit-followup were NOT in vercel.json (Vercel Hobby forbade sub-daily
// crons, so n8n drove them); n8n is now off, so we run both EVERY hour — both
// are idempotent via audit_events (see their route headers), so an hourly tick
// can never double-send.
//
// Cloudflare Cron Triggers do NOT send an Authorization header — they invoke
// scheduled(). Each route still requires `Authorization: Bearer ${CRON_SECRET}`
// unchanged, so the caller (runCronTick) injects it. Nothing about the route
// handlers changes.

export interface CronJob {
  /** Path under /api/cron. */
  path: string;
  /** UTC hour (0-23) at which this job runs, or "hourly" for every tick. */
  hour: number | "hourly";
}

// Hours are UTC, byte-identical to the old vercel.json schedules.
export const CRON_JOBS: CronJob[] = [
  { path: "pos-sync", hour: 2 }, // was 30 2 * * *
  { path: "purge-tenants", hour: 3 }, // was 0 3 * * *
  { path: "reconcile-provisioning", hour: 4 }, // was 15 4 * * *
  { path: "data-retention", hour: 4 }, // was 45 4 * * *
  { path: "credits-reset", hour: 5 }, // was 20 5 * * *
  { path: "fiscal-flush", hour: 5 }, // was 50 5 * * *
  { path: "booking-reminders", hour: "hourly" }, // n8n-driven before; now hourly
  { path: "post-visit-followup", hour: "hourly" }, // n8n-driven before; now hourly
];

/** The cron paths that must run at the given UTC hour. */
export function jobsForHour(utcHour: number): string[] {
  return CRON_JOBS.filter(
    (j) => j.hour === "hourly" || j.hour === utcHour,
  ).map((j) => j.path);
}

export interface RunCronTickDeps {
  /** Trigger time (ms epoch) — Cloudflare passes controller.scheduledTime. */
  scheduledTime: number;
  /** Absolute base URL of this worker, e.g. https://crm.baliflowagency.com. */
  baseUrl: string;
  /** Shared secret the /api/cron/* routes require as `Bearer`. */
  cronSecret: string;
  fetchImpl: typeof fetch;
}

export interface CronTickResult {
  hour: number;
  ran: { path: string; status: number | "error" }[];
}

/**
 * Fire every cron endpoint due at the tick's UTC hour, each as an authenticated
 * internal GET. One endpoint failing never aborts the others (a bad OCR run
 * must not starve credits-reset). Returns per-endpoint status for logging.
 */
export async function runCronTick(deps: RunCronTickDeps): Promise<CronTickResult> {
  const hour = new Date(deps.scheduledTime).getUTCHours();
  const paths = jobsForHour(hour);
  const ran: CronTickResult["ran"] = [];
  for (const path of paths) {
    try {
      const res = await deps.fetchImpl(`${deps.baseUrl}/api/cron/${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${deps.cronSecret}` },
      });
      ran.push({ path, status: res.status });
    } catch {
      ran.push({ path, status: "error" });
    }
  }
  return { hour, ran };
}
