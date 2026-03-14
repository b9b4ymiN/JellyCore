import { describe, expect, test } from "bun:test";

import { parseStoredConcepts, serializeStoredConcepts } from "./concepts-codec.js";

describe("concepts-codec", () => {
  test("parses valid JSON array strings", () => {
    expect(parseStoredConcepts('["oracle","learn","test"]')).toEqual([
      "oracle",
      "learn",
      "test",
    ]);
  });

  test("parses comma-separated strings", () => {
    expect(parseStoredConcepts("oracle, learn, test")).toEqual([
      "oracle",
      "learn",
      "test",
    ]);
  });

  test("parses double-encoded JSON arrays", () => {
    expect(parseStoredConcepts('"[\\"oracle\\",\\"learn\\",\\"test\\"]"')).toEqual([
      "oracle",
      "learn",
      "test",
    ]);
  });

  test("sanitizes empty and mixed arrays", () => {
    expect(parseStoredConcepts(null)).toEqual([]);
    expect(parseStoredConcepts("")).toEqual([]);
    expect(parseStoredConcepts(["oracle", 1, " learn ", "", null])).toEqual([
      "oracle",
      "learn",
    ]);
  });

  test("serializes normalized arrays as canonical JSON", () => {
    expect(serializeStoredConcepts(["oracle", " learn ", ""])).toBe('["oracle","learn"]');
  });
});
