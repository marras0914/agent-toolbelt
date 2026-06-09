/**
 * In-memory recorder for outbound email (SendGrid) health.
 *
 * Email sends used to fail silently: sendOnboardingEmail's errors were caught
 * with a bare console.error at the call site, so when the SendGrid account ran
 * out of credits, every welcome email dropped with no visible signal. This
 * tracker records success/failure outcomes so /admin/email-health answers
 * "is email actually working?" at a glance — and a failure logs loudly with a
 * distinctive, greppable prefix.
 *
 * Counters reset on process restart (same rationale as upstream-health): it's a
 * "since last deploy" view, not a persistent store.
 */

interface EmailFailure {
  ts: number;
  to: string;
  reason: string;
}

const startedAt = Date.now();
let successCount = 0;
let failureCount = 0;
let lastSuccessAt: number | null = null;
let lastFailureAt: number | null = null;
// Tracked explicitly rather than inferred from comparing the two timestamps:
// coarse clock granularity (Windows ~15ms) can land a success and a failure in
// the same millisecond, and `>` would then mis-report the status.
let lastOutcome: "success" | "failure" | null = null;
const MAX_RECENT = 50;
const recentFailures: EmailFailure[] = [];

export function recordEmailSuccess(): void {
  successCount += 1;
  lastSuccessAt = Date.now();
  lastOutcome = "success";
}

export function recordEmailFailure(to: string, reason: string): void {
  failureCount += 1;
  lastFailureAt = Date.now();
  lastOutcome = "failure";
  recentFailures.push({ ts: lastFailureAt, to, reason });
  if (recentFailures.length > MAX_RECENT) recentFailures.shift();
  // Loud, greppable, NOT swallowed — this is the line that should never hide.
  console.error(`[email] SEND FAILED to ${to}: ${reason} — check SendGrid plan/credits at /admin/email-health`);
}

/**
 * status:
 *   "unknown"  — no sends attempted since last deploy
 *   "failing"  — the most recent outcome was a failure (or only failures seen)
 *   "ok"       — last outcome was a success
 */
export function getEmailHealth(): {
  status: "ok" | "failing" | "unknown";
  windowStartedAt: string;
  successCount: number;
  failureCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  recentFailures: Array<{ ts: string; to: string; reason: string }>;
} {
  let status: "ok" | "failing" | "unknown";
  if (lastOutcome === null) {
    status = "unknown";
  } else if (lastOutcome === "failure") {
    status = "failing";
  } else {
    status = "ok";
  }

  return {
    status,
    windowStartedAt: new Date(startedAt).toISOString(),
    successCount,
    failureCount,
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
    lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : null,
    recentFailures: recentFailures
      .slice()
      .reverse()
      .map((f) => ({ ts: new Date(f.ts).toISOString(), to: f.to, reason: f.reason })),
  };
}
