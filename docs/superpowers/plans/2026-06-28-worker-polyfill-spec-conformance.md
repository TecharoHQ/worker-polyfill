# Worker Polyfill Spec-Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the wiring bugs in the Worker polyfill and bring its core surface up to the WHATWG/MDN Dedicated Worker spec (real EventTarget semantics, real message/error events, structured-clone messages, ordered delivery, a proper worker-side `self`/`close`/`name`, and synchronous `importScripts`), backed by a Vitest + jsdom conformance suite.

**Architecture:** The polyfill keeps its core approach — fetch the worker script with synchronous `XHR` and `eval` it in-process (single-threaded fake worker). We split responsibilities into small modules: a deep-clone shim, event-object factories, a reusable `EventTarget` mixin used by *both* the `Worker` object and the worker scope, and a dedicated worker-scope builder. The worker script is evaluated inside its **own** scope object (so `self`, `postMessage`, `onmessage`, etc. resolve to the worker globals, not the `Worker` instance) via a sloppy-mode `Function`-constructor evaluator that uses `with`. Messages flow through FIFO queues drained on `setTimeout`, so ordering and async semantics match the spec.

**Tech Stack:** TypeScript (target ES5), webpack 5 (UMD bundle), Vitest + jsdom for tests. Zero runtime dependencies.

## Global Constraints

- **No runtime dependencies.** The shipped bundle must stay dependency-free (testing deps are `devDependencies` only).
- **IE / old-browser safe at runtime.** Source may use modern TS syntax (compiled to ES5), but must not call runtime APIs missing in IE11: no `Promise`, `Map`/`WeakMap`, `Array.from`, `structuredClone`, `MessageEvent`/`ErrorEvent` constructors, `Object.assign`, or arrow-function-only features at runtime. Use `for` loops, `indexOf`, `splice`, array-based bookkeeping.
- **TypeScript:** `typescript@^6` (matches `package.json`). `tsconfig.json` stays `target: es5`, `module: commonjs`, `lib: ["es2015","dom","scripthost"]`, `strict: false`.
- **Scope:** Dedicated Workers only. Out of scope: module workers (`type:"module"`), transferables, `blob:`/`data:` URLs, `credentials`. These must be accepted-but-ignored without throwing where the constructor signature allows them.
- **The script evaluator must not assume strict mode is off in the surrounding module.** Use `new Function(...)` (sloppy-mode body) for any `with`-based evaluation.
- **Author/license unchanged.** MIT, existing author field preserved.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/utils.ts` | `isFunction`, `getHTTPObject`, `getGlobal`, `fetchScriptSync` | Modify |
| `src/clone.ts` | `structuredCloneShim` — deep copy with cycle support | Create |
| `src/events.ts` | `createMessageEvent`, `createErrorEvent`, `createMessageErrorEvent` + `PolyfillEvent` type | Create |
| `src/event-target.ts` | `installEventTarget` mixin (multi-listener add/remove/dispatch + `on*` handlers) | Create |
| `src/worker-scope.ts` | `createWorkerScope` — the DedicatedWorkerGlobalScope-like object + sloppy-mode evaluator | Create |
| `src/worker-polyfill.ts` | `WorkerPolyfill` constructor (queues, terminate, error dispatch) + guarded global install | Rewrite |
| `test/helpers/mockXHR.ts` | Fake synchronous `XMLHttpRequest` serving canned scripts | Create |
| `test/*.test.ts` | Unit + integration conformance tests | Create |
| `vitest.config.ts` | Vitest config (jsdom env) | Create |
| `tsconfig.json` | Ensure `test/**` excluded from build | Modify |
| `webpack.config.js` | Rename UMD global to `WorkerPolyfill` so it doesn't clobber the side-effect install | Modify |
| `package.json` | Add `test`/`test:run` scripts + dev deps | Modify |
| `README.md` | Document new behaviour | Modify |

---

## Task 1: Test harness (Vitest + jsdom + mock XHR)

**Files:**
- Create: `vitest.config.ts`
- Create: `test/helpers/mockXHR.ts`
- Create: `test/harness.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json:13` (exclude `test`)

**Interfaces:**
- Produces:
  - `installMockXHR(): void` — replaces `globalThis.XMLHttpRequest` with the mock.
  - `setScript(url: string, code: string): void` — register a script body for a URL.
  - `failScript(url: string): void` — make a URL return HTTP 404.
  - `resetScripts(): void` — clear registry.

- [ ] **Step 1: Add dev dependencies**

Run:
```bash
npm install --save-dev vitest@^3 jsdom@^25
```
Expected: `vitest` and `jsdom` appear under `devDependencies` in `package.json`.

- [ ] **Step 2: Add test scripts to `package.json`**

In `package.json`, add to the `"scripts"` object (keep existing `prebuild`/`build`):
```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Exclude `test` from the TS build**

In `tsconfig.json`, change the `exclude` array (line 14) to:
```json
"exclude": ["node_modules", "lib", "test"]
```

- [ ] **Step 5: Create the mock XHR helper `test/helpers/mockXHR.ts`**

```ts
// A minimal synchronous XMLHttpRequest stand-in. The polyfill fetches
// worker scripts with sync XHR; jsdom can't fetch arbitrary URLs, so tests
// register script bodies here and the mock serves them.
type ScriptMap = { [url: string]: string };

let scripts: ScriptMap = {};
let failUrls: string[] = [];

class MockXHR {
  status = 0;
  readyState = 0;
  responseText = "";
  private url = "";

  open(_method: string, url: string, _async?: boolean) {
    this.url = url;
  }

  send(_body?: any) {
    this.readyState = 4;
    if (failUrls.indexOf(this.url) !== -1) {
      this.status = 404;
      this.responseText = "";
      return;
    }
    if (Object.prototype.hasOwnProperty.call(scripts, this.url)) {
      this.status = 200;
      this.responseText = scripts[this.url];
    } else {
      this.status = 404;
      this.responseText = "";
    }
  }
}

export function setScript(url: string, code: string): void {
  scripts[url] = code;
}

export function failScript(url: string): void {
  failUrls.push(url);
}

export function resetScripts(): void {
  scripts = {};
  failUrls = [];
}

export function installMockXHR(): void {
  (globalThis as any).XMLHttpRequest = MockXHR as any;
}
```

- [ ] **Step 6: Write a harness smoke test `test/harness.test.ts`**

```ts
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
```

- [ ] **Step 7: Run the harness test**

Run: `npx vitest run test/harness.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.json test/helpers/mockXHR.ts test/harness.test.ts
git commit -m "test: add vitest + jsdom harness with mock XHR"
```

---

## Task 2: `structuredCloneShim` (deep clone)

**Files:**
- Create: `src/clone.ts`
- Create: `test/clone.test.ts`

**Interfaces:**
- Produces: `structuredCloneShim(value: any): any` — returns a deep copy of plain data (primitives, arrays, plain objects, `Date`, `RegExp`), preserving internal cyclic references. Functions/DOM nodes are copied by reference inside the object graph (best-effort; the polyfill's contract is plain data).

- [ ] **Step 1: Write the failing test `test/clone.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/clone.test.ts`
Expected: FAIL — cannot resolve `../src/clone`.

- [ ] **Step 3: Implement `src/clone.ts`**

```ts
// Minimal structured-clone approximation for the Worker polyfill.
// Handles primitives, arrays, plain objects, Date, RegExp, and cyclic
// references using paired arrays (no Map/WeakMap, for IE compatibility).
// Non-cloneable values (functions, DOM nodes) are kept by reference.
const structuredCloneShim = (value: any, seen?: any[], copies?: any[]): any => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  seen = seen || [];
  copies = copies || [];

  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === value) {
      return copies[i];
    }
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  const out: any = Array.isArray(value) ? [] : {};
  seen.push(value);
  copies.push(out);

  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out[key] = structuredCloneShim(value[key], seen, copies);
    }
  }

  return out;
};

export { structuredCloneShim };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/clone.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/clone.ts test/clone.test.ts
git commit -m "feat: add structured-clone shim for postMessage"
```

---

## Task 3: Event factories

**Files:**
- Create: `src/events.ts`
- Create: `test/events.test.ts`

**Interfaces:**
- Produces:
  - `PolyfillEvent` — interface: `{ type: string; target: any; currentTarget: any; [k: string]: any }`.
  - `createMessageEvent(data: any, target: any): PolyfillEvent` — `type:"message"`, `.data`, `.origin:""`, `.lastEventId:""`, `.source:null`, `.ports:[]`.
  - `createErrorEvent(error: any, target: any): PolyfillEvent` — `type:"error"`, `.message`, `.filename:""`, `.lineno:0`, `.colno:0`, `.error`.
  - `createMessageErrorEvent(target: any): PolyfillEvent` — `type:"messageerror"`, `.data:null`.

- [ ] **Step 1: Write the failing test `test/events.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/events.test.ts`
Expected: FAIL — cannot resolve `../src/events`.

- [ ] **Step 3: Implement `src/events.ts`**

```ts
// Lightweight event objects. Old browsers may lack the MessageEvent /
// ErrorEvent constructors, so we build plain objects carrying the fields the
// Worker API exposes.
interface PolyfillEvent {
  type: string;
  target: any;
  currentTarget: any;
  [key: string]: any;
}

const createMessageEvent = (data: any, target: any): PolyfillEvent => {
  return {
    type: "message",
    data: data,
    target: target,
    currentTarget: target,
    origin: "",
    lastEventId: "",
    source: null,
    ports: [],
  };
};

const createErrorEvent = (error: any, target: any): PolyfillEvent => {
  const message = error && error.message ? error.message : String(error);
  return {
    type: "error",
    target: target,
    currentTarget: target,
    message: message,
    filename: "",
    lineno: 0,
    colno: 0,
    error: error,
  };
};

const createMessageErrorEvent = (target: any): PolyfillEvent => {
  return {
    type: "messageerror",
    target: target,
    currentTarget: target,
    data: null,
  };
};

export {
  PolyfillEvent,
  createMessageEvent,
  createErrorEvent,
  createMessageErrorEvent,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/events.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/events.ts test/events.test.ts
git commit -m "feat: add message/error event factories"
```

---

## Task 4: `installEventTarget` mixin

**Files:**
- Create: `src/event-target.ts`
- Create: `test/event-target.test.ts`

**Interfaces:**
- Consumes: `isFunction` from `./utils`; `PolyfillEvent` from `./events`.
- Produces:
  - `EventTargetLike` — interface: `{ addEventListener(type,cb): void; removeEventListener(type,cb): void; dispatchEvent(event): boolean }`.
  - `installEventTarget(host: any): EventTargetLike` — attaches `addEventListener`/`removeEventListener`/`dispatchEvent` to `host`; `dispatchEvent` invokes both the `host["on"+type]` handler (if a function) and every registered listener, each called with `host` as `this`.

- [ ] **Step 1: Write the failing test `test/event-target.test.ts`**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/event-target.test.ts`
Expected: FAIL — cannot resolve `../src/event-target`.

- [ ] **Step 3: Implement `src/event-target.ts`**

```ts
import { isFunction } from "./utils";
import { PolyfillEvent } from "./events";

// A minimal EventTarget that also supports legacy `on<type>` handler
// properties. Both the Worker (parent) object and the worker global scope
// use this, giving them spec-style multi-listener behaviour.
interface EventTargetLike {
  addEventListener: (type: string, callback: any) => void;
  removeEventListener: (type: string, callback: any) => void;
  dispatchEvent: (event: PolyfillEvent) => boolean;
}

const installEventTarget = (host: any): EventTargetLike => {
  const listeners: { [type: string]: any[] } = {};

  host.addEventListener = function (type: string, callback: any) {
    if (!isFunction(callback)) {
      return;
    }
    if (!listeners[type]) {
      listeners[type] = [];
    }
    if (listeners[type].indexOf(callback) === -1) {
      listeners[type].push(callback);
    }
  };

  host.removeEventListener = function (type: string, callback: any) {
    const list = listeners[type];
    if (!list) {
      return;
    }
    const idx = list.indexOf(callback);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  };

  host.dispatchEvent = function (event: PolyfillEvent) {
    event.target = event.target || host;
    event.currentTarget = host;

    const handler = host["on" + event.type];
    if (isFunction(handler)) {
      handler.call(host, event);
    }

    const list = listeners[event.type];
    if (list) {
      // Snapshot so a listener removing another mid-dispatch is safe.
      const snapshot = list.slice();
      for (let i = 0; i < snapshot.length; i++) {
        snapshot[i].call(host, event);
      }
    }
    return true;
  };

  return host as EventTargetLike;
};

export { EventTargetLike, installEventTarget };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/event-target.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/event-target.ts test/event-target.test.ts
git commit -m "feat: add EventTarget mixin with multi-listener + on* support"
```

---

## Task 5: `utils.ts` — global accessor + synchronous fetch

**Files:**
- Modify: `src/utils.ts`
- Create: `test/utils.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (additions; keep existing `isFunction`, `getHTTPObject`):
  - `getGlobal(): any` — returns the global object (`globalThis` / `self` / `window`), IE-safe.
  - `fetchScriptSync(url: string): string` — synchronous GET; returns `responseText` on success, throws `Error` on load failure (no object, non-`200`-ish status, or 404/500).

- [ ] **Step 1: Write the failing test `test/utils.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/utils.test.ts`
Expected: FAIL — `fetchScriptSync`/`getGlobal` are not exported.

- [ ] **Step 3: Rewrite `src/utils.ts`**

```ts
const isFunction = (f: any) => {
  return typeof f === "function";
};

/* HTTP Request */
const getHTTPObject = (): any => {
  let xmlhttp: any;
  try {
    xmlhttp = new XMLHttpRequest();
  } catch (e) {
    try {
      // @ts-ignore - ActiveXObject only exists in old IE
      xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
    } catch (e2) {
      xmlhttp = false;
    }
  }
  return xmlhttp;
};

// Resolve the global object across environments (browser, worker, Node, IE).
const getGlobal = (): any => {
  if (typeof globalThis !== "undefined") {
    return globalThis;
  }
  if (typeof self !== "undefined") {
    return self;
  }
  // @ts-ignore - window exists in browsers
  if (typeof window !== "undefined") {
    // @ts-ignore
    return window;
  }
  return {};
};

// Fetch a script synchronously and return its source text. Throws on failure
// so callers can surface an `error` event.
const fetchScriptSync = (url: string): string => {
  const http = getHTTPObject();
  if (!http) {
    throw new Error("No XMLHttpRequest available to load: " + url);
  }
  http.open("GET", url, false);
  http.send(null);

  const ok =
    http.readyState === 4 &&
    http.status !== 404 &&
    http.status !== 500;

  if (!ok) {
    throw new Error(
      "Failed to load worker script: " + url + " (status " + http.status + ")",
    );
  }
  return http.responseText;
};

export { isFunction, getHTTPObject, getGlobal, fetchScriptSync };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/utils.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts test/utils.test.ts
git commit -m "feat: add getGlobal and fetchScriptSync helpers"
```

---

## Task 6: `createWorkerScope` (worker-side global)

**Files:**
- Create: `src/worker-scope.ts`
- Create: `test/worker-scope.test.ts`

**Interfaces:**
- Consumes: `fetchScriptSync` from `./utils`; `installEventTarget` from `./event-target`; `createMessageEvent` from `./events`; `structuredCloneShim` from `./clone`.
- Produces:
  - `WorkerScope` — interface with `self`, `name`, `onmessage`, `onmessageerror`, `onerror`, `postMessage(data)`, `importScripts(...urls)`, `close()`, `addEventListener`, `removeEventListener`, `dispatchEvent`, `__deliver(data)`, `__evalScript(code)`.
  - `createWorkerScope(name: string, toParent: (data:any)=>void, onClose: ()=>void): WorkerScope` — builds the scope. `postMessage` clones then calls `toParent`. `__deliver` dispatches a `message` event into the scope. `__evalScript` runs code with the scope as the variable environment (bare `self`/`postMessage`/`onmessage` resolve to scope members).

- [ ] **Step 1: Write the failing test `test/worker-scope.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker-scope.test.ts`
Expected: FAIL — cannot resolve `../src/worker-scope`.

- [ ] **Step 3: Implement `src/worker-scope.ts`**

```ts
import { fetchScriptSync } from "./utils";
import { installEventTarget } from "./event-target";
import { createMessageEvent } from "./events";
import { structuredCloneShim } from "./clone";

interface WorkerScope {
  self: WorkerScope;
  name: string;
  onmessage: any;
  onmessageerror: any;
  onerror: any;
  postMessage: (data: any) => void;
  importScripts: (...urls: string[]) => void;
  close: () => void;
  addEventListener: (type: string, cb: any) => void;
  removeEventListener: (type: string, cb: any) => void;
  dispatchEvent: (event: any) => boolean;
  __deliver: (data: any) => void;
  __evalScript: (code: string) => void;
}

// Evaluate worker code with `scope` as its variable environment. `with` is
// illegal in strict mode, but a Function-constructor body is sloppy mode
// regardless of how the surrounding module is compiled, so bare identifiers
// (self, postMessage, onmessage, importScripts, close, ...) resolve to the
// scope object. Direct `eval` runs in this augmented environment.
// NOTE: the parameter names below leak into worker code as identifiers; they
// are deliberately obscure to avoid collisions.
const runWithScope: (scope: any, __worker_src__: string) => void = new Function(
  "__worker_scope__",
  "__worker_src__",
  "with (__worker_scope__) { eval(__worker_src__); }",
) as any;

// Builds the worker-side global scope (a DedicatedWorkerGlobalScope-like
// object). `toParent` is called when the worker posts a message out; `onClose`
// is called when the worker calls close().
const createWorkerScope = (
  name: string,
  toParent: (data: any) => void,
  onClose: () => void,
): WorkerScope => {
  const scope = {} as WorkerScope;
  installEventTarget(scope);

  scope.self = scope;
  scope.name = name || "";
  scope.onmessage = null;
  scope.onmessageerror = null;
  scope.onerror = null;

  scope.postMessage = function (data: any) {
    toParent(structuredCloneShim(data));
  };

  scope.importScripts = function () {
    const urls = Array.prototype.slice.call(arguments);
    for (let i = 0; i < urls.length; i++) {
      scope.__evalScript(fetchScriptSync(urls[i]));
    }
  };

  scope.close = function () {
    onClose();
  };

  // Deliver a parent->worker message as a `message` event inside the scope.
  scope.__deliver = function (data: any) {
    scope.dispatchEvent(createMessageEvent(data, scope));
  };

  scope.__evalScript = function (code: string) {
    runWithScope(scope, code);
  };

  return scope;
};

export { WorkerScope, createWorkerScope };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/worker-scope.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker-scope.ts test/worker-scope.test.ts
git commit -m "feat: add worker scope with isolated self and sync importScripts"
```

---

## Task 7: `WorkerPolyfill` constructor (rewrite)

**Files:**
- Rewrite: `src/worker-polyfill.ts`
- Create: `test/worker-polyfill.test.ts`

**Interfaces:**
- Consumes: `fetchScriptSync`, `getGlobal` from `./utils`; `installEventTarget` from `./event-target`; `createMessageEvent`, `createErrorEvent` from `./events`; `structuredCloneShim` from `./clone`; `createWorkerScope`, `WorkerScope` from `./worker-scope`.
- Produces:
  - `WorkerPolyfill` — constructor `new WorkerPolyfill(scriptFile: string, options?: { type?; name?; credentials? })`. Instance is an `EventTarget` with `postMessage(data)`, `terminate()`, and `on(message|error|messageerror)`. Parent→worker delivery is FIFO and async (`setTimeout`); worker→parent delivery is async. `terminate()` and worker-side `close()` stop all further delivery. Load/eval failures dispatch an async `error` event.
  - Side effect on import: installs `WorkerPolyfill` as the global `Worker` **only if no native `Worker` exists**.

- [ ] **Step 1: Write the failing test `test/worker-polyfill.test.ts`**

```ts
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
    setScript("dep.js", "var DEP_VALUE = 42;");
    setScript("main.js", "importScripts('dep.js'); onmessage = function(){ postMessage(DEP_VALUE); };");
    const w = makeWorker("main.js");
    let got: any = null;
    w.onmessage = (e: any) => (got = e.data);
    w.postMessage("go");
    vi.runAllTimers();
    expect(got).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker-polyfill.test.ts`
Expected: FAIL — `WorkerPolyfill` not exported / behaviour mismatch.

- [ ] **Step 3: Rewrite `src/worker-polyfill.ts`**

```ts
/*
  A single-threaded Worker polyfill for IE and other old browsers.
  Dedicated Workers only. The worker script is fetched with synchronous XHR
  and eval'd in-process, inside its own scope object so that `self`,
  `postMessage`, `onmessage`, etc. behave like a real worker global.
  Remember: messages are structured-cloned, but this is NOT a real thread and
  provides none of the native security isolation.
*/
import { fetchScriptSync, getGlobal } from "./utils";
import { installEventTarget } from "./event-target";
import { createMessageEvent, createErrorEvent } from "./events";
import { structuredCloneShim } from "./clone";
import { createWorkerScope, WorkerScope } from "./worker-scope";

interface PolyfillWorkerOptions {
  type?: string;
  name?: string;
  credentials?: string;
}

const WorkerPolyfill = function (
  this: any,
  scriptFile: string,
  options?: PolyfillWorkerOptions,
) {
  const self = this;
  const opts = options || {};
  const glob = getGlobal();

  installEventTarget(self);
  self.onmessage = null;
  self.onerror = null;
  self.onmessageerror = null;

  let terminated = false;
  const inbox: any[] = [];
  let scope: WorkerScope | null = null;

  // worker -> parent
  const toParent = function (data: any) {
    if (terminated) {
      return;
    }
    glob.setTimeout(function () {
      if (terminated) {
        return;
      }
      self.dispatchEvent(createMessageEvent(data, self));
    }, 0);
  };

  const stop = function () {
    terminated = true;
    inbox.length = 0;
  };

  // Drain queued parent->worker messages one at a time, asynchronously, so
  // ordering is preserved and delivery never blocks the caller.
  const drain = function () {
    if (terminated || !scope || inbox.length === 0) {
      return;
    }
    const data = inbox.shift();
    try {
      scope.__deliver(data);
    } catch (e) {
      self.dispatchEvent(createErrorEvent(e, self));
    }
    if (!terminated && inbox.length > 0) {
      glob.setTimeout(drain, 0);
    }
  };

  // parent -> worker
  self.postMessage = function (data: any) {
    if (terminated) {
      return;
    }
    inbox.push(structuredCloneShim(data));
    glob.setTimeout(drain, 0);
  };

  self.terminate = function () {
    stop();
  };

  // Load and start the worker. Failures (load or top-level eval) dispatch an
  // async error event so handlers attached right after construction still fire.
  try {
    const code = fetchScriptSync(scriptFile);
    scope = createWorkerScope(opts.name || "", toParent, stop);
    scope.__evalScript(code);
  } catch (e) {
    glob.setTimeout(function () {
      self.dispatchEvent(createErrorEvent(e, self));
    }, 0);
  }
};

// Install as the global Worker only when there is no native implementation.
const glob = getGlobal();
if (typeof glob.Worker === "undefined") {
  glob.Worker = WorkerPolyfill;
}

export { WorkerPolyfill };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/worker-polyfill.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm run test:run`
Expected: PASS — all test files green.

- [ ] **Step 6: Commit**

```bash
git add src/worker-polyfill.ts test/worker-polyfill.test.ts
git commit -m "feat: rewrite Worker constructor with queues, error events, terminate"
```

---

## Task 8: Build config + bundle verification

**Files:**
- Modify: `webpack.config.js:26` (UMD library name)
- Verify: `lib/` build output

**Interfaces:**
- Consumes: all `src` modules.
- Produces: `lib/worker-polyfill.js` (+ `.min.js`) UMD bundle that installs the global `Worker` as a side effect and exposes `WorkerPolyfill` as the named UMD export.

**Rationale:** The current UMD `library: 'Worker'` makes webpack assign `window.Worker = factory()`. Since the module now has a real export, that would set `window.Worker` to the exports object and clobber the guarded side-effect install. Renaming the UMD global to `WorkerPolyfill` lets the in-module guarded install own `window.Worker`.

- [ ] **Step 1: Update the UMD library name in `webpack.config.js`**

Change line 26 from:
```js
    library: 'Worker',
```
to:
```js
    library: 'WorkerPolyfill',
```

- [ ] **Step 2: Build the bundle**

Run: `npm run build`
Expected: webpack completes with no TypeScript errors; `lib/worker-polyfill.js` and `lib/worker-polyfill.min.js` are regenerated.

- [ ] **Step 3: Smoke-check the built bundle installs a global Worker**

Run:
```bash
node -e "var XHR=function(){};XHR.prototype.open=function(){};XHR.prototype.send=function(){this.readyState=4;this.status=200;this.responseText='';};global.XMLHttpRequest=XHR;global.window=global;require('./lib/worker-polyfill.js');console.log(typeof global.Worker);"
```
Expected output: `function`

- [ ] **Step 4: Commit**

```bash
git add webpack.config.js lib
git commit -m "build: expose WorkerPolyfill UMD export without clobbering global Worker"
```

---

## Task 9: README update

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `README.md` to reflect the new behaviour**

Replace the body of `README.md` with:

````markdown
# worker-polyfill

A small polyfill that emulates the Dedicated [Web Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Worker)
in browsers that don't support it (Internet Explorer and other old browsers).
The code is still single-threaded, but it lets you keep one consistent code
path. Messages are structured-cloned and delivered asynchronously, matching
the spec's observable behaviour.

## Install

The polyfill installs itself as the global `Worker` **only if the browser has
no native implementation**, so it is safe to include unconditionally:

```html
<script src="worker-polyfill.js"></script>
```

## Usage

Workers are created and used as usual:

```js
var worker = new Worker("your_script.js");

worker.onmessage = function (event) {
  alert("Got: " + event.data);
};

worker.onerror = function (event) {
  alert("Worker error: " + event.message);
};

worker.postMessage("Hello World");
```

`addEventListener` is supported with full multi-listener semantics:

```js
worker.addEventListener("message", function (event) {
  alert("Got: " + event.data);
});
worker.addEventListener("error", function (event) {
  alert("Worker error: " + event.message);
});
```

Inside the worker script, the usual idioms work because the script runs in its
own scope:

```js
// your_script.js
self.onmessage = function (event) {
  self.postMessage("echo: " + event.data);
};
// importScripts() is supported and runs synchronously
// close() stops the worker
```

## Supported

`postMessage` (structured-cloned, ordered), `terminate`, `close`,
`addEventListener`/`removeEventListener`/`dispatchEvent`, `message`/`error`
events, `importScripts` (synchronous), `self`/`name`.

## Not supported

Module workers (`type: "module"`), transferable objects, `blob:`/`data:` URLs,
`credentials`, and real OS-thread parallelism. Pass plain, cloneable data.

## Development

```bash
npm install
npm test        # vitest + jsdom conformance suite
npm run build   # webpack UMD bundle into lib/
```

- For more on workers see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- Originally exported from Google Code (https://code.google.com/p/ie-web-worker/).
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document spec-conformant behaviour and limitations"
```

---

## Testing Process (summary)

The suite is **test-first per task** (TDD) and layered:

1. **Unit tests** for each pure module — `clone`, `events`, `event-target`, `utils` — verify behaviour in isolation against the spec's field shapes and semantics.
2. **Worker-scope tests** verify the hardest fix (the `self` collision) directly: that `self.*` and bare identifiers both resolve to the worker scope, that `postMessage` clones, and that `close()` works.
3. **Integration tests** (`worker-polyfill.test.ts`) drive the public `Worker` API end-to-end through the mock XHR, with **fake timers** (`vi.useFakeTimers()` + `vi.runAllTimers()`) to deterministically flush the async `setTimeout` delivery queues. These cover every bug from the audit:
   - error event fires on handler throw / load failure / top-level throw (audit #1, #2)
   - message ordering for rapid posts (audit #3)
   - multiple `addEventListener` listeners (audit #4)
   - `self.*` idiom works (audit #5)
   - synchronous `importScripts` (audit #6)
   - structured clone, real event objects, `terminate`, worker `close`.
4. **Build verification** (`npm run build`) confirms the TS compiles to ES5 and the UMD bundle installs the global without clobbering a native `Worker`.

Run everything with `npm run test:run`; run the production build with `npm run build`.

---

## Self-Review

**Spec coverage** (audit findings → task):
- #1 error event never fires → Task 7 (handler-throw + drain catch dispatch `error`). ✅
- #2 silent construction failure → Task 5 (`fetchScriptSync` throws) + Task 7 (catch → async `error`). ✅
- #3 message loss/duplication → Task 7 (FIFO `inbox` queue). ✅
- #4 single addEventListener listener → Task 4 (`installEventTarget` multi-listener). ✅
- #5 `self` collision → Task 6 (isolated scope + sloppy-mode `with` evaluator). ✅
- #6 async importScripts + page pollution → Task 6 (sync XHR eval into scope). ✅
- Missing surface (real MessageEvent/ErrorEvent → Task 3; structured clone → Task 2; terminate halts → Task 7; messageerror factory → Task 3; close/name/self → Task 6; remove/dispatchEvent → Task 4; feature-detection guard → Task 7). ✅
- Out-of-scope (module workers, transferables, blob:/data:, credentials) documented as accepted-but-ignored / unsupported in README (Task 9) and Global Constraints. ✅

**Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to" — every code and test step contains complete content. ✅

**Type consistency:** `WorkerScope` members (`__deliver`, `__evalScript`, `postMessage`, `close`, `name`) are defined in Task 6 and consumed identically in Task 7. `installEventTarget`/`PolyfillEvent`/event factory signatures are consistent across Tasks 3, 4, 6, 7. `fetchScriptSync`/`getGlobal` defined in Task 5 and used in Tasks 6, 7. ✅
