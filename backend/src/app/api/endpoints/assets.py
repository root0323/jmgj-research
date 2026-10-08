import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.automatic_terrain import TERRAIN
from app.services.geospatial_assets import AssetError

router = APIRouter()


class Location(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


@router.post("/terrain")
def prepare_terrain(location: Location):
    # Disk writes are available only in the authenticated local desktop worker.
    # A public web deployment must never turn map clicks into server downloads.
    if not os.environ.get("JMGJ_DESKTOP_TOKEN"):
        raise HTTPException(404)
    try:
        return TERRAIN.request(location.latitude, location.longitude, start=True)
    except AssetError as error:
        return {"enabled": True, "state": "error", "message": str(error)}
