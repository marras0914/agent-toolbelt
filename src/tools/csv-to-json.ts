import { z } from "zod";
import Papa from "papaparse";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  csv: z.string().min(1).max(500_000).describe("CSV content to convert"),
  delimiter: z
    .enum(["auto", ",", ";", "\t", "|"])
    .default("auto")
    .describe("Column delimiter. Use 'auto' to detect automatically"),
  hasHeader: z
    .boolean()
    .default(true)
    .describe("Whether the first row is a header row. If false, columns are named col_1, col_2, etc."),
  typeCast: z
    .boolean()
    .default(true)
    .describe("Auto-convert values to numbers, booleans, and nulls where appropriate"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .describe("Maximum number of rows to return"),
  skipEmptyRows: z
    .boolean()
    .default(true)
    .describe("Skip rows where all values are empty"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Type casting -----
function castValue(value: string): string | number | boolean | null {
  if (value === "" || value.toLowerCase() === "null" || value.toLowerCase() === "n/a") return null;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  return value;
}

// ----- Column type inference -----
type ColType = "string" | "number" | "boolean" | "mixed" | "null";

function inferColumnTypes(rows: Record<string, unknown>[], headers: string[]): Record<string, ColType> {
  const types: Record<string, Set<string>> = {};
  for (const h of headers) types[h] = new Set();

  for (const row of rows) {
    for (const h of headers) {
      const v = row[h];
      if (v === null) types[h].add("null");
      else types[h].add(typeof v);
    }
  }

  return Object.fromEntries(
    headers.map((h) => {
      const s = types[h];
      const nonNull = new Set([...s].filter((t) => t !== "null"));
      if (nonNull.size === 0) return [h, "null"];
      if (nonNull.size === 1) return [h, nonNull.values().next().value as ColType];
      return [h, "mixed"];
    })
  );
}

// ----- Handler -----
async function handler(input: Input) {
  const { csv, delimiter, hasHeader, typeCast, limit, skipEmptyRows } = input;

  const result = Papa.parse<string[]>(csv, {
    delimiter: delimiter === "auto" ? "" : delimiter,
    header: false,
    skipEmptyLines: skipEmptyRows,
  });

  if (result.errors.length > 0) {
    const fatal = result.errors.find((e) => e.type === "Delimiter" || result.data.length === 0);
    if (fatal) {
      return {
        success: false,
        error: result.errors[0].message,
        rows: [],
        headers: [],
        rowCount: 0,
        columnCount: 0,
        columnTypes: {},
      };
    }
  }

  const rawRows = result.data as string[][];
  if (rawRows.length === 0) {
    return { success: true, rows: [], headers: [], rowCount: 0, columnCount: 0, columnTypes: {} };
  }

  // Extract headers
  let headers: string[];
  let dataRows: string[][];

  if (hasHeader) {
    headers = rawRows[0].map((h) => h.trim());
    dataRows = rawRows.slice(1);
  } else {
    const colCount = Math.max(...rawRows.map((r) => r.length));
    headers = Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
    dataRows = rawRows;
  }

  // Apply row limit
  const limitedRows = limit ? dataRows.slice(0, limit) : dataRows;

  // Convert to objects
  const rows: Record<string, unknown>[] = limitedRows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const raw = row[i] ?? "";
      obj[headers[i]] = typeCast ? castValue(raw.trim()) : raw;
    }
    return obj;
  });

  const columnTypes = typeCast ? inferColumnTypes(rows, headers) : {};

  return {
    success: true,
    rows,
    headers,
    rowCount: rows.length,
    totalRows: dataRows.length,
    columnCount: headers.length,
    columnTypes,
    ...(result.meta.delimiter && { detectedDelimiter: result.meta.delimiter }),
    ...(limit && dataRows.length > limit && { truncated: true, totalRowsAvailable: dataRows.length }),
  };
}

// ----- Register -----
const csvToJsonTool: ToolDefinition<Input> = {
  name: "csv-to-json",
  description:
    "Convert CSV data to JSON. Supports auto-delimiter detection, header row parsing, type casting (numbers, booleans, nulls), and column type inference. Returns an array of objects with metadata.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["csv", "json", "conversion", "data-transformation", "parsing"],
    pricing: "$0.0005 per call",
    exampleInput: {
      csv: "name,age,active,score\nAlice,30,true,98.5\nBob,25,false,72.0\nCarol,35,true,",
      delimiter: "auto",
      hasHeader: true,
      typeCast: true,
      skipEmptyRows: true,
    },
  },
};

registerTool(csvToJsonTool);

export default csvToJsonTool;
