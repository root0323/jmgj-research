"""Offline evaluation of a frozen cloud/moon candidate on a new observation set.

No coefficient is fitted here. Solar geometry flags observations outside the
fully dark regime; the production calculator has no twilight component.
"""
import argparse
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import astronomy
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio

from calibrate_three_hour import (
    EnvironmentConfig, error_metrics, load_pixel_data_from_h5, lunar_at,
    physics, save_directional_report, sha256, weather_at,
)


def solar_regime(altitude):
    if not np.isfinite(altitude):
        raise ValueError('Nonfinite solar altitude')
    if altitude >= 0:
        return 'daylight'
    if altitude > -6:
        return 'civil_twilight'
    if altitude > -12:
        return 'nautical_twilight'
    if altitude > -18:
        return 'astronomical_twilight'
    return 'astronomical_night'


def solar_at(time, latitude, longitude, height_m):
    dt = datetime.fromisoformat(time)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone(timedelta(hours=9)))
    dt = dt.astimezone(timezone.utc)
    instant = astronomy.Time.Make(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)
    observer = astronomy.Observer(latitude, longitude, height_m)
    equator = astronomy.Equator(astronomy.Body.Sun, instant, observer, True, True)
    horizon = astronomy.Horizon(instant, observer, equator.ra, equator.dec, astronomy.Refraction.Airless)
    return {'altitude':horizon.altitude, 'azimuth':horizon.azimuth,
            'regime':solar_regime(horizon.altitude),
            'source':'Astronomy Engine; topocentric geometric altitude, no refraction',
            'definition':'https://aa.usno.navy.mil/faq/RST_defs'}


def validate_params(params):
    if set(params) != {'g','art_scale','moon_cloud_gain'}:
        raise ValueError('Expected an explicit frozen cloud/moon parameter set')
    if not np.isfinite(list(params.values())).all():
        raise ValueError('Nonfinite parameters')
    if not 0 <= params['g'] < 1 or params['art_scale'] <= 0 or params['moon_cloud_gain'] < 0:
        raise ValueError('Invalid frozen parameters')


def evaluate(rows, cache, geometry, dem, height, params, time):
    coordinate = (rows[0]['lat'], rows[0]['lon'])
    weather, details = weather_at(cache, time, *coordinate)
    moon = lunar_at(time, *coordinate, height)
    solar = solar_at(time, *coordinate, height)
    config = EnvironmentConfig(**weather, moon_phase_angle_deg=moon['phase_angle'])
    moon_angles = (90-moon['altitude'], moon['azimuth'])
    shield = physics.calculate_directional_shielding(coordinate, moon_angles[1], *dem, max_dist_km=30)
    predictions, components = {}, []
    for name in ('baseline','frozen_candidate'):
        settings = config if name == 'baseline' else replace(config, g=params['g'], art_scale=params['art_scale'])
        values = []
        for row in rows:
            parts = physics.run_pipeline(observer_coordinates=coordinate, observer_angles=(row['zen'],row['az']),
                                         moon_angles=moon_angles, pixel_data=geometry, dem_data=dem,
                                         config=settings, precalc_moon_shield=shield,
                                         max_radius_km=30, return_components=True)
            added = 0.0 if name == 'baseline' else parts['I_ml_final']*params['moon_cloud_gain']*settings.cloud_effect_fraction
            total = parts['total']+added
            if not np.isfinite(total) or total <= 0:
                raise ValueError('Invalid radiance')
            values.append(float(12.59-2.5*np.log10(total*683)))
            components.append({'observation_id':row['observation_id'],'time':time,'model':name,
                               **parts,'empirical_moon_added':added,'evaluated_total':total})
        predictions[name] = np.array(values)
        print(f'{time}: {name} complete',flush=True)
    return predictions, components, {'weather':weather,'details':details,'moon':moon,'sun':solar,
                                      'moon_shield_deg':float(shield)}


def comparison_plot(rows, predictions, output, title='Independent date/site diagnostic: frozen coefficients; twilight is not modeled'):
    fig, axes = plt.subplots(1,3,figsize=(15,4.4),gridspec_kw={'width_ratios':[1,1,.55]})
    for ax, altitude in zip(axes[:2],(30,60)):
        ids = [i for i,row in enumerate(rows) if row['altitude']==altitude]
        az = [rows[i]['az'] for i in ids]
        ax.plot(az,[rows[i]['actual_mag'] for i in ids],'ko-',label='SQM-L observed',ms=3)
        for label, values in predictions.items():
            ax.plot(az,values[ids],'.-',label=label.replace('_',' '),ms=3)
        ax.set(title=f'Altitude {altitude} deg',xlabel='Azimuth (deg, N=0, E=90)',ylabel='SQM (mag/arcsec^2)')
        ax.set_xticks(range(0,361,60)); ax.grid(alpha=.25)
    ids = [i for i,row in enumerate(rows) if row['altitude']==90]
    if ids:
        i = ids[0]
        values = [rows[i]['actual_mag']]+[float(v[i]) for v in predictions.values()]
        colors = ['black']+[plt.colormaps['tab10'](i) for i in range(len(predictions))]
        axes[2].scatter(range(len(values)),values,color=colors,s=45)
        axes[2].set_xticks(range(len(values)),['observed']+[s.replace('_','\n') for s in predictions],rotation=35,ha='right')
        axes[2].set(title='Zenith',ylabel='SQM (mag/arcsec^2)')
        axes[2].grid(axis='y',alpha=.25)
    axes[0].legend(fontsize=8)
    fig.suptitle(title)
    fig.tight_layout(); fig.savefig(output,dpi=170); plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('observations','cache','params','h5','dem','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--max-pixels',type=int,default=1000)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Output exists; use a new run directory.')
    rows = pd.read_csv(args.observations).to_dict('records')
    if not rows or len({row['observation_id'] for row in rows}) != len(rows):
        raise ValueError('Empty or duplicate observations')
    if len({(row['lat'],row['lon'],row['time'],row['time_start'],row['time_end']) for row in rows}) != 1:
        raise ValueError('This evaluation requires one site and one observation interval')
    if any(not np.isfinite([row[k] for k in ('lat','lon','actual_mag','az','zen','altitude')]).all()
           or abs(row['zen']+row['altitude']-90)>1e-8 for row in rows):
        raise ValueError('Invalid observation geometry or measurement')
    params = json.loads(args.params.read_text(encoding='utf-8'))
    validate_params(params)
    cache = json.loads(args.cache.read_text(encoding='utf-8'))
    coordinate = (rows[0]['lat'],rows[0]['lon'])
    with rasterio.open(args.dem) as source:
        if source.crs.to_epsg()!=4326:
            raise ValueError('Expected WGS84 DEM')
        dem = (source.read(1), source.transform)
        height = float(next(source.sample([(coordinate[1],coordinate[0])]))[0])
    pixels = load_pixel_data_from_h5(args.h5,coordinate,max_radius_km=30)
    geometry = physics.prepare_pixel_geometry(pixels,coordinate,max_radius_km=30,dem_data=dem,
                                             keep_radiance_fraction=.99,min_pixels=50,max_pixels=args.max_pixels)
    if not geometry:
        raise ValueError('No pixel geometry')
    times = {'representative':rows[0]['time'],
             'interval_start':datetime.fromisoformat(rows[0]['time_start']).strftime('%Y-%m-%d %H:%M'),
             'interval_end':datetime.fromisoformat(rows[0]['time_end']).strftime('%Y-%m-%d %H:%M')}
    observed = np.array([row['actual_mag'] for row in rows])
    all_predictions, all_components, environment, metrics = {}, [], {}, {}
    for assignment, time in times.items():
        values, parts, context = evaluate(rows,cache,geometry,dem,height,params,time)
        all_predictions[assignment] = values
        all_components.extend(parts); environment[assignment] = context
        metrics[assignment] = {name:error_metrics(v-observed) for name,v in values.items()}
    args.output.mkdir(parents=True)
    predictions = all_predictions['representative']
    for label, values in predictions.items():
        save_directional_report([{**row,'pred_mag':float(value),'diff':float(value-row['actual_mag'])}
                                 for row,value in zip(rows,values)],str(args.output/label))
    pd.DataFrame([{**row,**{f'{assignment}_{name}':float(values[i])
                          for assignment,models in all_predictions.items() for name,values in models.items()}}
                  for i,row in enumerate(rows)]).to_csv(args.output/'comparison.csv',index=False)
    pd.DataFrame(all_components).to_csv(args.output/'components.csv',index=False)
    comparison_plot(rows,predictions,args.output/'observed_vs_model.png')
    outside_dark = any(context['sun']['regime']!='astronomical_night' for context in environment.values())
    report = {'n':len(rows),'evaluation':'Frozen parameters; none of this evaluation dataset is used for fitting.',
              'metrics':metrics,'frozen_params':params,'environments':environment,'observer_height_m':height,
              'geometry':{'max_pixels':args.max_pixels,'radius_km':30,'retained_pixels':len(geometry)},
              'hashes':{name:sha256(getattr(args,name)) for name in ('observations','cache','params','h5','dem')},
              'status':('out_of_dark_sky_regime_diagnostic_not_adopted' if outside_dark
                        else 'frozen_independent_evaluation_not_adopted'),
              'outside_dark_sky_regime':outside_dark,
              'model_defaults_changed':False,
              'limitations':['Production model and frozen candidate contain no solar twilight light.',
                             'Coordinates approximate the map sports-ground center, not a GPS measurement.',
                             'Individual reading times are unknown; all use the interval midpoint.',
                             'Interval endpoints test astronomy/weather sensitivity, not unmodeled twilight evolution.',
                             'Obstruction status was not explicitly confirmed for this new dataset; no directions removed.',
                             'SQM-L angular response and direct-light contamination are not integrated.',
                             'Weather is interpolated from 3h model data, not measured atmosphere.',
                             'This is a new date and a nearby different site, and solar regime differs from training.']}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'metrics':metrics,'environments':environment},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
