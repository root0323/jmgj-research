import asyncio
import unittest
from unittest.mock import AsyncMock, patch
import httpx
from fastapi import HTTPException
from app.api.endpoints import geocode as geo


class GeocodeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        geo.GEOCODE_CACHE.clear()
        geo.NOMINATIM_LOCK = asyncio.Lock()

    def test_school_expansion_and_world_queries(self):
        self.assertEqual(geo.build_query_variants("제주과학고")[0], "제주과학고등학교")
        self.assertEqual(geo.build_query_variants("Eiffel Tower"), ["Eiffel Tower"])

    async def test_exact_school_result_stops_variants_and_public_fallback(self):
        school = {"lat": "33.425814", "lon": "126.5308195", "name": "제주과학고등학교",
                  "display_name": "제주과학고등학교", "type": "school", "osm_id": 123}
        with patch.object(geo, "get_kakao_api_key", return_value=None), patch.object(geo, "get_vworld_api_key", return_value=None), \
             patch.object(geo, "fetch_photon_results", AsyncMock(return_value=[school])) as photon, \
             patch.object(geo, "fetch_nominatim_results", AsyncMock()) as nominatim:
            results = await geo.geocode("제주과학고", False)
            self.assertEqual(results[0]["name"], "제주과학고등학교")
            await geo.geocode("제주과학고", False)
            photon.assert_awaited_once()
            nominatim.assert_not_awaited()

    async def test_upstream_failure_is_not_cached_as_empty_results(self):
        with patch.object(geo, "nominatim_get", AsyncMock(side_effect=httpx.ConnectError("unavailable"))):
            with self.assertRaises(HTTPException) as error:
                await geo.fetch_nominatim_results(AsyncMock(), {}, "Unknown place")
            self.assertEqual(error.exception.status_code, 503)
            self.assertFalse(geo.GEOCODE_CACHE)

    async def test_autocomplete_never_calls_nominatim(self):
        with patch.object(geo, "fetch_photon_results", AsyncMock(return_value=[{"name": "school"}])) as photon, \
             patch.object(geo, "fetch_nominatim_results", AsyncMock()) as nominatim:
            await geo.suggest_places("제주과학고")
            self.assertEqual(photon.await_args.args[2], "제주과학고등학교")
            nominatim.assert_not_awaited()

    async def test_search_and_reverse_share_public_rate_limiter(self):
        geo.NOMINATIM_LAST_REQUEST = 10
        client = AsyncMock()
        with patch.object(geo.time, "monotonic", side_effect=[10.5, 11.05]), patch.object(geo.asyncio, "sleep", AsyncMock()) as sleep:
            await geo.nominatim_get(client, "reverse", params={"lat": 0, "lon": 0})
            self.assertAlmostEqual(sleep.await_args.args[0], .55)
            self.assertEqual(geo.NOMINATIM_LAST_REQUEST, 11.05)


if __name__ == "__main__":
    unittest.main()
