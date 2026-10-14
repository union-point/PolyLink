#!/usr/bin/env python3
"""Local static development server; not an API backend."""
import argparse
import functools
import http.server
from pathlib import Path


class DevelopmentHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Keep changes to imported modules visible during manual browser verification.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--bind', default='127.0.0.1')
    args = parser.parse_args()
    handler = functools.partial(DevelopmentHandler, directory=str(Path(__file__).resolve().parent))
    with http.server.ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f'Static server: http://{args.bind}:{args.port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
