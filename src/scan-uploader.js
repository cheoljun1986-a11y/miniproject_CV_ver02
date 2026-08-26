// Ships scan JSON to the dev server's POST /upload (see serve.py). Pure enough
// to test: fetch and the clock are injected.
//
// Same-origin by design: the page is served by the same process that stores
// the uploads, so the cloudflared tunnel carries both without any CORS. On a
// host with no /upload (GitHub Pages) the request 404s and the app carries on
// — backup is a convenience, never a dependency.

const NAME_RE = /^[A-Za-z0-9_-]{1,80}$/;

// results/<kind>-<sessionId>.json — one file per session, overwritten by each
// backup so a run is always exactly one file.
export function uploadName(kind, sessionId) {
  const name = `${kind}-${sessionId}`;
  if (!NAME_RE.test(name)) throw new Error(`invalid upload name: ${name}`);
  return name;
}

// Local wall clock, filesystem-safe: 20260826-101530.
export function formatSessionId(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function shouldBackup({ now, lastBackupAt, intervalMs, dirty }) {
  if (!dirty) return false;
  return now - lastBackupAt >= intervalMs;
}

export class ScanUploader {
  constructor({
    fetchFn = (...args) => globalThis.fetch(...args),
    endpoint = './upload',
    onStatus = null,
  } = {}) {
    this.fetchFn = fetchFn;
    this.endpoint = endpoint;
    this.onStatus = onStatus;
    this.inFlight = null;
    this.lastResult = null;
  }

  isBusy() {
    return this.inFlight !== null;
  }

  // Serialised: a backup that starts while the previous one is still going
  // would race it on the same file. The caller just tries again next tick.
  async upload(name, text, { label = name } = {}) {
    if (this.inFlight) return { ok: false, skipped: true };
    const bytes = text.length;
    this.onStatus?.(`서버 전송 중… ${label} (${formatBytes(bytes)})`);
    const run = (async () => {
      try {
        const response = await this.fetchFn(
          `${this.endpoint}?name=${encodeURIComponent(name)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text },
        );
        if (!response.ok) {
          const reason = response.status === 404 ? '업로드 서버 없음' : `HTTP ${response.status}`;
          this.onStatus?.(`전송 실패 · ${reason}`);
          return { ok: false, status: response.status };
        }
        let file = `${name}.json`;
        try {
          const body = await response.json();
          if (body?.file) file = body.file;
        } catch {
          // A bare 200 is still a success.
        }
        this.onStatus?.(`전송 완료 · ${file} (${formatBytes(bytes)})`);
        return { ok: true, file };
      } catch (error) {
        this.onStatus?.(`전송 실패 · ${error?.message ?? error}`);
        return { ok: false, error };
      }
    })();
    this.inFlight = run;
    try {
      this.lastResult = await run;
      return this.lastResult;
    } finally {
      this.inFlight = null;
    }
  }
}

export function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
