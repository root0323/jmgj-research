import {
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { completePlaceQuery, geocodeLocations, reverseGeocodeLocation, suggestLocations } from "./geo";
import { currentLocation } from "@/lib/geolocation";
import { createPortal } from "react-dom";
import styles from "./SkyViewer.module.css";
import type { EngineStatus, GeocodeResult, LocationApplyState, ObserverLocation } from "./types";

const MAP_TILE_SIZE = 256;
const MAP_WIDTH = 520;
const MAP_HEIGHT = 360;
const MAP_MIN_ZOOM = 3;
const MAP_MAX_ZOOM = 18;

type MapDragState = {
  pointerId: number;
  x: number;
  y: number;
};

type LocationPickerProps = {
  status: EngineStatus;
  locationName: string;
  observerLocation: ObserverLocation;
  onApply: (location: ObserverLocation, name?: string) => boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function latLngToWorldPixel(
  latitude: number,
  longitude: number,
  zoom: number
) {
  const sinLatitude = Math.sin(
    (clamp(latitude, -85.05112878, 85.05112878) * Math.PI) / 180
  );
  const scale = MAP_TILE_SIZE * 2 ** zoom;

  return {
    x: ((longitude + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) *
      scale,
  };
}

function worldPixelToLatLng(x: number, y: number, zoom: number) {
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const mercatorY = 0.5 - y / scale;
  const latitude =
    90 - (360 * Math.atan(Math.exp(-mercatorY * 2 * Math.PI))) / Math.PI;

  return {
    latitude: clamp(latitude, -85.05112878, 85.05112878),
    longitude: ((longitude + 540) % 360) - 180,
  };
}

export function LocationPicker({
  status,
  locationName,
  observerLocation,
  onApply,
}: LocationPickerProps) {
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapMovedRef = useRef(false);
  const selectionRequestRef = useRef(0);
  const geoRequestRef = useRef(0);
  const [mapSearchMessage, setMapSearchMessage] = useState<string | null>(null);
  const [coordinateDraft, setCoordinateDraft] = useState({ latitude: observerLocation.latitude.toFixed(6), longitude: observerLocation.longitude.toFixed(6) });
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<{ query: string; results: GeocodeResult[] } | null>(null);
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const completedQuery = completePlaceQuery(mapSearchQuery);
  const [mapSelectionName, setMapSelectionName] = useState(locationName);
  const [mapSearchState, setMapSearchState] =
    useState<LocationApplyState>("idle");
  const [geoLocationState, setGeoLocationState] =
    useState<LocationApplyState>("idle");
  const [geoLocationMessage, setGeoLocationMessage] = useState<string | null>(
    null
  );
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState<ObserverLocation>(observerLocation);
  const [mapSelection, setMapSelection] =
    useState<ObserverLocation>(observerLocation);
  const [mapZoom, setMapZoom] = useState(13);
  const [mapDrag, setMapDrag] = useState<MapDragState | null>(null);

  useEffect(() => () => { selectionRequestRef.current += 1; geoRequestRef.current += 1; }, []);
  function selectCoordinates(location: ObserverLocation) {
    setMapSelection(location);
    setCoordinateDraft({ latitude: location.latitude.toFixed(6), longitude: location.longitude.toFixed(6) });
  }

  function closeLocationMap() {
    selectionRequestRef.current += 1;
    geoRequestRef.current += 1;
    setIsMapOpen(false);
  }

  useEffect(() => {
    const term = mapSearchQuery.trim();
    if (!isMapOpen || !showSuggestions || term.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void suggestLocations(term, controller.signal).then((results) => {
        if (!controller.signal.aborted) setSuggestions({ query: term, results });
      }).catch(() => { /* Full manual search remains available. */ });
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [isMapOpen, mapSearchQuery, showSuggestions]);

  const mapView = useMemo(() => {
    if (!isMapOpen) {
      return {
        tiles: [],
        marker: {
          x: MAP_WIDTH / 2,
          y: MAP_HEIGHT / 2,
        },
      };
    }

    const center = latLngToWorldPixel(
      mapCenter.latitude,
      mapCenter.longitude,
      mapZoom
    );
    const selection = latLngToWorldPixel(
      mapSelection.latitude,
      mapSelection.longitude,
      mapZoom
    );
    const zoomTileCount = 2 ** mapZoom;
    const firstTileX = Math.floor((center.x - MAP_WIDTH / 2) / MAP_TILE_SIZE);
    const lastTileX = Math.floor((center.x + MAP_WIDTH / 2) / MAP_TILE_SIZE);
    const firstTileY = Math.floor((center.y - MAP_HEIGHT / 2) / MAP_TILE_SIZE);
    const lastTileY = Math.floor((center.y + MAP_HEIGHT / 2) / MAP_TILE_SIZE);
    const tiles = [];

    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
        if (tileY < 0 || tileY >= zoomTileCount) continue;

        const wrappedTileX =
          ((tileX % zoomTileCount) + zoomTileCount) % zoomTileCount;
        tiles.push({
          key: `${mapZoom}-${tileX}-${tileY}`,
          left: tileX * MAP_TILE_SIZE - center.x + MAP_WIDTH / 2,
          top: tileY * MAP_TILE_SIZE - center.y + MAP_HEIGHT / 2,
          url: `https://tile.openstreetmap.org/${mapZoom}/${wrappedTileX}/${tileY}.png`,
        });
      }
    }

    return {
      tiles,
      marker: {
        x: selection.x - center.x + MAP_WIDTH / 2,
        y: selection.y - center.y + MAP_HEIGHT / 2,
      },
    };
  }, [isMapOpen, mapCenter, mapSelection, mapZoom]);

  useEffect(() => {
    if (!isMapOpen) return;

    const mapCanvas = mapCanvasRef.current;
    if (!mapCanvas) return;

    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const direction = event.deltaY < 0 ? 1 : -1;
      setMapZoom((currentZoom) =>
        clamp(currentZoom + direction, MAP_MIN_ZOOM, MAP_MAX_ZOOM)
      );
    };

    mapCanvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      mapCanvas.removeEventListener("wheel", handleWheel);
    };
  }, [isMapOpen]);

  function openLocationMap() {
    selectionRequestRef.current += 1;
    setMapCenter(observerLocation);
    selectCoordinates(observerLocation);
    setMapSelectionName(locationName);
    setMapSearchQuery("");
    setShowSuggestions(false);
    setSearchResults([]);
    setMapSearchState("idle");
    setMapSearchMessage(null);
    setGeoLocationState("idle");
    setGeoLocationMessage(null);
    setIsMapOpen(true);
  }

  async function updateMapSelection(
    location: ObserverLocation,
    fallbackName?: string
  ) {
    const request = ++selectionRequestRef.current;
    geoRequestRef.current += 1;
    setGeoLocationState("idle");
    setGeoLocationMessage(null);
    setMapSearchState("idle");
    setMapSearchMessage(null);
    setShowSuggestions(false);
    setSearchResults([]);
    selectCoordinates(location);
    setMapSelectionName(fallbackName ?? "주소 확인 중");

    const addressName = await reverseGeocodeLocation(location);
    if (request === selectionRequestRef.current) setMapSelectionName(addressName ?? fallbackName ?? "선택한 위치");
  }

  function pickMapLocation(
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    const center = latLngToWorldPixel(
      mapCenter.latitude,
      mapCenter.longitude,
      mapZoom
    );
    const selected = worldPixelToLatLng(
      center.x + event.clientX - rect.left - rect.width / 2,
      center.y + event.clientY - rect.top - rect.height / 2,
      mapZoom
    );

    void updateMapSelection(selected);
  }

  function handleMapPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    mapMovedRef.current = false;
    setMapDrag({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleMapPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!mapDrag || mapDrag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - mapDrag.x, event.clientY - mapDrag.y) > 2) {
      mapMovedRef.current = true;
    }

    const center = latLngToWorldPixel(
      mapCenter.latitude,
      mapCenter.longitude,
      mapZoom
    );
    const nextCenter = worldPixelToLatLng(
      center.x - (event.clientX - mapDrag.x),
      center.y - (event.clientY - mapDrag.y),
      mapZoom
    );

    setMapCenter(nextCenter);
    setMapDrag({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleMapPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (mapDrag && mapDrag.pointerId === event.pointerId) {
      setMapDrag(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleMapClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    if (mapMovedRef.current) {
      mapMovedRef.current = false;
      return;
    }
    pickMapLocation(event);
  }

  function handleMapZoom(nextZoom: number) {
    setMapZoom(clamp(nextZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM));
  }

  async function handleMapSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchMapPlace(mapSearchQuery.trim());
  }

  function chooseSearchResult(location: GeocodeResult) {
    selectionRequestRef.current += 1;
    geoRequestRef.current += 1;
    setGeoLocationState("idle");
    setGeoLocationMessage(null);
    setMapCenter(location);
    selectCoordinates(location);
    setMapSelectionName(location.name);
    setMapZoom((current) => Math.max(current, 15));
    setShowSuggestions(false);
    setMapSearchState("ok");
    setMapSearchMessage(null);
  }

  async function searchMapPlace(term: string) {
    if (geoLocationState === "loading") return;
    if (!term) {
      setMapSearchState("error");
      return;
    }

    setMapSearchState("loading");
    setShowSuggestions(false);
    setMapSearchMessage("장소를 검색하는 중입니다…");
    const request = ++selectionRequestRef.current;
    try {
      const results = await geocodeLocations(term);
      if (request !== selectionRequestRef.current) return;
      setSearchResults(results.slice(0, 8));
      const location = results[0];
      if (!location) { setMapSearchState("error"); setMapSearchMessage("검색 결과가 없습니다. 정식 장소명이나 주소를 입력하거나 지도·좌표로 선택하세요."); return; }
      chooseSearchResult(location);
    } catch (error) {
      if (request !== selectionRequestRef.current) return;
      setMapSearchState("error");
      setMapSearchMessage(error instanceof Error && error.name !== "TimeoutError" ? error.message : "장소 검색 시간이 초과됐습니다. 다시 검색하거나 지도·좌표로 선택하세요.");
    }
  }

  function handleMapSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setShowSuggestions(false); return; }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function applyMapLocation() {
    if (onApply(mapSelection, mapSelectionName)) {
      setMapSearchState("ok");
      closeLocationMap();
    } else {
      setMapSearchState("error");
    }
  }

  async function handleCurrentLocation() {
    const request = ++geoRequestRef.current;
    selectionRequestRef.current += 1;
    setGeoLocationState("loading");
    setShowSuggestions(false);
    setGeoLocationMessage("현재 위치를 확인하는 중입니다.");

    try {
        const nextLocation = await currentLocation(navigator.geolocation, window.isSecureContext);
        if (request !== geoRequestRef.current) return;
        setMapCenter(nextLocation);
        selectCoordinates(nextLocation);
        setMapSelectionName("현재 위치");
        setMapZoom((current) => Math.max(current, 15));

        if (onApply(nextLocation, "현재 위치")) {
          setGeoLocationState("ok");
          setGeoLocationMessage("현재 위치를 관측 위치로 적용했습니다.");
          closeLocationMap();
          return;
        }

        setGeoLocationState("error");
        setGeoLocationMessage("현재 위치를 엔진에 적용하지 못했습니다.");
    } catch (error) {
        if (request !== geoRequestRef.current) return;
        setGeoLocationState("error");
        setGeoLocationMessage(error instanceof Error ? error.message : "현재 위치를 확인하지 못했습니다. 지도·좌표로 선택하세요.");
    }
  }

  function applyCoordinateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const latitude = Number(coordinateDraft.latitude);
    const longitude = Number(coordinateDraft.longitude);
    if (!coordinateDraft.latitude.trim() || !coordinateDraft.longitude.trim() || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      setMapSearchState("error"); setMapSearchMessage("위도는 -90~90, 경도는 -180~180 범위로 입력하세요."); return;
    }
    const location = { latitude, longitude };
    setMapCenter(location);
    setMapSearchState("idle"); setMapSearchMessage(null);
    void updateMapSelection(location, "입력한 좌표");
  }

  return (
    <>
      <div className={styles.location}>
        <div className={styles.locationName}>
          <span>관측 위치</span>
          <strong>{locationName}</strong>
        </div>
        <button
          type="button"
          className={styles.mapOpenButton}
          onClick={openLocationMap}
          disabled={status !== "ready"}
        >
          지도에서 선택
        </button>
        <div className={styles.locationCoords} aria-live="polite">
          <label className={styles.coordField}>
            <span>위도</span>
            <input value={observerLocation.latitude.toFixed(4)} readOnly />
          </label>
          <label className={styles.coordField}>
            <span>경도</span>
            <input value={observerLocation.longitude.toFixed(4)} readOnly />
          </label>
        </div>
      </div>

      {isMapOpen && createPortal(
        <section className={styles.mapModal} aria-label="지도에서 관측 위치 선택">
          <div className={styles.mapDialog}>
            <div className={styles.mapHeader}>
              <div>
                <p className={styles.kicker}>관측 위치</p>
                <h2>지도에서 위치 선택</h2>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                onClick={closeLocationMap}
                aria-label="지도 닫기"
              >
                ×
              </button>
            </div>

            <form className={styles.mapSearch} onSubmit={handleMapSearch}>
              <input
                value={mapSearchQuery}
                onChange={(event) => {
                  setMapSearchQuery(event.target.value);
                  setMapSearchState("idle");
                  setMapSearchMessage(null);
                  setShowSuggestions(true);
                  setSearchResults([]);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleMapSearchKeyDown}
                placeholder="주소나 장소 검색"
                aria-label="지도 위치 검색"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSuggestions && (!!completedQuery || !!suggestions?.results.length && suggestions.query === mapSearchQuery.trim())}
                aria-controls="place-suggestions"
              />
              <button type="submit" disabled={mapSearchState === "loading" || geoLocationState === "loading"}>
                검색
              </button>
            </form>
            {showSuggestions && (completedQuery || suggestions?.query === mapSearchQuery.trim() && suggestions.results.length > 0) && (
              <ul id="place-suggestions" className={styles.placeResults} role="listbox" aria-label="장소 자동완성">
                {completedQuery && <li role="presentation"><button type="button" role="option" aria-selected="false" onClick={() => { setMapSearchQuery(completedQuery); void searchMapPlace(completedQuery); }}><strong>{completedQuery}</strong><small>정식 학교명으로 검색</small></button></li>}
                {suggestions?.query === mapSearchQuery.trim() && suggestions.results.map((location) => <li role="presentation" key={`${location.latitude},${location.longitude},${location.name}`}><button type="button" role="option" aria-selected="false" onClick={() => chooseSearchResult(location)}>{location.name}</button></li>)}
              </ul>
            )}
            {!showSuggestions && searchResults.length > 0 && <ul className={styles.placeResults} aria-label="장소 검색 결과">{searchResults.map((location) => <li key={`${location.latitude},${location.longitude},${location.name}`}><button type="button" onClick={() => chooseSearchResult(location)}>{location.name}</button></li>)}</ul>}
            {mapSearchMessage && <p className={mapSearchState === "error" ? styles.mapStatusError : styles.mapStatusMessage} role="status">{mapSearchMessage}</p>}
            <div className={styles.mapUtilityActions}>
              <button
                type="button"
                className={styles.currentLocationButton}
                onClick={() => void handleCurrentLocation()}
                disabled={geoLocationState === "loading" || mapSearchState === "loading"}
              >
                {geoLocationState === "loading" ? "위치 확인 중" : "현재 위치"}
              </button>
              {geoLocationMessage && (
                <span
                  className={
                    geoLocationState === "error"
                      ? styles.mapStatusError
                      : styles.mapStatusMessage
                  }
                  aria-live="polite"
                >
                  {geoLocationMessage}
                </span>
              )}
            </div>

            <div
              ref={mapCanvasRef}
              className={styles.mapCanvas}
              style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
              onClick={handleMapClick}
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={handleMapPointerUp}
              onPointerCancel={handleMapPointerUp}
            >
              {mapView.tiles.map((tile) => (
                <div
                  key={tile.key}
                  className={styles.mapTile}
                  style={{
                    left: tile.left,
                    top: tile.top,
                    backgroundImage: `url(${tile.url})`,
                  }}
                />
              ))}
              <div
                className={styles.mapMarker}
                style={{
                  left: mapView.marker.x,
                  top: mapView.marker.y,
                }}
                aria-hidden="true"
              />
              <div className={styles.mapZoom}>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onWheel={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleMapZoom(mapZoom + 1);
                  }}
                  aria-label="지도 확대"
                >
                  +
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onWheel={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleMapZoom(mapZoom - 1);
                  }}
                  aria-label="지도 축소"
                >
                  -
                </button>
              </div>
              <span className={styles.mapAttribution}>
                © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" onPointerDown={(event) => event.stopPropagation()}>OpenStreetMap contributors</a>
              </span>
            </div>

            <p className={styles.mapAddress}>{mapSelectionName}</p>
            <form className={styles.mapCoords} onSubmit={applyCoordinateDraft}>
              <label>위도<input type="number" step="any" min="-90" max="90" aria-label="관측 위도" value={coordinateDraft.latitude} onChange={(event) => setCoordinateDraft({ ...coordinateDraft, latitude: event.target.value })} required /></label>
              <label>경도<input type="number" step="any" min="-180" max="180" aria-label="관측 경도" value={coordinateDraft.longitude} onChange={(event) => setCoordinateDraft({ ...coordinateDraft, longitude: event.target.value })} required /></label>
              <button type="submit">입력 좌표 선택</button>
            </form>
            <div className={styles.mapActions}>
              <button type="button" disabled={mapSearchState === "loading" || geoLocationState === "loading"} onClick={applyMapLocation}>
                이 위치 적용
              </button>
            </div>
          </div>
        </section>, document.body
      )}
    </>
  );
}
