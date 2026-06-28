import { describe, it, expect } from "vitest";
import {
  createMessageEvent,
  createErrorEvent,
  createMessageErrorEvent,
} from "../src/events";

describe("event factories", () => {
  it("builds a message event with spec-shaped fields", () => {
    const t = {};
    const e = createMessageEvent({ hi: 1 }, t);
    expect(e.type).toBe("message");
    expect(e.data).toEqual({ hi: 1 });
    expect(e.target).toBe(t);
    expect(e.ports).toEqual([]);
    expect(e.origin).toBe("");
  });

  it("builds an error event from an Error", () => {
    const t = {};
    const err = new Error("boom");
    const e = createErrorEvent(err, t);
    expect(e.type).toBe("error");
    expect(e.message).toBe("boom");
    expect(e.error).toBe(err);
    expect(e.lineno).toBe(0);
  });

  it("builds an error event from a non-Error value", () => {
    const e = createErrorEvent("plain", {});
    expect(e.message).toBe("plain");
  });

  it("builds a messageerror event", () => {
    const e = createMessageErrorEvent({});
    expect(e.type).toBe("messageerror");
    expect(e.data).toBe(null);
  });
});
