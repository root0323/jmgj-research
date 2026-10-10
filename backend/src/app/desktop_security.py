"""Private local desktop worker; ordinary web deployments remain unchanged."""
import hmac
import os

from starlette.responses import JSONResponse


class DesktopAccessMiddleware:
    def __init__(self, app):
        self.app = app
        self.token = os.environ.get("JMGJ_DESKTOP_TOKEN", "")

    async def __call__(self, scope, receive, send):
        if self.token and scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            supplied = headers.get(b"x-jmgj-desktop-token", b"")
            if not hmac.compare_digest(supplied, self.token.encode("ascii")):
                await JSONResponse({"error": "Desktop session required"}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)
