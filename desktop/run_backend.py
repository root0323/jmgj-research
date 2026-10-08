"""Frozen worker entry point. No globally installed Python is needed."""
import os
import re
import threading
import sys

import uvicorn
from app.main import app


if __name__ == "__main__":
    if not re.fullmatch(r"[a-f0-9]{64}", os.environ.get("JMGJ_DESKTOP_TOKEN", "")):
        raise SystemExit("Desktop launcher required")
    config = uvicorn.Config(app, host="127.0.0.1", port=int(os.environ["JMGJ_BACKEND_PORT"]),
                            access_log=False, log_level="warning")
    server = uvicorn.Server(config)

    def watch_parent():
        # The Electron parent keeps stdin open. A crash/exit releases the worker.
        if sys.stdin is not None:
            sys.stdin.buffer.read()
        server.should_exit = True

    threading.Thread(target=watch_parent, daemon=True).start()
    server.run()
