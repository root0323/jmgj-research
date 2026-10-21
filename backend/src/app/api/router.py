from fastapi import APIRouter
from app.api.endpoints import difficulty, geocode, health, assets

api_router = APIRouter()

api_router.include_router(geocode.router, prefix="/geocode", tags=["geocode"])
api_router.include_router(difficulty.router, prefix="/difficulty", tags=["difficulty"])
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(assets.router, prefix="/assets", tags=["assets"])
