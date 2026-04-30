/** Sanity-check a numeric value against a plausibility range; null on out-of-range or non-finite. */
export const sane = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v != null && isFinite(n) && n >= min && n <= max ? n : null;
};

/** Finnhub returns most quality/growth metrics as percentages (e.g. 33.6 = 33.6%). Convert to decimal. */
export const fhPct = (v: unknown): number | undefined =>
  v != null && isFinite(Number(v)) ? Number(v) / 100 : undefined;

/** Format a numeric value with a suffix and decimal precision; "N/A" when null. */
export const fmt = (v: number | null | undefined, suffix = "", decimals = 1): string =>
  v != null ? `${Number(v).toFixed(decimals)}${suffix}` : "N/A";

/** Format a decimal as a percentage (0.156 → "15.6%"); "N/A" when null. */
export const fmtPct = (v: number | null | undefined): string =>
  v != null ? `${(Number(v) * 100).toFixed(1)}%` : "N/A";

/** Round to 1 decimal, preserving null. */
export const round1 = (v: number | null | undefined): number | null =>
  v != null ? parseFloat(Number(v).toFixed(1)) : null;
