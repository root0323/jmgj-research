import { validLocation, type WeatherLocation } from "./meteoblue";

export function currentLocation(geolocation: Geolocation | undefined, secure = true): Promise<WeatherLocation> {
  if (!secure) return Promise.reject(new Error("현재 위치는 HTTPS 또는 localhost에서 사용할 수 있습니다. 지도나 좌표로 선택하세요."));
  if (!geolocation) return Promise.reject(new Error("이 브라우저에서는 현재 위치를 사용할 수 없습니다. Chrome·Edge에서 열거나 지도·좌표로 선택하세요."));
  const attempt = (highAccuracy: boolean) => new Promise<WeatherLocation>((resolve, reject) => {
    geolocation.getCurrentPosition((position) => {
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (validLocation(location)) resolve(location);
      else reject(new Error("현재 위치의 좌표를 확인하지 못했습니다. 지도나 좌표로 선택하세요."));
    }, reject, { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15_000 : 10_000, maximumAge: 60_000 });
  });
  return attempt(false).catch((error) => {
    if (error?.code === 2 || error?.code === 3) return attempt(true);
    throw error;
  }).catch((error) => {
    if (error instanceof Error) throw error;
    if (error?.code === 1) throw new Error("위치 권한이 거부됐습니다. 사이트의 위치 권한과 Windows 설정의 위치 서비스를 허용한 뒤 다시 시도하세요. 지도·좌표 선택도 가능합니다.");
    throw new Error("브라우저가 현재 위치를 확인하지 못했습니다. Windows 위치 서비스를 확인하거나 Chrome·Edge에서 다시 시도하세요. 지도나 좌표로도 선택할 수 있습니다.");
  });
}
