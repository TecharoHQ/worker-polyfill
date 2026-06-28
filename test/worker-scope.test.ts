import { describe, it, expect } from "vitest";
import { createWorkerScope } from "../src/worker-scope";

describe("createWorkerScope", () => {
  it("self refers to the scope itself", () => {
    const scope = createWorkerScope("", () => {}, () => {});
    expect(scope.self).toBe(scope);
  });

  it("evaluated code can set self.onmessage and receive __deliver", () => {
    const out: any[] = [];
    const scope = createWorkerScope("", (d) => out.push(d), () => {});
    scope.__evalScript("self.onmessage = function(e){ self.postMessage(e.data); };");
    scope.__deliver("ping");
    expect(out).toEqual(["ping"]);
  });

  it("bare onmessage/postMessage identifiers resolve to the scope", () => {
    const out: any[] = [];
    const scope = createWorkerScope("", (d) => out.push(d), () => {});
    scope.__evalScript("onmessage = function(e){ postMessage(e.data + '!'); };");
    scope.__deliver("hey");
    expect(out).toEqual(["hey!"]);
  });

  it("postMessage clones the payload", () => {
    const out: any[] = [];
    const scope = createWorkerScope("", (d) => out.push(d), () => {});
    const obj = { n: 1 };
    scope.postMessage(obj);
    obj.n = 2;
    expect(out[0].n).toBe(1);
  });

  it("close() invokes the onClose callback", () => {
    let closed = false;
    const scope = createWorkerScope("", () => {}, () => (closed = true));
    scope.__evalScript("close();");
    expect(closed).toBe(true);
  });

  it("exposes the worker name", () => {
    const scope = createWorkerScope("worker-1", () => {}, () => {});
    expect(scope.name).toBe("worker-1");
  });
});
