import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-log";

// Uniform error responses for route handlers that face the public internet
// (webhooks, public forms, unauthenticated APIs). Raw `e.message` from a DB
// driver or an SDK leaks schema names, constraint names and provider details
// to anonymous callers — so the client gets a stable public message plus a
// requestId, and the real detail goes to the server logs (and to system_logs
// for 5xx, so Monitoring/Trello sees it).
//
// Usage:
//   } catch (e) {
//     return apiError(e, { route: "public/booking", publicMessage: "booking_failed" });
//   }
// The response shape keeps the `error` key the frontends already read.

export type ApiErrorOptions = {
  /** Short route tag for logs, e.g. "public/booking". */
  route: string;
  /** Stable, non-sensitive message returned to the caller. */
  publicMessage?: string;
  /** HTTP status (default 500). */
  status?: number;
  /** Extra safe fields to merge into the JSON response. */
  extra?: Record<string, unknown>;
};

export function newRequestId(): string {
  // Compact, log-greppable id; not a secret.
  return Math.random().toString(36).slice(2, 10);
}

export async function apiError(
  e: unknown,
  opts: ApiErrorOptions
): Promise<NextResponse> {
  const status = opts.status ?? 500;
  const publicMessage = opts.publicMessage ?? "internal_error";
  const requestId = newRequestId();
  const detail = e instanceof Error ? e.message : String(e);

  console.error(`[${opts.route}] ${requestId}: ${detail}`);

  if (status >= 500) {
    // logSystemEvent already swallows its own failures.
    await logSystemEvent({
      category: "api_error",
      severity: "medium",
      title: `API error: ${opts.route}`,
      description: `${requestId}: ${detail}`,
      error_key: `api-error:${opts.route}`,
    });
  }

  return NextResponse.json(
    { error: publicMessage, requestId, ...(opts.extra || {}) },
    { status }
  );
}
