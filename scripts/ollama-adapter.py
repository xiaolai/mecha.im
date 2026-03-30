#!/usr/bin/env python3
"""
Thin HTTP adapter: wraps Ollama API into the mecha worker contract.

  GET  /health → 200 OK
  POST /task   → {"output": "...", "metadata": {...}}

Usage:
  OLLAMA_MODEL=gemma2:9b OLLAMA_URL=http://localhost:11434 python3 ollama-adapter.py

Env vars:
  OLLAMA_URL    Ollama API base URL (default: http://localhost:11434)
  OLLAMA_MODEL  Default model (default: gemma2:9b)
  ADAPTER_PORT  Port to listen on (default: 8090)
"""

import json
import os
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.request import Request, urlopen
from urllib.error import URLError

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma2:9b")
ADAPTER_PORT = int(os.environ.get("ADAPTER_PORT", "8090"))

busy = False


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            # Check if Ollama is reachable
            try:
                req = Request(f"{OLLAMA_URL}/", method="GET")
                resp = urlopen(req, timeout=5)
                if resp.status == 200:
                    status = 503 if busy else 200
                    self.send_response(status)
                    self.end_headers()
                    self.wfile.write(b"busy" if busy else b"ok")
                    return
            except Exception:
                pass
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b"ollama unreachable")
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        global busy
        if self.path != "/task":
            self.send_response(404)
            self.end_headers()
            return

        if busy:
            self._json_response(429, {"error": "worker busy"})
            return

        busy = True
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            prompt = body.get("prompt", "")
            model = body.get("model", OLLAMA_MODEL)

            start = time.time()
            result = self._call_ollama(model, prompt)
            duration_ms = int((time.time() - start) * 1000)

            response = {
                "output": result["message"]["content"],
                "metadata": {
                    "model": model,
                    "duration_ms": duration_ms,
                    "input_tokens": result.get("prompt_eval_count", 0),
                    "output_tokens": result.get("eval_count", 0),
                    "exit_code": 0,
                },
            }
            self._json_response(200, response)
        except Exception as e:
            self._json_response(500, {"error": str(e)})
        finally:
            busy = False

    def _call_ollama(self, model, prompt):
        payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        }).encode()
        req = Request(
            f"{OLLAMA_URL}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        resp = urlopen(req, timeout=600)
        return json.loads(resp.read())

    def _json_response(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # suppress access logs


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", ADAPTER_PORT), Handler)
    print(f"ollama adapter ({OLLAMA_MODEL}) listening on :{ADAPTER_PORT}")
    print(f"  ollama: {OLLAMA_URL}")
    print(f"  health: http://localhost:{ADAPTER_PORT}/health")
    print(f"  task:   http://localhost:{ADAPTER_PORT}/task")
    server.serve_forever()
