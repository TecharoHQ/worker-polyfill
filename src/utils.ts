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
