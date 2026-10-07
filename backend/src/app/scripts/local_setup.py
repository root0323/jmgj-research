"""Run with PYTHONPATH=backend/src python -m app.scripts.local_setup.

Deliberately separate from the deployable API: operator secrets and downloads
can only be managed on this computer, with Host/Origin and CSRF validation.
"""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import threading

from app.local_config import save_settings, setting
from app.services.geospatial_assets import prepare_region, cached_status, AssetError

HOST = "127.0.0.1"
PORT = 3004
ORIGIN = f"http://{HOST}:{PORT}"
CSRF = secrets.token_urlsafe(32)
LOCK = threading.Lock()
JOB = {"running": False, "message": "준비할 장소를 선택해 주세요."}
ALLOWED = {"KAKAO_REST_API_KEY", "VWORLD_API_KEY", "VWORLD_API_REFERER"}

HTML = """<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>연구 데이터 연결 설정</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e1421;color:#eef3ff;font:15px/1.6 system-ui,sans-serif}main{max-width:850px;margin:36px auto;padding:0 24px 48px}h1{font-size:26px}h2{font-size:19px;margin:0 0 12px}section{border:1px solid #34405b;border-radius:14px;background:#182134;padding:22px;margin:18px 0}label{display:block;margin:14px 0 5px}input{width:100%;padding:10px;border:1px solid #53617d;border-radius:7px;background:#0e1421;color:white;font:inherit}button{padding:10px 16px;border:0;border-radius:7px;background:#a9c7ff;color:#0b1e3b;font:inherit;cursor:pointer;margin:16px 8px 0 0}button:disabled{opacity:.5;cursor:wait}a{color:#b6d1ff}p{margin:8px 0;color:#c6d0e6}.row{display:flex;gap:16px}.row>div{flex:1}#status{white-space:pre-wrap}small{color:#aebbd4}#saved{color:#b7e4ba}
</style><main><h1>연구 데이터 연결 설정</h1><p>이 컴퓨터에서 실행 중인 연구 웹의 외부 자료를 연결합니다.</p>
<section><h2>장소 검색 API</h2><p><a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener noreferrer">카카오 앱·REST API 키 발급</a> · <a href="https://www.vworld.kr/dev/v4dv_apiuser_s001.do" target="_blank" rel="noopener noreferrer">VWorld 인증키 발급</a></p>
<small>카카오는 앱에서 카카오맵 사용 설정도 필요합니다. VWorld는 발급 시 등록한 사용 URL을 함께 입력하세요. 빈 칸은 기존 설정을 유지합니다.</small>
<form id="keys"><label for="kakao">카카오 REST API 키</label><input id="kakao" name="KAKAO_REST_API_KEY" type="password" autocomplete="off">
<label for="vworld">VWorld API 키</label><input id="vworld" name="VWORLD_API_KEY" type="password" autocomplete="off">
<label for="referer">VWorld 등록 URL</label><input id="referer" name="VWORLD_API_REFERER" placeholder="http://127.0.0.1:3001" autocomplete="off">
<button>이 컴퓨터에 저장</button><p id="saved" role="status"></p></form><small>키는 이 컴퓨터의 backend/src/app/.env에 저장되며 GitHub에 올리지 않습니다. 저장 여부는 인증 성공 여부와 다릅니다.</small></section>
<section><h2>지형·야간 인공광 자료</h2><p>장소 주변 30km의 Copernicus GLO-90 지형과 NASA Black Marble 월별 자료를 저장해 재사용합니다. 장소가 저장 영역을 벗어나면 해당 장소의 자료를 다시 준비하세요.</p>
<p><a href="https://urs.earthdata.nasa.gov/users/new" target="_blank" rel="noopener noreferrer">NASA Earthdata 계정 만들기</a> · <a href="https://urs.earthdata.nasa.gov/" target="_blank" rel="noopener noreferrer">Earthdata 로그인·토큰 발급</a></p>
<small>Earthdata 로그인 후 Generate Token → Generate Token → Show Token 순으로 토큰을 확인하세요.</small>
<form id="assets"><div class="row"><div><label for="latitude">위도</label><input id="latitude" name="latitude" type="number" step="any" min="-84.99" max="84.99" value="37.5665" required></div><div><label for="longitude">경도</label><input id="longitude" name="longitude" type="number" step="any" min="-179.99" max="179.99" value="126.978" required></div></div>
<label for="month">Black Marble 기준 월 (비워 두면 최신 공개 자료)</label><input id="month" name="month" type="month">
<label for="token">NASA Earthdata 다운로드 토큰</label><input id="token" name="token" type="password" autocomplete="off">
<small>토큰은 이번 다운로드에만 사용하고 파일에 저장하지 않습니다. Black Marble은 실시간 관측값이 아닌 월별 위성 합성 자료입니다. 지형만 준비할 때는 토큰이 필요 없습니다.</small><br>
<button type="submit">두 자료 준비</button><button type="button" id="terrain">지형만 준비</button></form><p id="status" role="status"></p></section>
<section><h2>현재 연결 상태</h2><div id="connections"></div><p><a href="http://127.0.0.1:3001/">연구 웹 열기</a> · <a href="http://127.0.0.1:3005/">전 세계 연별 Black Marble 다운로드</a></p><small>자료와 키가 아직 없는 항목은 준비 완료로 표시하지 않습니다. 자료의 출처·크레딧은 연구 웹의 설정 → 출처에서 확인할 수 있습니다.</small></section>
</main><script>
const csrf='__CSRF__';
async function send(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Setup-CSRF':csrf},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Error(body.message);return body}
document.querySelector('#keys').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));try{await send('/keys',data);e.target.reset();document.querySelector('#saved').textContent='저장했습니다. 연구 웹에 바로 적용됩니다.';await refresh()}catch(err){document.querySelector('#saved').textContent=err.message}};
async function prepare(terrainOnly){const form=document.querySelector('#assets');if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));data.latitude=Number(data.latitude);data.longitude=Number(data.longitude);data.terrainOnly=terrainOnly;try{await send('/prepare',data);document.querySelector('#token').value='';await refresh()}catch(err){document.querySelector('#status').textContent=err.message}}
document.querySelector('#assets').onsubmit=e=>{e.preventDefault();prepare(false)};document.querySelector('#terrain').onclick=()=>prepare(true);
async function refresh(){try{const data=await (await fetch('/status',{cache:'no-store'})).json();document.querySelector('#status').textContent=data.job.message;document.querySelectorAll('#assets button').forEach(b=>b.disabled=data.job.running);const lines=['카카오 키: '+(data.kakao?'저장됨 · 실제 조회 확인 필요':'미설정'),'VWorld 키: '+(data.vworld?'저장됨 · 실제 조회 확인 필요':'미설정')];data.assets.regions.forEach(r=>lines.push('영역 '+r.bounds.map(n=>n.toFixed(3)).join(', ')+' / 지형 '+(r.dem?'준비됨':'없음')+' / Black Marble '+(r.blackMarble?(r.year?r.year+'년 연별':r.month)+' 준비됨':'미준비')));document.querySelector('#connections').textContent=lines.join(' · ')}catch{document.querySelector('#status').textContent='로컬 설정 서버 연결을 확인해 주세요.'}}
refresh();setInterval(refresh,2000);
</script></html>"""


def run_job(data):
    def progress(message):
        with LOCK:
            JOB["message"] = message
    try:
        result = prepare_region(float(data["latitude"]), float(data["longitude"]), str(data.get("token", "")),
                                data.get("month") or None, bool(data.get("terrainOnly")), progress)
        progress("자료 준비 완료. " + (f"Black Marble 기준 월: {result['month']}" if result["blackMarble"] else "지형 저장됨 · Black Marble은 아직 미준비"))
    except Exception as error:
        # Never echo request/library exception messages containing auth URLs.
        progress(str(error) if isinstance(error, AssetError) else "자료 준비 실패. 네트워크·자료 형식·저장 공간을 확인해 주세요.")
    finally:
        data.clear()
        with LOCK:
            JOB["running"] = False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, content, content_type="application/json; charset=utf-8"):
        body = content.encode() if isinstance(content, str) else json.dumps(content, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Length", str(len(body)))
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
            return self.respond(200, {"kakao": bool(setting("KAKAO_REST_API_KEY")), "vworld": bool(setting("VWORLD_API_KEY")), "assets": cached_status(), "job": JOB.copy()})
        self.respond(404, {"message": "없는 페이지입니다."})

    def do_POST(self):
        if not self.valid_host() or self.headers.get("Origin") != ORIGIN or not hmac.compare_digest(self.headers.get("X-Setup-CSRF", ""), CSRF) or self.headers.get("Content-Type") != "application/json":
            return self.respond(403, {"message": "로컬 설정 화면에서 다시 시도해 주세요."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16384:
                raise ValueError()
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError()
            if self.path == "/keys":
                if set(data) - ALLOWED or not all(isinstance(v, str) for v in data.values()):
                    raise ValueError()
                save_settings({k: v for k, v in data.items() if v.strip()})
                return self.respond(200, {"ok": True})
            if self.path == "/prepare":
                from app.services.geospatial_assets import region_bounds
                region_bounds(float(data["latitude"]), float(data["longitude"]))
                if any(c in str(data.get("token", "")) for c in "\r\n\x00"):
                    raise ValueError()
                with LOCK:
                    if JOB["running"]:
                        return self.respond(409, {"message": "자료를 준비 중입니다."})
                    JOB.update(running=True, message="자료 준비를 시작합니다…")
                threading.Thread(target=run_job, args=(data,), daemon=True).start()
                return self.respond(202, {"ok": True})
        except (ValueError, KeyError, TypeError):
            return self.respond(400, {"message": "입력 값을 확인해 주세요."})
        self.respond(404, {"message": "없는 요청입니다."})


if __name__ == "__main__":
    print(f"Local setup: {ORIGIN}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
