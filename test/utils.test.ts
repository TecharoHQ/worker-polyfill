import { describe, it, expect, beforeEach } from "vitest";
import { fetchScriptSync, getGlobal } from "../src/utils";
import { installMockXHR, setScript, failScript, resetScripts, setScriptWithStatus } from "./helpers/mockXHR";

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

  it("fetchScriptSync throws on non-2xx status", () => {
    setScriptWithStatus("bad.js", "var a = 1;", 502);
    expect(() => fetchScriptSync("bad.js")).toThrow("Failed to load worker script: bad.js (status 502)");
  });
});
