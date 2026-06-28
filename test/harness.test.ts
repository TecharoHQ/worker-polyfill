import { describe, it, expect, beforeEach } from "vitest";
import { installMockXHR, setScript, resetScripts } from "./helpers/mockXHR";

describe("test harness", () => {
  beforeEach(() => {
    resetScripts();
    installMockXHR();
  });

  it("serves a registered script over sync XHR", () => {
    setScript("hello.js", "var x = 1;");
    const xhr: any = new (globalThis as any).XMLHttpRequest();
    xhr.open("GET", "hello.js", false);
    xhr.send(null);
    expect(xhr.readyState).toBe(4);
    expect(xhr.status).toBe(200);
    expect(xhr.responseText).toBe("var x = 1;");
  });
});
