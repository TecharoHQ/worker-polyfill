import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMockXHR, setScript, failScript, resetScripts } from "./helpers/mockXHR";
import { WorkerPolyfill } from "../src/worker-polyfill";

const makeWorker = (file: string, opts?: any) =>
  new (WorkerPolyfill as any)(file, opts);

describe("WorkerPolyfill", () => {
  beforeEach(() => {
    resetScripts();
    installMockXHR();
    vi.useFakeTimers();
  });

  it("echoes a message using the self.* idiom", () => {
    setScript("echo.js", "self.onmessage = function(e){ self.postMessage(e.data); };");
    const w = makeWorker("echo.js");
    const got: any[] = [];
    w.onmessage = (e: any) => got.push(e.data);
    w.postMessage("hi");
    vi.runAllTimers();
    expect(got).toEqual(["hi"]);
  });

  it("delivers a message event object, not a bare value", () => {
    setScript("echo.js", "onmessage = function(e){ postMessage(e.data); };");
    const w = makeWorker("echo.js");
    let evt: any = null;
    w.addEventListener("message", (e: any) => (evt = e));
    w.postMessage("x");
    vi.runAllTimers();
    expect(evt.type).toBe("message");
    expect(evt.data).toBe("x");
    expect(evt.target).toBe(w);
  });

  it("preserves message order for rapid posts", () => {
    setScript("echo.js", "onmessage = function(e){ postMessage(e.data); };");
    const w = makeWorker("echo.js");
    const got: any[] = [];
    w.onmessage = (e: any) => got.push(e.data);
    w.postMessage(1);
    w.postMessage(2);
    w.postMessage(3);
    vi.runAllTimers();
    expect(got).toEqual([1, 2, 3]);
  });

  it("structured-clones outgoing messages", () => {
    setScript("echo.js", "onmessage = function(e){ postMessage(e.data); };");
    const w = makeWorker("echo.js");
    let received: any = null;
    w.onmessage = (e: any) => (received = e.data);
    const payload = { n: 1 };
    w.postMessage(payload);
    payload.n = 2;
    vi.runAllTimers();
    expect(received.n).toBe(1);
  });

  it("supports multiple message listeners", () => {
    setScript("echo.js", "onmessage = function(e){ postMessage(e.data); };");
    const w = makeWorker("echo.js");
    const calls: string[] = [];
    w.addEventListener("message", () => calls.push("a"));
    w.addEventListener("message", () => calls.push("b"));
    w.postMessage("x");
    vi.runAllTimers();
    expect(calls).toEqual(["a", "b"]);
  });

  it("fires the error event when a handler throws", () => {
    setScript("bad.js", "onmessage = function(){ throw new Error('boom'); };");
    const w = makeWorker("bad.js");
    let err: any = null;
    w.onerror = (e: any) => (err = e);
    w.postMessage("go");
    vi.runAllTimers();
    expect(err).not.toBe(null);
    expect(err.type).toBe("error");
    expect(err.message).toBe("boom");
  });

  it("fires the error event when the script fails to load", () => {
    failScript("missing.js");
    const w = makeWorker("missing.js");
    let err: any = null;
    w.onerror = (e: any) => (err = e);
    vi.runAllTimers();
    expect(err).not.toBe(null);
    expect(err.type).toBe("error");
  });

  it("fires the error event when top-level worker code throws", () => {
    setScript("throws.js", "throw new Error('top-level');");
    const w = makeWorker("throws.js");
    let err: any = null;
    w.onerror = (e: any) => (err = e);
    vi.runAllTimers();
    expect(err.message).toBe("top-level");
  });

  it("terminate() stops further delivery", () => {
    setScript("echo.js", "onmessage = function(e){ postMessage(e.data); };");
    const w = makeWorker("echo.js");
    const got: any[] = [];
    w.onmessage = (e: any) => got.push(e.data);
    w.postMessage("a");
    w.terminate();
    w.postMessage("b");
    vi.runAllTimers();
    expect(got).toEqual([]);
  });

  it("worker close() stops further delivery", () => {
    setScript("closer.js", "onmessage = function(){ close(); postMessage('after'); };");
    const w = makeWorker("closer.js");
    const got: any[] = [];
    w.onmessage = (e: any) => got.push(e.data);
    w.postMessage("go");
    vi.runAllTimers();
    expect(got).toEqual([]);
  });

  it("supports importScripts synchronously", () => {
    setScript("dep.js", "self.DEP_VALUE = 42;");
    setScript("main.js", "importScripts('dep.js'); onmessage = function(){ postMessage(DEP_VALUE); };");
    const w = makeWorker("main.js");
    let got: any = null;
    w.onmessage = (e: any) => (got = e.data);
    w.postMessage("go");
    vi.runAllTimers();
    expect(got).toBe(42);
  });
});
