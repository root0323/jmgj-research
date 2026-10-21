"""Local world DEM download screen: python -m app.scripts.download_world_dem."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading

from app.local_config import save_settings
from app.services.geospatial_assets import AssetError
from app.services.world_dem import WorldDEM

HOST, PORT = "127.0.0.1", 3006
ORIGIN = f"http://{HOST}:{PORT}"
CSRF = secrets.token_urlsafe(32)
LOCK = threading.Lock()
STOP = threading.Event()
JOB = {"running": False, "phase": "ready", "message": "전 세계 DEM 다운로드 준비 완료."}
WORLD = None

HTML = """<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>전 세계 DEM 다운로드</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e1421;color:#eef3ff;font:16px/1.6 system-ui,sans-serif}main{max-width:820px;margin:40px auto;padding:0 24px 48px}h1{font-size:27px}section{border:1px solid #34405b;border-radius:14px;background:#182134;padding:24px;margin:20px 0}a{color:#b6d1ff}p{color:#c6d0e6}button{padding:11px 17px;border:0;border-radius:7px;background:#a9c7ff;color:#0b1e3b;font:inherit;cursor:pointer;margin:18px 10px 0 0}button:disabled{opacity:.5;cursor:default}#stop{background:#39475f;color:#eef3ff}progress{width:100%;height:22px;accent-color:#a9c7ff}#message{white-space:pre-wrap;min-height:3em}#directory{overflow-wrap:anywhere;font-size:14px}small{color:#aebbd4}.big{font-size:24px;font-weight:600}
</style><main><h1>전 세계 DEM 다운로드</h1><p>Copernicus GLO-90 · 약 90m 지표면 높이(DSM) · 공개 고도 타일 전체</p>
<section><div id="count" class="big">목록 확인 중…</div><progress id="progress" value="0" max="1"></progress><p id="sizes"></p><p id="message" role="status"></p><p>저장 위치</p><div id="directory"></div><small>약 90m 원본 격자와 고도 값을 유지하며 무손실 압축합니다. 모든 고도 값·마스크·좌표를 원본과 비교한 뒤 압축본으로 교체합니다. 이미 받은 파일부터 변환하며 더 작아지지 않는 파일은 원본으로 보관합니다.</small><br><button id="start">다운로드·압축 시작·이어받기</button><button id="stop" disabled>진행 중인 파일 처리 후 중단</button></section>
<p>로그인이나 API 토큰은 필요하지 않습니다. 완료 파일은 다시 받지 않고 검증해 재사용합니다. 서버에서 받는 원본 전송량은 같으며, 디스크에 남기는 용량이 줄어듭니다. 최종 압축 용량은 전체 처리 후 확정됩니다. 컴퓨터와 인터넷 연결을 유지해 주세요.</p><p><a href="http://127.0.0.1:3005/" target="_blank" rel="noopener noreferrer">Black Marble 진행 화면</a> · <a href="https://registry.opendata.aws/copernicus-dem/" target="_blank" rel="noopener noreferrer">자료 안내</a></p></main><script>
const csrf='__CSRF__';const gb=n=>(n/1e9).toFixed(2)+' GB';
async function send(path){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Download-CSRF':csrf},body:'{}'});const result=await response.json();if(!response.ok)throw Error(result.message);await refresh()}
async function refresh(){try{const response=await fetch('/status',{cache:'no-store'});if(!response.ok)throw Error('상태 조회 실패');const data=await response.json(),s=data.assets;document.querySelector('#count').textContent='다운로드 검증 '+s.completed.toLocaleString()+' / '+s.total.toLocaleString()+' · 압축 처리 '+s.optimized.toLocaleString();document.querySelector('#progress').value=s.optimized;document.querySelector('#progress').max=s.total;document.querySelector('#sizes').textContent='원본 전체 '+gb(s.sourceBytes)+' · 현재 저장 '+gb(s.completedBytes)+' · 절약 '+gb(s.savedBytes)+' · 남은 다운로드 '+gb(s.remainingSourceBytes)+' · 디스크 여유 '+gb(s.freeBytes);document.querySelector('#message').textContent=data.job.message;document.querySelector('#directory').textContent=s.directory;document.querySelector('#start').disabled=data.job.running||s.optimized===s.total;document.querySelector('#stop').disabled=!data.job.running}catch{document.querySelector('#message').textContent='다운로드 서버 연결이 끊겼습니다. 서버를 다시 실행하면 완료된 파일부터 이어받을 수 있습니다.'}}
for(const action of ['start','stop'])document.querySelector('#'+action).onclick=async()=>{try{await send('/'+action)}catch(error){document.querySelector('#message').textContent=error.message}};
refresh();setInterval(refresh,2000);
</script></html>"""


def run_job():
    def progress(message):
        with LOCK:
            JOB["message"] = message
    try:
        completed = WORLD.run(STOP, progress)
        with LOCK:
            JOB.update(phase="complete" if completed else "stopped",
                       message="전 세계 DEM 다운로드·무손실 압축·검증 완료." if completed else JOB["message"])
    except Exception as error:
        with LOCK:
            JOB.update(phase="error", message=str(error) if isinstance(error, AssetError) else
                       "DEM 다운로드·검증 중 오류로 중단했습니다. 완료 파일은 유지됩니다. 네트워크·저장 공간·자료 형식을 확인해 주세요.")
    finally:
        with LOCK:
            JOB["running"] = False


def start_job():
    with LOCK:
        if JOB["running"]:
            return False
        STOP.clear()
        JOB.update(running=True, phase="running", message="기존 DEM 무손실 압축 후 다운로드를 이어갑니다…")
    threading.Thread(target=run_job, daemon=True).start()
    return True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, content, content_type="application/json; charset=utf-8"):
        body = content.encode("utf-8") if isinstance(content, str) else json.dumps(content, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        for name, value in {"Content-Type": content_type, "Cache-Control": "no-store", "Content-Length": str(len(body)),
                            "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer"}.items():
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
            timeout = self.connection.gettimeout()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if 0 < length <= 32:
                    self.connection.settimeout(1)
                    self.rfile.read(length)
            except (ValueError, OSError):
                pass
            finally:
                self.connection.settimeout(timeout)
            return self.respond(403, {"message": "로컬 다운로드 화면에서 다시 시도해 주세요."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 32 or json.loads(self.rfile.read(length)) != {}:
                raise ValueError()
        except (TypeError, ValueError):
            return self.respond(400, {"message": "입력 값을 확인해 주세요."})
        if self.path == "/start":
            started = start_job()
            return self.respond(202 if started else 409, {"message": "다운로드 시작." if started else "이미 다운로드 중입니다."})
        if self.path == "/stop":
            STOP.set()
            return self.respond(202, {"message": "진행 중인 파일 처리 후 중단합니다."})
        self.respond(404, {"message": "없는 요청입니다."})


def main():
    global WORLD
    parser = argparse.ArgumentParser(description="Download native world Copernicus GLO-90 tiles locally.")
    parser.add_argument("--manifest", type=Path, help="Previously frozen official metadata JSON.")
    parser.add_argument("--start", action="store_true", help="Start the user-authorized full download immediately.")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8")) if args.manifest else None
    WORLD = WorldDEM(manifest=manifest, progress=lambda message: print(message, flush=True))
    save_settings({"DEM_GLOBAL_DIR": str(WORLD.root)})
    print(f"World DEM download: {ORIGIN}", flush=True)
    print(json.dumps(WORLD.status(), ensure_ascii=True), flush=True)
    if args.start:
        start_job()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
