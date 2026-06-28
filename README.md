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

## Limitations

`importScripts()` is synchronous and executes imported scripts immediately,
but top-level `var`/`function` declarations in an imported script are NOT
visible to the main worker script (or vice versa). Use `self.X = ...`
assignments (which land on the worker scope) to share values across scripts
loaded via `importScripts()`.

## Development

```bash
npm install
npm test        # vitest + jsdom conformance suite
npm run build   # webpack UMD bundle into lib/
```

- For more on workers see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- Originally exported from Google Code (https://code.google.com/p/ie-web-worker/).
