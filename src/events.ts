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
