"""Dependency-free, loopback-only prototype server. Serves no workspace secrets."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
import shutil
import subprocess
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--static-only',action='store_true',help='只启动静态网页')
    parser.add_argument('--team-hub', action='store_true', help='预览已准备的Team Hub接入包')
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    if not args.team_hub and not args.static_only:
        candidates=[project/'prototype/.runtime/node22/node'] if (project/'prototype/.runtime/node22/node').exists() else sorted((project/'tmp/runtime-node22').glob('node-v22.*/bin/node'))
        node=str(candidates[-1]) if candidates else shutil.which('node')
        if node:
            env={**os.environ,'PORT':str(args.port)}
            try:raise SystemExit(subprocess.call([node,str(Path(__file__).resolve().parent/'web-ai-server.mjs')],env=env))
            except KeyboardInterrupt:raise SystemExit(0)
    root = project / 'output/持仓知见-TeamHub接入包-当前/dist' if args.team_hub else Path(__file__).resolve().parent / 'dist'
    if not (root / 'index.html').is_file():
        parser.error('网页文件不存在；请先准备接入包。')
    mimetypes.add_type('text/javascript', '.mjs')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(root)))
    print(f'持仓知见本地雏形：http://127.0.0.1:{args.port}', flush=True)
    print('仅本机可访问；Control+C 停止。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止。')
    finally:
        server.server_close()
