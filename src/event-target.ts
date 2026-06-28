import { isFunction, getGlobal } from "./utils";
import { PolyfillEvent, createErrorEvent } from "./events";

// A minimal EventTarget that also supports legacy `on<type>` handler
// properties. Both the Worker (parent) object and the worker global scope
// use this, giving them spec-style multi-listener behaviour.
interface EventTargetLike {
  addEventListener: (type: string, callback: any) => void;
  removeEventListener: (type: string, callback: any) => void;
  dispatchEvent: (event: PolyfillEvent) => boolean;
}

const installEventTarget = (host: any, options?: { catchErrors: boolean }): EventTargetLike => {
  const listeners: { [type: string]: any[] } = {};
  const catchErrors = options?.catchErrors !== false; // default to true
  let inErrorDispatch = false;

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
      if (catchErrors) {
        try {
          handler.call(host, event);
        } catch (e) {
          // Swallow handler errors to prevent queue stranding and spec violations.
          // Listener errors are intentionally not re-thrown to maintain fire-and-forget semantics.
        }
      } else {
        handler.call(host, event);
      }
    }

    const list = listeners[event.type];
    if (list) {
      // Snapshot so a listener removing another mid-dispatch is safe.
      const snapshot = list.slice();
      for (let i = 0; i < snapshot.length; i++) {
        if (catchErrors) {
          try {
            snapshot[i].call(host, event);
          } catch (e) {
            // Swallow listener errors to prevent queue stranding and spec violations.
            // Listener errors are intentionally not re-thrown to maintain fire-and-forget semantics.
          }
        } else {
          snapshot[i].call(host, event);
        }
      }
    }
    return true;
  };

  return host as EventTargetLike;
};

export { EventTargetLike, installEventTarget };
