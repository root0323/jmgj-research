from pathlib import Path
from typing import Any

from fastapi import APIRouter
from app.local_config import setting
from app.services.geospatial_assets import cached_status
from app.api.endpoints.geocode import get_kakao_proxy_base


router = APIRouter()


def get_asset_status(path_env: str, url_env: str) -> dict[str, Any]:
    path_value = setting(path_env).strip()
    url_configured = bool(setting(url_env).strip())

    if not path_value:
        return {
            "configured": False,
            "exists": False,
            "sizeBytes": None,
            "urlConfigured": url_configured,
        }

    path = Path(path_value)
    exists = path.exists() and path.is_file()
    return {
        "configured": True,
        "exists": exists,
        "sizeBytes": path.stat().st_size if exists else None,
        "urlConfigured": url_configured,
    }


@router.get("")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "providers": {"kakaoKeyConfigured": bool(setting("KAKAO_REST_API_KEY")),
                      "kakaoProxyConfigured": bool(get_kakao_proxy_base()),
                      "vworldKeyConfigured": bool(setting("VWORLD_API_KEY"))},
        "cachedGeospatial": cached_status(),
        "assets": {
            "blackMarble": get_asset_status(
                "BLACK_MARBLE_H5_PATH",
                "BLACK_MARBLE_H5_URL",
            ),
            "dem": get_asset_status(
                "DEM_RASTER_PATH",
                "DEM_RASTER_URL",
            ),
        },
    }
