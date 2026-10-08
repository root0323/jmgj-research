import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.desktop_security import DesktopAccessMiddleware


class DesktopSecurityTests(unittest.TestCase):
    def client(self, token):
        with patch.dict(os.environ, {"JMGJ_DESKTOP_TOKEN": token}):
            app = FastAPI()
            app.add_middleware(DesktopAccessMiddleware)
            @app.get('/test')
            def endpoint():
                return {"ok": True}
            client = TestClient(app)
            client.get('/test')  # Materialize middleware under this environment.
            return client

    def test_desktop_worker_requires_rotating_launch_token(self):
        client = self.client('a' * 64)
        self.assertEqual(client.get('/test').status_code, 403)
        self.assertEqual(client.get('/test', headers={'x-jmgj-desktop-token': 'b' * 64}).status_code, 403)
        self.assertEqual(client.get('/test', headers={'x-jmgj-desktop-token': 'a' * 64}).status_code, 200)

    def test_web_mode_remains_available_without_desktop_token(self):
        self.assertEqual(self.client('').get('/test').json(), {"ok": True})
