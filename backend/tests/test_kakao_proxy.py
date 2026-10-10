import unittest
from unittest.mock import AsyncMock, patch
import httpx
from app.api.endpoints import geocode as geo


class KakaoProxyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        geo.GEOCODE_CACHE.clear()
        geo.REVERSE_GEOCODE_CACHE.clear()
        self.config = {"KAKAO_PROXY_URL": "https://jmgj-kakao-search.owner.workers.dev"}
        self.settings = patch.object(geo, "setting", side_effect=lambda name, default="": self.config.get(name, default))
        self.settings.start()
        self.addCleanup(self.settings.stop)

    def test_public_worker_url_only_and_provider_change_invalidates_cache(self):
        previous = geo.provider_version()
        self.config["KAKAO_PROXY_URL"] = "https://jmgj-kakao-search.other.workers.dev"
        self.assertNotEqual(previous, geo.provider_version())
        for value in ["http://a.workers.dev", "https://a.workers.dev.evil.test", "https://key@a.workers.dev",
                      "https://a.workers.dev?key=secret", "https://a.workers.dev/path", "https://127.0.0.1", "https://a.workers.dev:444"]:
            self.config["KAKAO_PROXY_URL"] = value
            self.assertIsNone(geo.get_kakao_proxy_base(), value)

    async def test_proxy_receives_no_local_operator_key(self):
        client = AsyncMock()
        client.get.return_value = httpx.Response(200, json={"documents": []})
        self.config["KAKAO_REST_API_KEY"] = "never-send-this-key"
        await geo.fetch_kakao_keyword_results(client, "제주과학고등학교", self.config["KAKAO_REST_API_KEY"])
        call = client.get.await_args
        self.assertEqual(call.args[0], self.config["KAKAO_PROXY_URL"] + "/v2/local/search/keyword.json")
        self.assertNotIn("Authorization", call.kwargs["headers"])
        self.assertNotIn("never-send-this-key", str(call))
        self.assertFalse(call.kwargs["follow_redirects"])

    async def test_app_without_key_uses_proxy_for_autocomplete_search_and_reverse(self):
        document = {"place_name": "제주과학고등학교", "address_name": "제주특별자치도 제주시",
                    "x": "126.5308", "y": "33.4258", "id": "123", "category_name": "교육,학문 > 학교 > 고등학교"}
        def upstream(request):
            self.assertEqual(request.url.host, "jmgj-kakao-search.owner.workers.dev")
            self.assertNotIn("authorization", request.headers)
            if request.url.path.endswith("coord2address.json"):
                return httpx.Response(200, json={"documents": [{"address": {"address_name": "제주특별자치도 제주시"}}]})
            return httpx.Response(200, json={"documents": [document] if request.url.path.endswith("keyword.json") else [], "meta": {"total_count": 1}})
        client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        with patch.object(geo.httpx, "AsyncClient", return_value=client), \
             patch.object(geo, "fetch_photon_results", AsyncMock()) as fallback:
            suggestions = await geo.suggest_places("제주과학고")
            self.assertEqual(suggestions[0]["name"], "제주과학고등학교")
            fallback.assert_not_awaited()
        # Each endpoint owns its HTTP client and closes it when finished.
        for endpoint, args in [(geo.geocode, ("제주과학고", False)), (geo.reverse_geocode, (33.4258, 126.5308))]:
            client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
            with patch.object(geo.httpx, "AsyncClient", return_value=client):
                result = await endpoint(*args)
                self.assertTrue(result)
                self.assertEqual((result[0] if isinstance(result, list) else result)["source"], "kakao_keyword" if isinstance(result, list) else "kakao")

    async def test_unavailable_proxy_keeps_public_autocomplete_fallback(self):
        client = AsyncMock()
        client.get.return_value = httpx.Response(429, json={"error": "rate_limited"})
        with patch.object(geo.httpx, "AsyncClient", return_value=client), \
             patch.object(geo, "fetch_kakao_results", AsyncMock(return_value=[])), \
             patch.object(geo, "fetch_photon_results", AsyncMock(return_value=[{"name": "대체 장소"}])) as fallback:
            result = await geo.suggest_places("서울시청")
            self.assertEqual(result[0]["name"], "대체 장소")
            fallback.assert_awaited_once()

    def test_kakao_search_and_reverse_results_are_not_retained(self):
        for value in [[{"source": "kakao_keyword", "name": "school"}], {"source": "kakao", "name": "address"}]:
            cache = {}
            geo.set_cached(cache, "same-location", value)
            self.assertIsNone(geo.get_cached(cache, "same-location"))
            self.assertEqual(cache, {})
        cache = {}
        geo.set_cached(cache, "public", [{"source": "photon", "name": "Paris"}])
        self.assertTrue(geo.get_cached(cache, "public"))


if __name__ == "__main__":
    unittest.main()
