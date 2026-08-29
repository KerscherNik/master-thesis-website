#!/usr/bin/env python3
"""Static file server with HTTP Range support, mirroring GitHub Pages.

python -m http.server has no Range handling; Chromium suspends media
downloads and a suspended video on a range-less server never becomes
seekable. Tests (and local previews) must behave like production, so this
thin handler adds single-range GET support.

Usage: python3 tests/server.py [port] [directory]
"""
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.range = None
        header = self.headers.get("Range")
        if header:
            m = re.match(r"bytes=(\d*)-(\d*)$", header.strip())
            if m and (m.group(1) or m.group(2)):
                self.range = (m.group(1), m.group(2))
        if not self.range:
            return super().send_head()

        path = self.translate_path(self.path)
        p = Path(path)
        if not p.is_file():
            return super().send_head()
        size = p.stat().st_size
        start_s, end_s = self.range
        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:  # suffix range: last N bytes
            start = max(0, size - int(end_s))
            end = size - 1
        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        end = min(end, size - 1)

        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "_range_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            chunk = source.read(min(65536, left))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)

    def guess_type(self, path):
        if str(path).endswith(".mp4"):
            return "video/mp4"
        return super().guess_type(path)

    def log_message(self, *args):
        pass  # keep test output readable


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    directory = sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent.parent)
    handler = partial(RangeHandler, directory=directory)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"range server on http://127.0.0.1:{port} serving {directory}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
