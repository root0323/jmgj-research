"""Local-only annual download screen: python -m app.scripts.download_black_marble."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading

from app.local_config import save_settings
from app.services.annual_black_marble import WorldDownload
from app.services.geospatial_assets import AssetError

HOST, PORT = "127.0.0.1", 3005
ORIGIN = f"http://{HOST}:{PORT}"
CSRF = secrets.token_urlsafe(32)
LOCK = threading.Lock()
STOP = threading.Event()
JOB = {"running": False, "phase": "ready", "message": "NASA 토큰을 입력하면 전체 다운로드를 시작합니다."}
WORLD = None

HTML = """<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>전 세계 Black Marble 다운로드</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e1421;color:#eef3ff;font:16px/1.6 system-ui,sans-serif}main{max-width:820px;margin:40px auto;padding:0 24px 48px}h1{font-size:27px}h2{font-size:19px;margin:0 0 12px}section{border:1px solid #34405b;border-radius:14px;background:#182134;padding:24px;margin:20px 0}a{color:#b6d1ff}p{color:#c6d0e6}label{display:block;margin:18px 0 8px}input{width:100%;padding:12px;border:1px solid #53617d;border-radius:7px;background:#0e1421;color:white;font:inherit}button{padding:11px 17px;border:0;border-radius:7px;background:#a9c7ff;color:#0b1e3b;font:inherit;cursor:pointer;margin:18px 10px 0 0}button:disabled{opacity:.5;cursor:default}#stop{background:#39475f;color:#eef3ff}progress{width:100%;height:22px;accent-color:#a9c7ff}#message{white-space:pre-wrap;min-height:3em}#directory{overflow-wrap:anywhere;font-size:14px}small{color:#aebbd4}.big{font-size:24px;font-weight:600}
</style><main><h1>전 세계 Black Marble 다운로드</h1><p>NOAA-20 · VJ146A4 Version 2 · 2025년 연별 자료</p>
<section><h2>다운로드 진행</h2><div id="count" class="big">목록 확인 중…</div><progress id="progress" value="0" max="540"></progress><p id="sizes"></p><p id="message" role="status"></p><p>저장 위치</p><div id="directory"></div><small>OneDrive 밖의 이 컴퓨터 전용 저장공간에 원본과 압축 파일을 함께 보관합니다. 필요한 항목의 원본 해상도·값을 유지하고 파일마다 전체 값을 검증합니다.</small></section>
<section><h2>NASA 다운로드 인증</h2><p>1. <a href="https://urs.earthdata.nasa.gov/" target="_blank" rel="noopener noreferrer">Earthdata 로그인·토큰 발급</a>에서 로그인합니다.<br>2. 상단의 Generate Token → 페이지 아래의 Generate Token을 누릅니다.<br>3. Show Token으로 확인한 토큰을 복사해 아래에 붙여 넣습니다.</p>
<form id="download"><label for="token">NASA Earthdata 다운로드 토큰</label><input id="token" type="password" autocomplete="off" spellcheck="false" required><small>토큰은 이번 실행의 메모리에서만 사용합니다. 파일·로그·GitHub에 저장하지 않습니다.</small><br><button id="start" type="submit">전체 다운로드 시작·이어받기</button><button id="stop" type="button" disabled>현재 파일 처리 후 중단</button></form></section>
<p>기존 파일은 재사용하며 다른 연도는 내려받지 않습니다. 다운로드 중에는 컴퓨터를 켜 두세요. 창을 닫아도 이 컴퓨터의 다운로드 프로세스는 계속 실행됩니다.</p></main><script>
const csrf='__CSRF__';const gb=n=>(n/1e9).toFixed(2)+' GB';
async function send(path,data){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Download-CSRF':csrf},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.message);return result}
async function refresh(){try{const response=await fetch('/status',{cache:'no-store'});if(!response.ok)throw Error('상태 조회 실패');const data=await response.json(),s=data.assets;document.querySelector('#count').textContent=s.completed+' / '+s.total+' 파일 검증 완료';document.querySelector('#progress').value=s.completed;document.querySelector('#progress').max=s.total;document.querySelector('#sizes').textContent='전체 원본 '+gb(s.sourceBytes)+' · 완료된 압축 자료 '+gb(s.compactBytes)+' · 디스크 여유 '+gb(s.freeBytes);document.querySelector('#message').textContent=data.job.message;document.querySelector('#directory').textContent=s.directory;document.querySelector('#start').disabled=data.job.running||s.completed===s.total;document.querySelector('#stop').disabled=!data.job.running;document.querySelector('#token').disabled=data.job.running}catch{document.querySelector('#message').textContent='다운로드 서버 연결이 끊겼습니다. 서버를 다시 실행하면 완료된 파일부터 이어받을 수 있습니다.'}}
document.querySelector('#download').onsubmit=async event=>{event.preventDefault();const input=document.querySelector('#token');const data={token:input.value.trim()};input.value='';try{await send('/start',data);await refresh()}catch(error){document.querySelector('#message').textContent=error.message}finally{data.token=''}};
document.querySelector('#stop').onclick=async()=>{try{await send('/stop',{});await refresh()}catch(error){document.querySelector('#message').textContent=error.message}};
refresh();setInterval(refresh,2000);
</script></html>"""


def run_job(data):
    def progress(message):
        with LOCK:
            JOB["message"] = message
    try:
        completed = WORLD.run(data["token"], STOP, progress)
        with LOCK:
            JOB.update(phase="complete" if completed else "stopped",
                       message="전 세계 540개 원본 다운로드·압축·검증을 완료했습니다." if completed else JOB["message"])
    except Exception as error:
        with LOCK:
            JOB.update(phase="error", message=str(error) if isinstance(error, AssetError) else
                       "다운로드·검증 중 오류로 중단했습니다. 완료된 파일은 유지됩니다. 저장 공간·네트워크·자료 형식을 확인해 주세요.")
    finally:
        data.clear()
        with LOCK:
            JOB["running"] = False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, content, content_type="application/json; charset=utf-8"):
        body = content.encode("utf-8") if isinstance(content, str) else json.dumps(content, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        for name, value in {"Content-Type": content_type, "Cache-Control": "no-store",
                            "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                            "Referrer-Policy": "no-referrer", "Content-Length": str(len(body))}.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get("Host") == f"{HOST}:{PORT}"

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {"message": "로컬 주소로 접속해 주세요."})
        if self.path == "/":
            return self.respond(200, HTML.replace("__CSRF__", CSRF), "text/html; charset=utf-8")
        if self.path == "/status":
            with LOCK:
                job = JOB.copy()
            return self.respond(200, {"assets": WORLD.status(), "job": job})
        self.respond(404, {"message": "없는 페이지입니다."})

    def do_POST(self):
        if (not self.valid_host() or self.headers.get("Origin") != ORIGIN or
                not hmac.compare_digest(self.headers.get("X-Download-CSRF", ""), CSRF) or
                self.headers.get("Content-Type") != "application/json"):
            # Drain only a bounded body before closing. On Windows closing
            # with unread POST bytes can reset the socket instead of returning
            # the intended 403 response. No rejected input is used or logged.
            timeout = self.connection.gettimeout()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if 0 < length <= 16384:
                    self.connection.settimeout(1)
                    self.rfile.read(length)
            except (ValueError, OSError):
                pass
            finally:
                self.connection.settimeout(timeout)
            return self.respond(403, {"message": "로컬 다운로드 화면에서 다시 시도해 주세요."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16384:
                raise ValueError()
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError()
            if self.path == "/stop" and not data:
                STOP.set()
                with LOCK:
                    if JOB["running"]:
                        JOB["message"] = "현재 파일 처리를 마친 뒤 중단합니다…"
                return self.respond(202, {"ok": True})
            if self.path == "/start":
                token = data.get("token")
                if set(data) != {"token"} or not isinstance(token, str) or not token or len(token) > 8192 or any(ord(c) <= 32 or ord(c) > 126 for c in token):
                    raise ValueError()
                with LOCK:
                    if JOB["running"]:
                        return self.respond(409, {"message": "이미 다운로드 중입니다."})
                    STOP.clear()
                    JOB.update(running=True, phase="running", message="NASA 자료 다운로드를 시작합니다…")
                threading.Thread(target=run_job, args=(data,), daemon=True).start()
                return self.respond(202, {"ok": True})
        except (ValueError, TypeError):
            return self.respond(400, {"message": "입력 값을 확인해 주세요."})
        self.respond(404, {"message": "없는 요청입니다."})


def main():
    global WORLD
    parser = argparse.ArgumentParser(description="Local-only world Black Marble download screen.")
    parser.add_argument("--seed", type=Path, help="Reuse exact known H5 files in this existing folder.")
    args = parser.parse_args()
    WORLD = WorldDownload()
    if args.seed:
        WORLD.seed(args.seed.resolve(strict=True))
    save_settings({"BLACK_MARBLE_GLOBAL_DIR": str(WORLD.root)})
    print(f"Annual Black Marble download: {ORIGIN}", flush=True)
    print(json.dumps(WORLD.status(), ensure_ascii=True), flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
