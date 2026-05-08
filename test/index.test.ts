import { describe, expect, it } from "vitest";

import { makeUnitId } from "../src/index";

describe("makeUnitId", () => {
  it("produces a deterministic hash", () => {
    const id = makeUnitId("test.ts", 1, 10);
    expect(id).toBe(makeUnitId("test.ts", 1, 10));
    expect(id.length).toBe(16);
  });

  it("produces different ids for different inputs", () => {
    expect(makeUnitId("a.ts", 1, 10)).not.toBe(makeUnitId("b.ts", 1, 10));
  });
});
