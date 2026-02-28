import { vi, describe, it, expect } from "vitest";

vi.mock("../../tools/registry", () => ({ registerTool: vi.fn() }));

import tool from "../../tools/cron-builder";

const handler = tool.handler;

describe("cron-builder", () => {
  describe("interval patterns", () => {
    it("every minute", async () => {
      const r = await handler({ description: "every minute", timezone: "UTC" });
      expect(r.expression).toBe("* * * * *");
    });

    it("every 5 minutes", async () => {
      const r = await handler({ description: "every 5 minutes", timezone: "UTC" });
      expect(r.expression).toBe("*/5 * * * *");
    });

    it("every 15 minutes", async () => {
      const r = await handler({ description: "every 15 minutes", timezone: "UTC" });
      expect(r.expression).toBe("*/15 * * * *");
    });

    it("every hour", async () => {
      const r = await handler({ description: "every hour", timezone: "UTC" });
      expect(r.expression).toBe("0 * * * *");
    });

    it("every 2 hours", async () => {
      const r = await handler({ description: "every 2 hours", timezone: "UTC" });
      expect(r.expression).toBe("0 */2 * * *");
    });
  });

  describe("daily patterns", () => {
    it("every day at midnight", async () => {
      const r = await handler({ description: "every day at midnight", timezone: "UTC" });
      expect(r.expression).toBe("0 0 * * *");
    });

    it("every day at noon", async () => {
      const r = await handler({ description: "every day at noon", timezone: "UTC" });
      expect(r.expression).toBe("0 12 * * *");
    });

    it("every day at 9am", async () => {
      const r = await handler({ description: "every day at 9am", timezone: "UTC" });
      expect(r.expression).toBe("0 9 * * *");
    });

    it("every day at 3:30pm", async () => {
      const r = await handler({ description: "every day at 3:30pm", timezone: "UTC" });
      expect(r.expression).toBe("30 15 * * *");
    });
  });

  describe("weekday patterns", () => {
    it("every weekday", async () => {
      const r = await handler({ description: "every weekday at 9am", timezone: "UTC" });
      expect(r.expression).toBe("0 9 * * 1,2,3,4,5");
    });

    it("every Monday", async () => {
      const r = await handler({ description: "every Monday at 9am", timezone: "UTC" });
      expect(r.expression).toContain("1");
      expect(r.expression).toContain("9");
    });

    it("every Friday at 5pm", async () => {
      const r = await handler({ description: "every Friday at 5pm", timezone: "UTC" });
      expect(r.expression).toContain("5"); // Friday = 5
      expect(r.expression).toContain("17");
    });
  });

  describe("monthly patterns", () => {
    it("every month on the 1st", async () => {
      const r = await handler({ description: "monthly at midnight", timezone: "UTC" });
      expect(r.fields.dayOfMonth).toBe("1");
      expect(r.fields.month).toBe("*");
    });

    it("first Monday of each month", async () => {
      const r = await handler({ description: "first Monday of each month at noon", timezone: "UTC" });
      expect(r.expression).toContain("12"); // noon
      expect(r.expression).toContain("1");  // Monday
    });
  });

  describe("response shape", () => {
    it("returns required fields", async () => {
      const r = await handler({ description: "every day at 9am", timezone: "America/New_York" });
      expect(r).toHaveProperty("expression");
      expect(r).toHaveProperty("humanReadable");
      expect(r).toHaveProperty("fields");
      expect(r).toHaveProperty("nextRuns");
      expect(r).toHaveProperty("timezone");
    });

    it("fields object has all cron parts", async () => {
      const r = await handler({ description: "every day at 9am", timezone: "UTC" });
      expect(r.fields).toHaveProperty("minute");
      expect(r.fields).toHaveProperty("hour");
      expect(r.fields).toHaveProperty("dayOfMonth");
      expect(r.fields).toHaveProperty("month");
      expect(r.fields).toHaveProperty("dayOfWeek");
    });

    it("returns 5 next run times", async () => {
      const r = await handler({ description: "every day at 9am", timezone: "UTC" });
      expect(r.nextRuns).toHaveLength(5);
    });

    it("next runs are valid ISO strings", async () => {
      const r = await handler({ description: "every hour", timezone: "UTC" });
      for (const run of r.nextRuns) {
        expect(() => new Date(run)).not.toThrow();
        expect(new Date(run).getTime()).toBeGreaterThan(Date.now() - 1000);
      }
    });

    it("reflects the input timezone", async () => {
      const r = await handler({ description: "every day at 9am", timezone: "America/Chicago" });
      expect(r.timezone).toBe("America/Chicago");
    });
  });
});
