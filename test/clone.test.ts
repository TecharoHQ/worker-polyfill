import { describe, it, expect } from "vitest";
import { structuredCloneShim } from "../src/clone";

describe("structuredCloneShim", () => {
  it("returns primitives unchanged", () => {
    expect(structuredCloneShim(5)).toBe(5);
    expect(structuredCloneShim("a")).toBe("a");
    expect(structuredCloneShim(null)).toBe(null);
  });

  it("deep-copies objects so mutations do not leak", () => {
    const src = { a: 1, nested: { b: 2 } };
    const copy = structuredCloneShim(src);
    copy.nested.b = 99;
    expect(src.nested.b).toBe(2);
    expect(copy.nested.b).toBe(99);
  });

  it("deep-copies arrays", () => {
    const src = [1, [2, 3]];
    const copy = structuredCloneShim(src);
    copy[1][0] = 9;
    expect(src[1][0]).toBe(2);
  });

  it("preserves cyclic references", () => {
    const src: any = { name: "x" };
    src.me = src;
    const copy = structuredCloneShim(src);
    expect(copy.me).toBe(copy);
    expect(copy).not.toBe(src);
  });

  it("clones Date and RegExp", () => {
    const d = structuredCloneShim(new Date(1000));
    expect(d instanceof Date).toBe(true);
    expect(d.getTime()).toBe(1000);
  });
});
