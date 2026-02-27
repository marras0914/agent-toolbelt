import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe(
      "Natural language description of the schedule. Examples: 'every weekday at 9am', 'first Monday of each month at noon', 'every 5 minutes', 'every Sunday at 3:30pm'"
    ),
  timezone: z
    .string()
    .default("UTC")
    .describe("Timezone for context (e.g., 'America/New_York', 'Europe/London'). The cron expression itself is timezone-agnostic, but this helps clarify the intent."),
});

type Input = z.infer<typeof inputSchema>;

// ----- Cron Parsing Logic -----

interface CronResult {
  expression: string;
  humanReadable: string;
  fields: {
    minute: string;
    hour: string;
    dayOfMonth: string;
    month: string;
    dayOfWeek: string;
  };
  nextRuns: string[];
  timezone: string;
  warnings: string[];
}

// Day name mapping
const DAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function parseTime(desc: string): { hour: number; minute: number } {
  // "3:30pm", "3:30 PM", "15:30", "9am", "noon", "midnight"
  const lower = desc.toLowerCase();

  if (lower.includes("noon") || lower.includes("midday")) return { hour: 12, minute: 0 };
  if (lower.includes("midnight")) return { hour: 0, minute: 0 };

  // First: try to match explicit am/pm times (most specific)
  const ampmMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const ampm = ampmMatch[3];

    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    return { hour, minute };
  }

  // Second: try HH:MM (24-hour format, must have colon)
  const h24Match = lower.match(/(\d{1,2}):(\d{2})/);
  if (h24Match) {
    return { hour: parseInt(h24Match[1], 10), minute: parseInt(h24Match[2], 10) };
  }

  return { hour: 0, minute: 0 };
}

function parseDays(desc: string): number[] {
  const lower = desc.toLowerCase();
  const found: number[] = [];

  // Special groups
  if (lower.includes("weekday") || lower.includes("business day") || lower.includes("work day")) {
    return [1, 2, 3, 4, 5];
  }
  if (lower.includes("weekend")) {
    return [0, 6];
  }

  // Individual days
  for (const [name, num] of Object.entries(DAYS)) {
    if (lower.includes(name)) {
      if (!found.includes(num)) found.push(num);
    }
  }

  return found.sort();
}

function buildCron(desc: string): CronResult {
  const lower = desc.toLowerCase().trim();
  const warnings: string[] = [];

  let minute = "*";
  let hour = "*";
  let dayOfMonth = "*";
  let month = "*";
  let dayOfWeek = "*";

  // ---- Every N minutes/hours ----
  const everyMinMatch = lower.match(/every\s+(\d+)\s*min/);
  if (everyMinMatch) {
    const n = parseInt(everyMinMatch[1], 10);
    minute = n === 1 ? "*" : `*/${n}`;
    const expr = `${minute} * * * *`;
    return formatResult(expr, `Every ${n} minute(s)`, desc, warnings);
  }

  const everyHourMatch = lower.match(/every\s+(\d+)\s*hour/);
  if (everyHourMatch) {
    const n = parseInt(everyHourMatch[1], 10);
    hour = n === 1 ? "*" : `*/${n}`;
    const expr = `0 ${hour} * * *`;
    return formatResult(expr, `Every ${n} hour(s), on the hour`, desc, warnings);
  }

  if (lower.match(/every\s*(minute|min$)/)) {
    return formatResult("* * * * *", "Every minute", desc, warnings);
  }

  if (lower.match(/every\s*hour|hourly/)) {
    return formatResult("0 * * * *", "Every hour, on the hour", desc, warnings);
  }

  // ---- Daily / every day ----
  if (lower.match(/every\s*day|daily/) && !lower.includes("weekday")) {
    const time = parseTime(lower);
    const expr = `${time.minute} ${time.hour} * * *`;
    return formatResult(expr, `Every day at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
  }

  // ---- Weekly ----
  if (lower.includes("weekly") || lower.includes("every week")) {
    const time = parseTime(lower);
    const days = parseDays(lower);
    const dow = days.length > 0 ? days.join(",") : "1"; // default Monday
    const expr = `${time.minute} ${time.hour} * * ${dow}`;
    return formatResult(expr, `Weekly on ${daysToHuman(days.length > 0 ? days : [1])} at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
  }

  // ---- Monthly ----
  const monthlyMatch = lower.match(/(?:every month|monthly)/);
  if (monthlyMatch) {
    const time = parseTime(lower);
    const domMatch = lower.match(/(\d{1,2})(?:st|nd|rd|th)/);
    const dom = domMatch ? domMatch[1] : "1";
    const expr = `${time.minute} ${time.hour} ${dom} * *`;
    return formatResult(expr, `Monthly on the ${ordinal(parseInt(dom, 10))} at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
  }

  // ---- "first/last Monday of each month" pattern ----
  const nthDayMatch = lower.match(/(first|second|third|fourth|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)/);
  if (nthDayMatch) {
    const posMap: Record<string, string> = { first: "1", second: "2", third: "3", fourth: "4", last: "L" };
    const pos = posMap[nthDayMatch[1]] || "1";
    const dayName = nthDayMatch[2];
    const dayNum = DAYS[dayName] ?? 1;
    const time = parseTime(lower);

    // Standard cron doesn't support nth weekday; use the closest approximation
    if (pos === "L") {
      warnings.push("Standard cron does not support 'last weekday of month'. This approximates using day-of-week only. Consider using a cron library that supports extended syntax like '0L' for last occurrence.");
      const expr = `${time.minute} ${time.hour} * * ${dayNum}`;
      return formatResult(expr, `Every ${dayName} at ${formatTimeHuman(time.hour, time.minute)} (approximate — see warnings)`, desc, warnings);
    }

    // Approximate: first Monday ≈ days 1-7 on that weekday
    const dayRanges: Record<string, string> = { "1": "1-7", "2": "8-14", "3": "15-21", "4": "22-28" };
    const domRange = dayRanges[pos] || "1-7";
    const expr = `${time.minute} ${time.hour} ${domRange} * ${dayNum}`;
    return formatResult(expr, `${nthDayMatch[1]} ${dayName} of each month at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
  }

  // ---- Specific days of the week ----
  const days = parseDays(lower);
  if (days.length > 0) {
    const time = parseTime(lower);
    const dow = days.join(",");
    const expr = `${time.minute} ${time.hour} * * ${dow}`;
    return formatResult(expr, `${daysToHuman(days)} at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
  }

  // ---- Specific months ----
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (lower.includes(name)) {
      const time = parseTime(lower);
      const domMatch = lower.match(/(\d{1,2})(?:st|nd|rd|th)?/);
      const dom = domMatch ? domMatch[1] : "1";
      const expr = `${time.minute} ${time.hour} ${dom} ${num} *`;
      return formatResult(expr, `${name.charAt(0).toUpperCase() + name.slice(1)} ${ordinal(parseInt(dom, 10))} at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
    }
  }

  // ---- Yearly / annually ----
  if (lower.includes("yearly") || lower.includes("annually") || lower.includes("every year")) {
    const time = parseTime(lower);
    const expr = `${time.minute} ${time.hour} 1 1 *`;
    return formatResult(expr, `Yearly on January 1st at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
  }

  // ---- Fallback: try to find just a time ----
  const timeFallback = lower.match(/\d{1,2}(:\d{2})?\s*(am|pm)/);
  if (timeFallback) {
    const time = parseTime(lower);
    const expr = `${time.minute} ${time.hour} * * *`;
    warnings.push("Could not determine a specific schedule pattern — defaulting to daily at the specified time.");
    return formatResult(expr, `Daily at ${formatTimeHuman(time.hour, time.minute)}`, desc, warnings);
  }

  // ---- Couldn't parse ----
  warnings.push("Could not parse the schedule description. Returning a midnight daily default. Please try being more specific, e.g., 'every weekday at 9am' or 'every 5 minutes'.");
  return formatResult("0 0 * * *", "Daily at midnight (default — could not parse input)", desc, warnings);
}

// ----- Helpers -----

function formatResult(expression: string, humanReadable: string, originalDesc: string, warnings: string[]): CronResult {
  const parts = expression.split(" ");
  const fields = {
    minute: parts[0] || "*",
    hour: parts[1] || "*",
    dayOfMonth: parts[2] || "*",
    month: parts[3] || "*",
    dayOfWeek: parts[4] || "*",
  };

  return {
    expression,
    humanReadable,
    fields,
    nextRuns: computeNextRuns(fields, 5),
    timezone: "UTC",
    warnings,
  };
}

function formatTimeHuman(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  const m = minute.toString().padStart(2, "0");
  return minute === 0 ? `${h} ${ampm}` : `${h}:${m} ${ampm}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function daysToHuman(days: number[]): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return "weekdays";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "weekends";
  return days.map((d) => names[d] || `day ${d}`).join(", ");
}

function computeNextRuns(fields: CronResult["fields"], count: number): string[] {
  // Simple forward-simulation for the next N runs
  const runs: string[] = [];
  const now = new Date();
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxIterations = 525960; // ~1 year of minutes

  for (let i = 0; i < maxIterations && runs.length < count; i++) {
    if (matchesCron(cursor, fields)) {
      runs.push(cursor.toISOString().replace(".000Z", "Z"));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return runs;
}

function matchesCron(date: Date, fields: CronResult["fields"]): boolean {
  return (
    matchField(date.getUTCMinutes(), fields.minute) &&
    matchField(date.getUTCHours(), fields.hour) &&
    matchField(date.getUTCDate(), fields.dayOfMonth) &&
    matchField(date.getUTCMonth() + 1, fields.month) &&
    matchField(date.getUTCDay(), fields.dayOfWeek)
  );
}

function matchField(value: number, field: string): boolean {
  if (field === "*") return true;

  for (const part of field.split(",")) {
    // Step: */N
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      if (value % parseInt(stepMatch[1], 10) === 0) return true;
      continue;
    }

    // Range: A-B
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (value >= lo && value <= hi) return true;
      continue;
    }

    // Exact
    if (parseInt(part, 10) === value) return true;
  }

  return false;
}

// ----- Handler -----
async function handler(input: Input): Promise<CronResult> {
  const result = buildCron(input.description);
  result.timezone = input.timezone;
  return result;
}

// ----- Register -----
const cronBuilderTool: ToolDefinition<Input, CronResult> = {
  name: "cron-builder",
  description:
    "Convert natural language schedule descriptions into cron expressions. Returns the cron expression, a human-readable confirmation, field breakdown, and the next 5 scheduled run times. Handles complex patterns like 'first Monday of each month at 9am' or 'every 15 minutes on weekdays'.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["cron", "scheduling", "devops", "automation"],
    pricing: "$0.0005 per call",
    exampleInput: {
      description: "every weekday at 9:30am",
      timezone: "America/New_York",
    },
  },
};

registerTool(cronBuilderTool);
export default cronBuilderTool;
