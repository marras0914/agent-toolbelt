import { vi, describe, it, expect } from "vitest";

vi.mock("../../tools/registry", () => ({ registerTool: vi.fn() }));

import tool from "../../tools/csv-to-json";

const handler = tool.handler;

describe("csv-to-json", () => {
  const basicCsv = "name,age,active\nAlice,30,true\nBob,25,false";

  describe("basic parsing", () => {
    it("converts a simple CSV with headers", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rows).toHaveLength(2);
      expect(r.headers).toEqual(["name", "age", "active"]);
      expect(r.rows[0]).toMatchObject({ name: "Alice" });
    });

    it("returns correct rowCount and columnCount", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rowCount).toBe(2);
      expect(r.columnCount).toBe(3);
    });
  });

  describe("type casting", () => {
    it("casts numbers", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rows[0].age).toBe(30);
    });

    it("casts booleans", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rows[0].active).toBe(true);
      expect(r.rows[1].active).toBe(false);
    });

    it("casts empty strings to null", async () => {
      const csv = "name,score\nAlice,\nBob,95";
      const r = await handler({ csv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rows[0].score).toBeNull();
    });

    it("preserves strings when typeCast is false", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: false, skipEmptyRows: true });
      expect(r.rows[0].age).toBe("30");
      expect(r.rows[0].active).toBe("true");
    });
  });

  describe("column type inference", () => {
    it("infers number columns", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.columnTypes?.age).toBe("number");
    });

    it("infers boolean columns", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.columnTypes?.active).toBe("boolean");
    });

    it("infers string columns", async () => {
      const r = await handler({ csv: basicCsv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.columnTypes?.name).toBe("string");
    });
  });

  describe("no header mode", () => {
    it("generates col_N column names", async () => {
      const csv = "Alice,30\nBob,25";
      const r = await handler({ csv, delimiter: "auto", hasHeader: false, typeCast: false, skipEmptyRows: true });
      expect(r.headers).toEqual(["col_1", "col_2"]);
      expect(r.rows[0]).toMatchObject({ col_1: "Alice", col_2: "30" });
    });
  });

  describe("delimiters", () => {
    it("handles semicolon delimiter", async () => {
      const csv = "name;age\nAlice;30";
      const r = await handler({ csv, delimiter: ";", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rows[0]).toMatchObject({ name: "Alice", age: 30 });
    });

    it("handles pipe delimiter", async () => {
      const csv = "name|age\nAlice|30";
      const r = await handler({ csv, delimiter: "|", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rows[0]).toMatchObject({ name: "Alice", age: 30 });
    });
  });

  describe("row limit", () => {
    it("limits rows when limit is set", async () => {
      const csv = "name,val\nA,1\nB,2\nC,3\nD,4\nE,5";
      const r = await handler({ csv, delimiter: ",", hasHeader: true, typeCast: true, skipEmptyRows: true, limit: 2 });
      expect(r.rowCount).toBe(2);
      expect(r.truncated).toBe(true);
    });
  });

  describe("empty input", () => {
    it("handles CSV with only a header row", async () => {
      const csv = "name,age";
      const r = await handler({ csv, delimiter: "auto", hasHeader: true, typeCast: true, skipEmptyRows: true });
      expect(r.rows).toHaveLength(0);
      expect(r.rowCount).toBe(0);
    });
  });
});
