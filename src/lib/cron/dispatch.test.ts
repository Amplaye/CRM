import { describe, it, expect, vi } from "vitest";
import { jobsForHour, runCronTick, CRON_JOBS } from "./dispatch";

describe("jobsForHour", () => {
  it("runs the two hourly jobs at every hour", () => {
    for (let h = 0; h < 24; h++) {
      const jobs = jobsForHour(h);
      expect(jobs).toContain("booking-reminders");
      expect(jobs).toContain("post-visit-followup");
      expect(jobs).toContain("social-publish");
    }
  });

  it("maps each daily job to its exact UTC hour (from vercel.json)", () => {
    expect(jobsForHour(2)).toContain("pos-sync");
    expect(jobsForHour(3)).toContain("purge-tenants");
    expect(jobsForHour(4)).toEqual(
      expect.arrayContaining(["reconcile-provisioning", "data-retention"]),
    );
    expect(jobsForHour(5)).toEqual(
      expect.arrayContaining(["credits-reset", "fiscal-flush"]),
    );
    expect(jobsForHour(6)).toContain("expiry-alert");
  });

  it("does not run a daily job at the wrong hour", () => {
    expect(jobsForHour(2)).not.toContain("purge-tenants");
    expect(jobsForHour(12)).toEqual(["booking-reminders", "post-visit-followup", "social-publish"]);
  });

  it("covers all cron endpoints across a full day", () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) jobsForHour(h).forEach((p) => seen.add(p));
    expect(seen.size).toBe(CRON_JOBS.length);
    expect(seen.size).toBe(10);
  });
});

describe("runCronTick", () => {
  const baseUrl = "https://crm.example.com";
  const cronSecret = "s3cr3t";
  // 2025-01-01T05:00:00Z → hour 5 → credits-reset + fiscal-flush + 2 hourly
  const scheduledTime = Date.UTC(2025, 0, 1, 5, 0, 0);

  it("calls each due endpoint with the Bearer secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const res = await runCronTick({ scheduledTime, baseUrl, cronSecret, fetchImpl });

    expect(res.hour).toBe(5);
    const calledPaths = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledPaths).toEqual(
      expect.arrayContaining([
        `${baseUrl}/api/cron/credits-reset`,
        `${baseUrl}/api/cron/fiscal-flush`,
        `${baseUrl}/api/cron/booking-reminders`,
        `${baseUrl}/api/cron/post-visit-followup`,
      ]),
    );
    // every call carries the auth header
    for (const call of fetchImpl.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({
        authorization: `Bearer ${cronSecret}`,
      });
    }
  });

  it("does not abort the batch when one endpoint throws", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const res = await runCronTick({ scheduledTime, baseUrl, cronSecret, fetchImpl });

    // 5 endpoints due at hour 5 (2 daily + 3 hourly); the first errors, the rest run
    expect(res.ran).toHaveLength(5);
    expect(res.ran.filter((r) => r.status === "error")).toHaveLength(1);
    expect(res.ran.filter((r) => r.status === 200)).toHaveLength(4);
  });

  it("at an empty hour runs only the hourly jobs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const noonTick = Date.UTC(2025, 0, 1, 12, 0, 0);
    const res = await runCronTick({
      scheduledTime: noonTick,
      baseUrl,
      cronSecret,
      fetchImpl,
    });
    expect(res.hour).toBe(12);
    expect(res.ran.map((r) => r.path).sort()).toEqual([
      "booking-reminders",
      "post-visit-followup",
      "social-publish",
    ]);
  });
});
