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
