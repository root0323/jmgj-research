"""Research-only local occultation of the Moon, after atmospheric transport.

A roof at the sensor can hide the lunar disk without extinguishing Moon light
scattered elsewhere in the atmosphere. Visibility is an observed condition,
never a coefficient inferred from SQM residuals. The older joint model remains
unchanged so its frozen predictions can still be reproduced.
"""
from dataclasses import asdict, replace
import json
from pathlib import Path

import numpy as np
import pandas as pd

from joint_model import JointParameters, pack, forward

MODEL_VERSION = 'joint-sos3d-roofmask-2026.10.28'


def conditional_components(parts, moon_visibility=1.):
    """Return cd/m^2 channels, retaining all atmospheric diffuse Moon light."""
    visibility = float(moon_visibility)
    if not np.isfinite(visibility) or not 0 <= visibility <= 1:
        raise ValueError('Local lunar disk visibility must be between zero and one')
    direct = float(parts['I_moon_direct_final'])
    diffuse = float(parts['I_ml_final']) - direct
    if direct < 0 or diffuse < -1e-15:
        raise ValueError('Invalid lunar component decomposition')
    diffuse = max(diffuse, 0.)
    channels = {
        'art': float(parts['I_art_final'] + parts['I_cloud_final']) * 683,
        'moon_diffuse': diffuse * 683,
        'moon_direct_unobstructed': direct * 683,
        'moon_direct_visible': visibility * direct * 683,
        'background': float(parts['I_bg_final']) * 683,
    }
    # Preserve exactly the original addition order in the unobstructed control.
    channels['other'] = (float(parts['I_ml_final']) - (1-visibility)*direct
                         + float(parts['I_bg_final'])) * 683
    return channels


class RoofSkyModel:
    """Label-free offline predictor with an explicit local disk visibility."""
    def __init__(self, parameters):
        self.parameters = parameters

    @classmethod
    def from_artifact(cls, path):
        artifact = json.loads(Path(path).read_text(encoding='utf-8'))
        if artifact['model_version'] != MODEL_VERSION:
            raise ValueError('Model artifact version mismatch')
        return cls(JointParameters(**artifact['parameters']))

    def predict(self, coordinates, angles, time_kst, weather_cache, geometry, dem,
                height_m, moon_visibility=1.):
        from prepare_joint_basis import resolve_context, solar_rays
        from app.services.sky_brightness_model.core.config import EnvironmentConfig
        from app.services.sky_brightness_model.core.calculator import run_pipeline
        if not np.isfinite(moon_visibility) or not 0 <= moon_visibility <= 1:
            raise ValueError('Invalid local lunar disk visibility')
        row = {'lat': coordinates[0], 'lon': coordinates[1], 'zen': angles[0],
               'az': angles[1], 'time': time_kst, 'uid': 'prediction'}
        context = resolve_context(weather_cache, row, height_m, dem)
        moon = context['moon']; sun = context['sun']; params = self.parameters
        cfg = EnvironmentConfig(**context['modern_weather'], physics_model='sos3d',
                                moon_phase_angle_deg=moon['phase_angle'],
                                cloud_optical_depth=params.cloud_optical_depth,
                                instrument_fwhm_deg=20.)
        fields = []
        for fraction in (0., 1.):
            part = run_pipeline(observer_coordinates=coordinates, observer_angles=angles,
                                moon_angles=(90-moon['altitude'], moon['azimuth']),
                                pixel_data=geometry, dem_data=dem,
                                precalc_moon_shield=context['moon_shield_deg'],
                                max_radius_km=30, config=replace(cfg, cloud_fraction=fraction),
                                return_components=True)
            state = 'clear' if fraction == 0 else 'cloudy'
            if not part['transport'][state]['converged']:
                raise ValueError('Conditional transport did not converge')
            fields.append(conditional_components(part, moon_visibility))
        row.update({'cloud_fraction': cfg.cloud_fraction, 'sun_altitude': sun['altitude'],
                    'clear_art': fields[0]['art'], 'clear_other': fields[0]['other'],
                    'cloudy_art': fields[1]['art'], 'cloudy_other': fields[1]['other']})
        data = pack(pd.DataFrame([row]), {'prediction': solar_rays(row, sun)})
        values = [np.log(params.art_scale), np.log(params.twilight_gain), params.twilight_concentration]
        prediction, details = forward(values, data)
        return {'sqm': float(prediction[0]), 'model_version': MODEL_VERSION,
                **{key: float(value[0]) for key, value in details.items()},
                'parameters': asdict(params), 'context': context,
                'conditional_components_cd_m2': dict(zip(('clear', 'cloudy'), fields)),
                'local_moon_disk_visibility': float(moon_visibility), 'app_adopted': False}
