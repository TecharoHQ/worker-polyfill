// A minimal synchronous XMLHttpRequest stand-in. The polyfill fetches
// worker scripts with sync XHR; jsdom can't fetch arbitrary URLs, so tests
// register script bodies here and the mock serves them.
type ScriptMap = { [url: string]: string };
type ScriptWithStatusMap = { [url: string]: { code: string; status: number } };

let scripts: ScriptMap = {};
let scriptsWithStatus: ScriptWithStatusMap = {};
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
    if (Object.prototype.hasOwnProperty.call(scriptsWithStatus, this.url)) {
      const entry = scriptsWithStatus[this.url];
      this.status = entry.status;
      this.responseText = entry.code;
    } else if (Object.prototype.hasOwnProperty.call(scripts, this.url)) {
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

export function setScriptWithStatus(url: string, code: string, status: number): void {
  scriptsWithStatus[url] = { code, status };
}

export function failScript(url: string): void {
  failUrls.push(url);
}

export function resetScripts(): void {
  scripts = {};
  scriptsWithStatus = {};
  failUrls = [];
}

export function installMockXHR(): void {
  (globalThis as any).XMLHttpRequest = MockXHR as any;
}
