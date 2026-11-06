#!/usr/bin/env python3
"""Serve a build as deploy/nginx.conf does, for previewing and the browser test.

    python3 tools/serve.py <build> <port>
"""
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; "
        "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; "
        "require-trusted-types-for 'script'; trusted-types 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-cache",
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def translate_path(self, path):
        path = path.split("?", 1)[0]
        root = Path(self.directory)
        if re.fullmatch(r"/sessions/dn-[a-z0-9-]+", path):
            return str(root / "sessions" / "view.html")
        if re.fullmatch(r"/sessions/dn-[a-z2-7]{5}/outputs/[0-9]+\.zip", path):
            return str(root / "demo" / "output.zip")
        # try_files $uri $uri.html $uri/: a file, then the page, then a directory.
        found = super().translate_path(path)
        if not Path(found).is_file() and Path(found.rstrip("/") + ".html").is_file():
            return found.rstrip("/") + ".html"
        return found

    def end_headers(self):
        for name, value in HEADERS.items():
            self.send_header(name, value)
        super().end_headers()


if __name__ == "__main__":
    build, port = sys.argv[1], int(sys.argv[2])
    ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=build)).serve_forever()
