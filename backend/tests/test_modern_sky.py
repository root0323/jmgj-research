import unittest
from unittest.mock import patch
import numpy as np
from app.services.sky_brightness_model.core.config import EnvironmentConfig,effective_cloud_fraction
from app.services.sky_brightness_model.core.modern_sky import (
    cloud_optical_depth,full_moon_illuminance,lunar_disk_response,
    sensor_rays,run_modern_pipeline,SceneSettings,build_scene,ray_radiance,
)


class ModernSkyTests(unittest.TestCase):
    def test_cloud_probability_does_not_square_or_truncate_free_atmosphere(self):
        config=EnvironmentConfig(physics_model='sos3d',cloud_fraction=.5,cloud_base_h=2)
        self.assertEqual(config.cloud_effect_fraction,.5)
        self.assertEqual(config.H_max,30)
        self.assertEqual(effective_cloud_fraction(.5,2,'legacy'),.25)
        self.assertAlmostEqual(cloud_optical_depth(.1,10),15)
        with self.assertRaises(ValueError):
            EnvironmentConfig(physics_model='sos3d',ms_a=2)

    def test_lunar_peak_is_finite_and_tracks_angular_separation(self):
        self.assertTrue(.25<full_moon_illuminance(0)<.4)
        self.assertGreater(full_moon_illuminance(0),full_moon_illuminance(90))
        radiance=lunar_disk_response(np.radians([0,.1,1,10]))
        self.assertTrue(np.isfinite(radiance).all())
        self.assertGreater(radiance[0],radiance[-1])
        response=lunar_disk_response(np.radians([0,10,20]),instrument_fwhm_deg=20)
        self.assertAlmostEqual(response[1]/response[0],.5)
        self.assertAlmostEqual(sum(r[2] for r in sensor_rays(30,0,20)),1)

    def test_clear_cloudy_expectation_is_linear_in_probability_and_components_close(self):
        common=dict(physics_model='sos3d',aod=.1,cloud_base_h=2,cloud_optical_depth=1,
                    transport_n_mu=4,transport_n_phi=8,transport_tolerance=.01,
                    moon_phase_angle_deg=20)
        pixels=[{'distance_km':1.,'phi_c_rad':0.,'radiance':10.,'shield_deg':0.}]
        values=[]
        for fraction in (0,.5,1):
            result=run_modern_pipeline(pixels,(30,180),(45,90),EnvironmentConfig(**common,cloud_fraction=fraction),return_components=True)
            self.assertAlmostEqual(sum(result[k] for k in ['I_art_final','I_cloud_final','I_ml_final','I_bg_final']),result['total'])
            self.assertTrue(result['transport']['legacy_global_multiple_scattering_factor_applied'] is False)
            self.assertTrue(np.isfinite(result['total']) and result['total']>0)
            values.append(result['total'])
        self.assertAlmostEqual(values[1],.5*(values[0]+values[2]),places=12)

    def test_vacuum_preserves_celestial_background_and_beam_normalization(self):
        config=EnvironmentConfig(physics_model='sos3d',aod=0,tau0_m=0,moon_phase_angle_deg=0,
                                 transport_n_mu=4,transport_n_phi=8)
        result=run_modern_pipeline([],(45,0),(45,90),config,return_components=True)
        self.assertAlmostEqual(12.59-2.5*np.log10(result['total']*683),22,places=11)
        mu,w=np.polynomial.legendre.leggauss(512)
        integral=float(2*np.pi*np.sum(lunar_disk_response(np.arccos(mu),instrument_fwhm_deg=20)*w))
        self.assertAlmostEqual(integral,1,places=10)

    def test_cloud_boundary_does_not_emit_into_adjacent_clear_air(self):
        settings=SceneSettings(aod=0,tau_m=0,cloud_tau=1,cloud_base=2,cloud_thickness=1,
                               moon_zenith=180,n_mu=4,n_phi=8)
        scene=build_scene(settings,True,())
        def isotropic_field(scene,points):
            field=np.zeros((len(points),len(scene.weights),4));field[...,0]=1
            return field
        with patch('app.services.sky_brightness_model.core.modern_sky._sample_field',side_effect=isotropic_field):
            result=ray_radiance(scene,0,0)
        self.assertAlmostEqual(result[3],settings.cloud_albedo*(1-np.exp(-1)),places=11)
        self.assertEqual(result[0],0)


if __name__=='__main__':
    unittest.main()
