#!/usr/bin/env python3
"""End-to-end tests for the loopback server the Windows shell uses.

The production handler (native/http.c) is compiled for the host and served from
a real socket, so routing, headers, percent-decoding and the /open allow-list
are exercised for real.

    python3 scripts/test-http.py
"""

from __future__ import annotations

import http.client
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
PORT = 47899
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        failures.append(message)


def request(method: str, path: str) -> tuple[int, dict[str, str], bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    connection.request(method, path, headers={"Host": f"127.0.0.1:{PORT}"})
    response = connection.getresponse()
    body = response.read()
    headers = {key.lower(): value for key, value in response.getheaders()}
    connection.close()
    return response.status, headers, body


def wait_ready(process: subprocess.Popen[str], timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.stdout is None:
            return False
        line = process.stdout.readline()
        if not line:
            return False
        if line.startswith("READY"):
            return True
    return False


def drain_open_calls(process: subprocess.Popen[str], count: int, timeout: float = 5.0) -> list[str]:
    seen: list[str] = []
    deadline = time.time() + timeout
    assert process.stdout is not None
    while len(seen) < count and time.time() < deadline:
        line = process.stdout.readline()
        if not line:
            break
        if line.startswith("OPEN "):
            seen.append(line[5:].strip())
    return seen


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix="byazen-http-"))
    binary = workdir / "http_test"
    source = ROOT / "native" / "tests" / "http_test.c"
    module = ROOT / "native" / "http.c"
    compiler = os.environ.get("CC") or shutil.which("cc") or shutil.which("gcc") or "cc"

    compile_cmd = [compiler, "-O2", "-std=c11", "-Wall", "-Wextra", "-o", str(binary),
                   str(source), str(module)]
    built = subprocess.run(compile_cmd, capture_output=True, text=True)
    if built.returncode != 0:
        print(built.stdout)
        print(built.stderr)
        raise SystemExit("cannot build the http test harness")
    if built.stderr.strip():
        print("compiler warnings:")
        print(built.stderr.strip())

    html_path = ROOT / "dist-desktop" / "index.html"
    if not html_path.exists():
        raise SystemExit("build the desktop bundle first: npx vite build --config vite.config.desktop.ts")

    server = subprocess.Popen(
        [str(binary), str(PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={**os.environ, "BYAZEN_TEST_HTML": str(html_path)},
    )

    try:
        if not wait_ready(server):
            raise SystemExit("server did not start")

        expected_html = html_path.read_bytes()

        status, headers, body = request("GET", "/")
        check(status == 200, "GET / -> 200")
        check(headers.get("content-type") == "text/html; charset=utf-8", "content-type is HTML")
        check(headers.get("content-length") == str(len(expected_html)), "content-length matches")
        check(body == expected_html, f"body is the app bundle ({len(body)} bytes)")
        check(headers.get("connection") == "close", "connection closes after the response")

        status, headers, body = request("GET", "/?desktop=1")
        check(status == 200 and body == expected_html, "GET /?desktop=1 serves the same app")

        status, headers, body = request("HEAD", "/")
        check(status == 200 and body == b"", "HEAD / -> 200 without a body")
        check(headers.get("content-length") == str(len(expected_html)),
              "HEAD reports the full content-length")

        status, headers, body = request("GET", "/favicon.svg")
        check(status == 200 and headers.get("content-type") == "image/svg+xml",
              "GET /favicon.svg -> 200 image/svg+xml")
        check(body.startswith(b"<svg"), "favicon body is SVG")

        status, _, body = request("GET", "/health")
        check(status == 200 and body == b"byazen", "GET /health -> byazen")

        status, _, body = request("GET", "/nope")
        check(status == 404, "unknown path -> 404")

        status, _, _ = request("POST", "/")
        check(status == 405, "POST / -> 405")

        target = "https://example.com/a?b=1&c=2"
        status, _, body = request("GET", "/open?url=" + quote(target, safe=""))
        check(status == 200 and body == b"ok", "GET /open with a web URL -> ok")
        opened = drain_open_calls(server, 1)
        check(opened == [target], f"the exact URL reaches the shell: {opened}")

        unicode_url = "https://ru.wikipedia.org/wiki/Привет"
        status, _, _ = request("GET", "/open?url=" + quote(unicode_url, safe=""))
        opened = drain_open_calls(server, 1)
        check(status == 200 and opened == [unicode_url], "percent-decoded UTF-8 survives")

        status, _, _ = request("GET", "/open?url=" + quote("file:///C:/Windows/win.ini", safe=""))
        check(status == 400, "file:// is rejected")
        status, _, _ = request("GET", "/open?url=" + quote("javascript:alert(1)", safe=""))
        check(status == 400, "javascript: is rejected")
        status, _, _ = request("GET", "/open")
        check(status == 400, "missing url -> 400")

        status, _, _ = request("GET", "/open?url=" + quote("https://deny.example/", safe=""))
        check(status == 500, "a failing ShellExecute is reported as 500")
        drain_open_calls(server, 1)

        # A request split across packets must still be answered.
        import socket

        sock = socket.create_connection(("127.0.0.1", PORT), timeout=5)
        sock.sendall(b"GET /hea")
        time.sleep(0.05)
        sock.sendall(b"lth HTTP/1.1\r\nHost: x\r\n\r\n")
        raw = b""
        while chunk := sock.recv(4096):
            raw += chunk
        sock.close()
        check(raw.startswith(b"HTTP/1.1 200 OK") and raw.endswith(b"byazen"),
              "a request split over two packets is handled")

    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        shutil.rmtree(workdir, ignore_errors=True)

    print()
    if failures:
        print(f"{len(failures)} check(s) failed")
        return 1
    print("all HTTP checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
