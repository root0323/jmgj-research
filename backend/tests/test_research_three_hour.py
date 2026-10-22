"""Research inputs must respect native cadence, timezones and credential redaction."""
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

RESEARCH = Path(__file__).resolve().parents[1] / 'tools/sky_brightness/research'
sys.path.insert(0,str(RESEARCH))
from calibrate_three_hour import lunar_at, weather_at
from capture_weather import redact


def fixture(offset=9):
    times = ['2026-10-22 21:00','2026-10-23 00:00'] if offset == 9 else ['2026-10-22 12:00','2026-10-22 15:00']
    metadata = {'latitude':33.426769,'longitude':126.530349,'utc_timeoffset':offset}
    return {name:{'metadata':dict(metadata),'data_3h':{'time':list(times),field:values}}
            for name,field,values in [('p2','aod550',[0,.3]),('p3','totalcloudcover',[20,80]),
                                      ('p4','convectivecloudbase_pressure',[920,900])]}


class ThreeHourResearchTests(unittest.TestCase):
    def test_declared_timezone_and_three_hour_interpolation_agree(self):
        with patch('requests.get',side_effect=AssertionError('Offline input attempted network')):
            local = weather_at(fixture(9),'2026-10-22 22:30',33.426769,126.530349)
            utc = weather_at(fixture(0),'2026-10-22 22:30',33.426769,126.530349)
        self.assertEqual(local[0],utc[0])
        self.assertAlmostEqual(local[0]['aod'],.15)
        self.assertAlmostEqual(local[0]['cloud_fraction'],.5)
        self.assertEqual(local[1]['interpolation']['p2']['native_step_hours'],[3])
        self.assertEqual(local[1]['interpolation']['p2']['fraction'],.5)
        exact = weather_at(fixture(),'2026-10-22 21:00',33.426769,126.530349)
        self.assertEqual(exact[0]['aod'],0)

    def test_missing_weather_or_wrong_site_never_uses_fallback_forecasts(self):
        for time,latitude in [('2026-10-22 20:59',33.426769),('2026-10-22 22:00',37.5)]:
            with self.assertRaises(ValueError):
                weather_at(fixture(),time,latitude,126.530349)
        missing = fixture(); missing['p2']['data_3h']['aod550'][1] = float('nan')
        with self.assertRaises(ValueError):
            weather_at(missing,'2026-10-22 22:00',33.426769,126.530349)

    def test_secrets_are_removed_recursively_without_changing_weather(self):
        secret = 'secret_for_unit_test_1234'
        raw = {'metadata':{'apikey':secret,'url':'https://example.invalid/?apikey='+secret},
               'data_3h':{'aod550':[0,.3]},'list':[{'authorization':secret,'value':secret}]}
        original = copy.deepcopy(raw)
        sanitized = redact(raw,secret)
        self.assertNotIn(secret,json.dumps(sanitized))
        self.assertNotIn('apikey',sanitized['metadata'])
        self.assertEqual(sanitized['data_3h'],raw['data_3h'])
        self.assertEqual(raw,original)

    def test_lunar_context_is_consistent_with_waxing_moon_above_south(self):
        # Broad independent astronomical invariants, not a snapshot of the implementation.
        result = lunar_at('2026-10-22 21:25',33.426769,126.530349,0)
        self.assertTrue(40 < result['altitude'] < 60)
        self.assertTrue(170 < result['azimuth'] < 190)
        self.assertTrue(0 < result['illumination_fraction'] <= 1)
        self.assertTrue(0 <= result['phase_angle'] <= 180)


if __name__ == '__main__':
    unittest.main()
