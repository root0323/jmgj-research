export function permitted(address) {
  let url; try { url = new URL(address); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || address.length > 4096) return false;
  const { hostname: h, pathname: p } = url;
  return (h === 'my.meteoblue.com' && (/^\/packages\/(?:airquality-3h|clouds-3h|air-3h)$/.test(p) || ['/account/usage', '/user/key/usage', '/account'].includes(p))) ||
    (h === 'www.7timer.info' && p === '/bin/api.pl') ||
    (h === 'jmgj-kakao-search.jmgj-kakao-search.workers.dev' && /^\/v2\/local\/(?:search\/(?:keyword|address)|geo\/coord2address)\.json$/.test(p)) ||
    (h === 'photon.komoot.io' && ['/api/', '/reverse'].includes(p)) ||
    (h === 'copernicus-dem-90m.s3.amazonaws.com' && (p === '/tileList.txt' || /^\/(Copernicus_DSM_COG_30_[NS]\d{2}_00_[EW]\d{3}_00_DEM)\/\1\.tif$/.test(p))) ||
    (h === 'astrosky-black-marble.jmgj-kakao-search.workers.dev' && /^\/VJ146A4-2025\/compact\/VJ146A4\.[A-Za-z0-9.]+\.h5$/.test(p));
}
export function privateProvider(url) { return new URL(url).hostname === 'my.meteoblue.com'; }
