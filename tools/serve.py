#!/usr/bin/env python3
# The local server for the page and the tools (v10): python's own http.server, but it tells the
# browser not to reuse a stale copy of a file without asking. With the plain one, Safari kept an
# old script from one version and ran it with newer ones, and the loader hung at 99.
#   python3 tools/serve.py            http://localhost:5178
#   python3 tools/serve.py 8080       another port
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoStaleHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Revalidate every time: unchanged files still come back as 304, so this costs little.
        self.send_header("Cache-Control", "no-cache")
        # (So a page opened from file:// can read the assets from here: the standalone build's
        # --local test, v11.)
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
root = Path(__file__).resolve().parent.parent
server = ThreadingHTTPServer(("", port), partial(NoStaleHandler, directory=str(root)))
print(f"serving {root} at http://localhost:{port}", flush=True)
server.serve_forever()
