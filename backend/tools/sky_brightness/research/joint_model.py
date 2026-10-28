"""Research-only, shared three-date calibration; never imported by the app.

The transport fields retain their physical Moon and scattering orders. Cloud
cover is a predictive clear/cloudy probability. For squared error in SQM, the
point estimate is E[SQM], rather than SQM(E[radiance]). Both are exported.
Twilight uses the V-band zenith prior of Patat et al. (2006), Table 1,
https://doi.org/10.1051/0004-6361:20064992, with an explicitly empirical angular
extension and shared amplitude. It is not a spherical solar transport solver.
"""
from dataclasses import dataclass, asdict
import numpy as np
from scipy.optimize import minimize

MODEL_VERSION = 'joint-sos3d-twilight-2026.10.28'
TAU_GRID = (10., 1., 30.)
BOUNDS = ((np.log(.1), np.log(3.)), (np.log(.1), np.log(30.)), (0., 4.))
PRIOR = (0., 0., 1.)


def magnitude(luminance):
    values = np.asarray(luminance, dtype=float)
    if not np.isfinite(values).all() or np.any(values <= 0):
        raise ValueError('Luminance must be finite and positive, in cd/m^2')
    return 12.59-2.5*np.log10(values)


def twilight_zenith(sun_altitude):
    """Positive twilight excess over the model's 22 mag natural background.

Only the measured prior domain (-15..-5 degrees) and astronomical night are
supported. No extrapolated daytime/deep-twilight law is silently invented.
"""
    solar = np.asarray(sun_altitude, dtype=float)
    if not np.isfinite(solar).all() or np.any(np.abs(solar)>90):
        raise ValueError('Nonfinite solar altitude')
    night = solar <= -18.
    valid = (solar >= -15.) & (solar <= -5.)
    if np.any(~(night | valid)):
        raise ValueError('Solar altitude outside calibrated prior domain and astronomical night')
    x = -solar-5.
    prior_mag = 11.84+1.518*x-.057*x*x
    excess = np.maximum(10**((12.59-prior_mag)/2.5)-10**((12.59-22.)/2.5), 0.)
    return np.where(night, 0., excess)


@dataclass(frozen=True)
class JointParameters:
    art_scale: float = 1.
    twilight_gain: float = 1.
    twilight_concentration: float = 1.
    cloud_optical_depth: float = 10.

    def __post_init__(self):
        values = np.array(list(asdict(self).values()))
        if not np.isfinite(values).all() or self.art_scale <= 0 or self.twilight_gain <= 0:
            raise ValueError('Invalid shared parameters')
        if not 0 <= self.twilight_concentration <= 4 or self.cloud_optical_depth not in TAU_GRID:
            raise ValueError('Unsupported angular shape or optical-depth scenario')


def pack(frame, rays):
    """Retain each row's cloud probability and its own Sun/beam geometry."""
    identifiers = frame['uid'].tolist()
    nmax = max(len(rays[uid]) for uid in identifiers)
    weight = np.zeros((len(frame), nmax)); delta = weight.copy()
    for i, uid in enumerate(identifiers):
        for j, ray in enumerate(rays[uid]):
            weight[i,j] = ray['weight_airmass']
            delta[i,j] = ray['cosine_minus_zenith']
    return {
        'art': frame[['clear_art','cloudy_art']].to_numpy(float),
        'other': frame[['clear_other','cloudy_other']].to_numpy(float),
        'probability': frame['cloud_fraction'].to_numpy(float),
        'solar': twilight_zenith(frame['sun_altitude'].to_numpy(float)),
        'beam_weight': weight, 'beam_delta': delta,
    }


def forward(values, data, jacobian=False):
    log_art, log_twilight, concentration = np.asarray(values, dtype=float)
    art = np.exp(log_art)*data['art']
    exp_angle = data['beam_weight']*np.exp(concentration*data['beam_delta'])
    solar_scale = np.exp(log_twilight)*data['solar']
    twilight = solar_scale*exp_angle.sum(axis=1)
    total = art+data['other']+twilight[:,None]
    conditional = magnitude(total)
    c = data['probability']
    weights = np.column_stack([1-c, c])
    prediction = np.sum(weights*conditional, axis=1)
    if not jacobian:
        return prediction, {
            'clear_sqm': conditional[:,0], 'cloudy_sqm': conditional[:,1],
            'radiance_mean_sqm': magnitude(np.sum(weights*total,axis=1)),
            'twilight_cd_m2': twilight,
        }
    dsolar_dk = solar_scale*np.sum(exp_angle*data['beam_delta'],axis=1)
    factor = -2.5/np.log(10)
    derivative = np.column_stack([
        factor*np.sum(weights*art/total,axis=1),
        factor*np.sum(weights*twilight[:,None]/total,axis=1),
        factor*np.sum(weights*dsolar_dk[:,None]/total,axis=1),
    ])
    return prediction, derivative


def equal_date_weights(dates, mask):
    dates = np.asarray(dates); mask = np.asarray(mask, dtype=bool)
    selected = np.unique(dates[mask])
    if not len(selected):
        raise ValueError('Empty training set')
    weights = np.zeros(len(dates))
    for date in selected:
        ids = mask & (dates == date)
        weights[ids] = 1/(len(selected)*np.sum(ids))
    return weights


def fit_one(data, observed, dates, mask):
    observed = np.asarray(observed, float); mask = np.asarray(mask, bool)
    weights = equal_date_weights(dates, mask)
    twilight_identified = bool(np.any(data['solar'][mask] > 0))
    active = np.array([0,1,2] if twilight_identified else [0])

    def objective(active_values):
        values = np.array(PRIOR, dtype=float); values[active] = active_values
        prediction, derivative = forward(values, data, True)
        # Held-out targets are never accessed by the fitting objective.
        residual = prediction[mask]-observed[mask]
        loss = float(np.sum(weights[mask]*residual**2))
        gradient = 2*np.sum((weights[mask]*residual)[:,None]*derivative[mask],axis=0)
        return loss, gradient[active]

    trials = []
    for initial in [(0.,0.,1.), (np.log(.3),np.log(3.),2.)]:
        result = minimize(objective,np.asarray(initial)[active],jac=True,method='L-BFGS-B',
                          bounds=[BOUNDS[i] for i in active],options={'ftol':1e-12,'gtol':1e-8,'maxiter':400})
        if result.success and np.isfinite(result.fun):
            trials.append(result)
    if not trials:
        raise ValueError('Shared calibration did not converge')
    winner = min(trials,key=lambda result:result.fun)
    values = np.array(PRIOR,dtype=float); values[active] = winner.x
    return values, {
        'training_equal_date_mse': float(winner.fun),
        'twilight_parameters_fitted': twilight_identified,
        'unidentified_twilight_policy': None if twilight_identified else 'Use fixed prior gain=1, concentration=1; held-out twilight data are not used.',
        'active_parameter_indices': active.tolist(),
        'bounds_hit': [int(i) for i in active if min(abs(values[i]-BOUNDS[i][0]),abs(values[i]-BOUNDS[i][1])) < 1e-5],
        'optimizer_success': True,
    }


def fit_grid(data_by_tau, observed, dates, mask):
    trials = []
    for tau in TAU_GRID:
        values, diagnostic = fit_one(data_by_tau[tau],observed,dates,mask)
        trials.append((diagnostic['training_equal_date_mse'],tau,values,diagnostic))
    _, tau, values, diagnostic = min(trials,key=lambda trial:trial[0])
    params = JointParameters(float(np.exp(values[0])),float(np.exp(values[1])),float(values[2]),tau)
    return params, values, {**diagnostic,'optical_depth_training_scores':{str(t[1]):t[0] for t in trials}}


class JointSkyModel:
    """Reusable offline predictor, requiring site/time/weather but no SQM label."""
    def __init__(self, parameters):
        self.parameters = parameters

    @classmethod
    def from_artifact(cls, path):
        import json
        from pathlib import Path
        artifact = json.loads(Path(path).read_text(encoding='utf-8'))
        if artifact['model_version'] != MODEL_VERSION:
            raise ValueError('Model artifact version mismatch')
        return cls(JointParameters(**artifact['parameters']))

    def predict(self, coordinates, angles, time_kst, weather_cache, geometry, dem, height_m):
        from dataclasses import replace
        import pandas as pd
        from prepare_joint_basis import resolve_context,solar_rays,components
        from app.services.sky_brightness_model.core.config import EnvironmentConfig
        from app.services.sky_brightness_model.core.calculator import run_pipeline
        row={'lat':coordinates[0],'lon':coordinates[1],'zen':angles[0],
             'az':angles[1],'time':time_kst,'uid':'prediction'}
        context=resolve_context(weather_cache,row,height_m,dem)
        moon=context['moon'];sun=context['sun'];params=self.parameters
        cfg=EnvironmentConfig(**context['modern_weather'],physics_model='sos3d',
                              moon_phase_angle_deg=moon['phase_angle'],
                              cloud_optical_depth=params.cloud_optical_depth,instrument_fwhm_deg=20.)
        fields=[]
        for cloud_fraction in (0.,1.):
            part=run_pipeline(observer_coordinates=coordinates,observer_angles=angles,
                              moon_angles=(90-moon['altitude'],moon['azimuth']),pixel_data=geometry,
                              dem_data=dem,precalc_moon_shield=context['moon_shield_deg'],max_radius_km=30,
                              config=replace(cfg,cloud_fraction=cloud_fraction),return_components=True)
            state='clear' if cloud_fraction==0 else 'cloudy'
            if not part['transport'][state]['converged']:
                raise ValueError('Conditional transport did not converge')
            fields.append(components(part))
        row.update({'cloud_fraction':cfg.cloud_fraction,'sun_altitude':sun['altitude'],
                    'clear_art':fields[0][0],'clear_other':fields[0][1],
                    'cloudy_art':fields[1][0],'cloudy_other':fields[1][1]})
        data=pack(pd.DataFrame([row]),{'prediction':solar_rays(row,sun)})
        values=[np.log(params.art_scale),np.log(params.twilight_gain),params.twilight_concentration]
        prediction,details=forward(values,data)
        return {'sqm':float(prediction[0]),'model_version':MODEL_VERSION,
                **{key:float(value[0]) for key,value in details.items()},
                'parameters':asdict(params),'context':context,'app_adopted':False}
