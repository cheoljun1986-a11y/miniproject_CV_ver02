"""Dev server: static files plus POST /upload for scan backups.

    python serve.py            # http://localhost:8000
    python serve.py 8080

Drop-in for `python -m http.server`, with one addition: the phone can POST a
scan JSON to /upload?name=<kind>-<sessionId> and it lands in results/ as
<name>.json (overwritten on every backup, so one session is one file).

This is a development convenience for a tunnelled LAN box, not a service:
anyone who knows the tunnel URL can write into results/. The name is
whitelisted (no paths), the body is size-capped and must parse as JSON, and
nothing is ever read back or executed.
"""

import json
import os
import re
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(ROOT, "results")
MAX_BYTES = 200 * 1024 * 1024  # a 400-keyframe diagnostic scan is ~40MB
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ES modules and WebXR are unhappy with stale caches during development.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        parts = urlsplit(self.path)
        if parts.path.rstrip("/") != "/upload":
            self._json(404, {"ok": False, "error": "not found"})
            return

        name = parse_qs(parts.query).get("name", [""])[0]
        if not NAME_RE.match(name):
            self._json(400, {"ok": False, "error": "bad name"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            self._json(413, {"ok": False, "error": f"body must be 1..{MAX_BYTES} bytes"})
            return

        body = self.rfile.read(length)
        try:
            json.loads(body)
        except ValueError:
            self._json(400, {"ok": False, "error": "body is not JSON"})
            return

        os.makedirs(RESULTS_DIR, exist_ok=True)
        final = os.path.join(RESULTS_DIR, f"{name}.json")
        # Write-then-replace so a viewer reading results/ never sees a torn file.
        fd, tmp = tempfile.mkstemp(prefix=f".{name}.", suffix=".part", dir=RESULTS_DIR)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(body)
            os.replace(tmp, final)
        except OSError as exc:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            self._json(500, {"ok": False, "error": str(exc)})
            return

        rel = os.path.relpath(final, ROOT).replace(os.sep, "/")
        self.log_message("upload %s (%d bytes)", rel, length)
        self._json(200, {"ok": True, "file": rel, "bytes": length})

    def _json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.makedirs(RESULTS_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"serving {ROOT} on http://localhost:{port}  (uploads -> results/)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
