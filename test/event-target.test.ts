import { describe, it, expect } from "vitest";
import { installEventTarget } from "../src/event-target";

describe("installEventTarget", () => {
  it("dispatches to multiple listeners", () => {
    const host: any = {};
    installEventTarget(host);
    const calls: string[] = [];
    host.addEventListener("message", () => calls.push("a"));
    host.addEventListener("message", () => calls.push("b"));
    host.dispatchEvent({ type: "message", target: null, currentTarget: null });
    expect(calls).toEqual(["a", "b"]);
  });

  it("also invokes the on<type> handler property", () => {
    const host: any = {};
    installEventTarget(host);
    let got = "";
    host.onmessage = () => (got = "handler");
    host.dispatchEvent({ type: "message", target: null, currentTarget: null });
    expect(got).toBe("handler");
  });

  it("removeEventListener stops a listener", () => {
    const host: any = {};
    installEventTarget(host);
    const calls: string[] = [];
    const fn = () => calls.push("x");
    host.addEventListener("message", fn);
    host.removeEventListener("message", fn);
    host.dispatchEvent({ type: "message", target: null, currentTarget: null });
    expect(calls).toEqual([]);
  });

  it("does not register the same listener twice", () => {
    const host: any = {};
    installEventTarget(host);
    let n = 0;
    const fn = () => n++;
    host.addEventListener("message", fn);
    host.addEventListener("message", fn);
    host.dispatchEvent({ type: "message", target: null, currentTarget: null });
    expect(n).toBe(1);
  });

  it("sets target/currentTarget on the event", () => {
    const host: any = {};
    installEventTarget(host);
    let seen: any = null;
    host.addEventListener("message", (e: any) => (seen = e));
    host.dispatchEvent({ type: "message", target: null, currentTarget: null });
    expect(seen.currentTarget).toBe(host);
    expect(seen.target).toBe(host);
  });

  it("continues dispatching after a listener throws", () => {
    const host: any = {};
    installEventTarget(host);
    const calls: string[] = [];
    host.addEventListener("message", () => {
      calls.push("first");
      throw new Error("boom");
    });
    host.addEventListener("message", () => calls.push("second"));
    host.dispatchEvent({ type: "message", target: null, currentTarget: null });
    expect(calls).toEqual(["first", "second"]);
  });
});
