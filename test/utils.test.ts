import { describe, it, expect, beforeEach } from "vitest";
import { fetchScriptSync, getGlobal } from "../src/utils";
import { installMockXHR, setScript, failScript, resetScripts } from "./helpers/mockXHR";

describe("utils", () => {
  beforeEach(() => {
    resetScripts();
    installMockXHR();
  });

  it("getGlobal returns an object with setTimeout", () => {
    const g = getGlobal();
    expect(typeof g.setTimeout).toBe("function");
  });

  it("fetchScriptSync returns the script body", () => {
    setScript("a.js", "var a = 1;");
    expect(fetchScriptSync("a.js")).toBe("var a = 1;");
  });

  it("fetchScriptSync throws on a failed load", () => {
    failScript("missing.js");
    expect(() => fetchScriptSync("missing.js")).toThrow();
  });
});
