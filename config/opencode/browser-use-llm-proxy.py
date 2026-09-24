#!/usr/bin/env python3
"""Localhost proxy adding the x-opencode-session header for browser-use MCP.

OpenCode Go rejects external clients that do not send `x-opencode-session`,
but browser-use's MCP config cannot set custom headers on its LLM client.
This proxy listens on 127.0.0.1:49381, forwards /v1/* to the Go endpoint at
https://opencode.ai/zen/go/v1/*, and injects a stable session UUID generated
once at process start. Everything else (status, headers, body) passes through,
including streaming/SSE responses.

Authorization is passed through untouched; no key handling here.
"""

import http.client
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_HOST = "opencode.ai"
UPSTREAM_PATH_PREFIX = "/zen/go"
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 49381

SESSION_ID = str(uuid.uuid4())

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        headers = {}
        for key, value in self.headers.items():
            if key.lower() in HOP_BY_HOP:
                continue
            headers[key] = value
        headers["Host"] = UPSTREAM_HOST
        headers["x-opencode-session"] = SESSION_ID

        conn = http.client.HTTPSConnection(UPSTREAM_HOST, timeout=600)
        try:
            conn.request(
                self.command,
                UPSTREAM_PATH_PREFIX + self.path,
                body=body,
                headers=headers,
            )
            resp = conn.getresponse()

            self.send_response(resp.status)
            for key, value in resp.getheaders():
                if key.lower() in HOP_BY_HOP:
                    continue
                self.send_header(key, value)
            self.send_header("Connection", "close")
            self.end_headers()

            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
            self.wfile.flush()
        finally:
            conn.close()
            self.close_connection = True

    do_GET = _proxy
    do_POST = _proxy
    do_PUT = _proxy
    do_PATCH = _proxy
    do_DELETE = _proxy
    do_OPTIONS = _proxy
    do_HEAD = _proxy


if __name__ == "__main__":
    ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler).serve_forever()
