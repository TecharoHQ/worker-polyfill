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
  installEventTarget(scope, { catchErrors: false });

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
