"""Keep twilight measurements identifiable instead of silently fitting a night model."""
from pathlib import Path
import sys
import unittest
import numpy as np

RESEARCH=Path(__file__).resolve().parents[1]/'tools/sky_brightness/research'
sys.path.insert(0,str(RESEARCH))
from evaluate_frozen import solar_at, solar_regime, validate_params
from probe_twilight import predict, solar_basis


class SolarRegimeTests(unittest.TestCase):
    def test_usno_dark_limits_and_invalid_input(self):
        self.assertEqual(solar_regime(-6),'nautical_twilight')
        self.assertEqual(solar_regime(-12),'astronomical_twilight')
        self.assertEqual(solar_regime(-18),'astronomical_night')
        with self.assertRaises(ValueError):
            solar_regime(float('nan'))

    def test_new_interval_is_twilight_and_training_interval_is_dark(self):
        for time in ('18:29','18:32','18:35'):
            result=solar_at('2026-10-26 '+time,33.42785,126.53208,500)
            self.assertTrue(-12<result['altitude']<-6)
            self.assertTrue(250<result['azimuth']<275)
            self.assertEqual(result['regime'],'nautical_twilight')
        dark=solar_at('2026-10-22 21:25',33.426769,126.530349,500)
        self.assertLess(dark['altitude'],-18)

    def test_same_instant_with_explicit_offset_agrees(self):
        naive=solar_at('2026-10-26 18:32',33.42785,126.53208,500)
        utc=solar_at('2026-10-26T09:32+00:00',33.42785,126.53208,500)
        self.assertAlmostEqual(naive['altitude'],utc['altitude'],places=10)
        self.assertAlmostEqual(naive['azimuth'],utc['azimuth'],places=10)

    def test_unknown_frozen_parameters_are_not_silently_ignored(self):
        for params in ({'g':.5,'art_scale':.05},
                       {'g':.5,'art_scale':.05,'moon_cloud_gain':float('nan')},
                       {'g':.5,'art_scale':.05,'moon_cloud_gain':1,'typo':1}):
            with self.assertRaises(ValueError):
                validate_params(params)

    def test_twilight_term_adds_positive_light_and_zenith_has_no_azimuth(self):
        basis=solar_basis([90,90],[0,180],-10,260)
        values=predict(np.array([18.,18.]),{'log10_amplitude':-2.,'concentration':2.},basis)
        self.assertTrue(np.all(values<18))
        np.testing.assert_allclose(values[0],values[1],rtol=0,atol=1e-12)
        basis=solar_basis([30,30],[260,80],-10,260)
        values=predict(np.array([18.,18.]),{'log10_amplitude':-2.,'concentration':2.},basis)
        self.assertLess(values[0],values[1])

    def test_local_twilight_probe_rejects_day_night_and_horizon(self):
        for altitude,sun_altitude in [(30,10),(30,-30),(0,-10)]:
            with self.assertRaises(ValueError):
                solar_basis([altitude],[0],sun_altitude,260)


if __name__=='__main__':
    unittest.main()
