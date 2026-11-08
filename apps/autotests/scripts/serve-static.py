"""Loopback-only static test server with room for parallel browser ESM loads."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class LocalStaticServer(ThreadingHTTPServer):
    # The system Python CLI uses a backlog of 5. Chromium opens multiple
    # connections while loading the module graph; do not turn this into a
    # model/test retry or relax any measurement assertion.
    request_queue_size = 128


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Use a non-privileged TCP port")
    root = Path(__file__).resolve().parents[3]
    with LocalStaticServer(("127.0.0.1", args.port),
                           partial(SimpleHTTPRequestHandler, directory=str(root))) as server:
        server.serve_forever()
