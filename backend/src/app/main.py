from app.local_config import setting

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.desktop_security import DesktopAccessMiddleware


from app.api.router import api_router

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://jmgj-frontend.onrender.com",
]


def get_allowed_origins() -> list[str]:
    configured = setting("FRONTEND_ORIGINS")
    if not configured:
        return DEFAULT_ALLOWED_ORIGINS

    return [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]


app = FastAPI()
app.add_middleware(DesktopAccessMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")
