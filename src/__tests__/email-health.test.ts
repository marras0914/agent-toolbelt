import { describe, it, expect } from "vitest";
import { recordEmailSuccess, recordEmailFailure, getEmailHealth } from "../email-health";

// Note: the tracker is module-level singleton state. These run in declared
// order within one process, so we assert on cumulative transitions.
describe("email-health tracker", () => {
  it("starts in 'unknown' with no sends", () => {
    const h = getEmailHealth();
    expect(h.status).toBe("unknown");
    expect(h.successCount).toBe(0);
    expect(h.failureCount).toBe(0);
  });

  it("reports 'ok' after a successful send", () => {
    recordEmailSuccess();
    const h = getEmailHealth();
    expect(h.status).toBe("ok");
    expect(h.successCount).toBe(1);
    expect(h.lastSuccessAt).not.toBeNull();
  });

  it("flips to 'failing' when the most recent outcome is a failure", () => {
    recordEmailFailure("filip@example.com", "Maximum credits exceeded");
    const h = getEmailHealth();
    expect(h.status).toBe("failing");
    expect(h.failureCount).toBe(1);
    expect(h.recentFailures[0]).toMatchObject({ to: "filip@example.com", reason: "Maximum credits exceeded" });
  });

  it("returns to 'ok' once a newer success lands after a failure", () => {
    recordEmailSuccess();
    expect(getEmailHealth().status).toBe("ok");
  });
});
