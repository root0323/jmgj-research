"""Frozen three-date evaluation, followed by one shared four-date candidate."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from calibrate_three_hour import error_metrics, save_directional_report, sha256
from prepare_joint_basis import RESEARCH, DATASETS, write_json
from prepare_rooftop_basis import DATASET
from joint_model import TAU_GRID, JointParameters, pack, forward, fit_grid
from roof_model import MODEL_VERSION
from evaluate_frozen import comparison_plot

BASELINE = RESEARCH/'revisions/2026-10-28_joint_three_dates'
LABELS = {'frozen_unobstructed': '3일 고정 계수·달 가림 없음',
          'frozen_roof_condition': '3일 고정 계수·실제 달 가림',
          'four_date_fit': '4일 공통 보정', 'date_holdout': '관측일 제외 진단',
          'angular_holdout': '방향 제외 진단'}
PLOT_LABELS = {'frozen_unobstructed': '고정·가림 없음', 'frozen_roof_condition': '고정·달 가림',
               'four_date_fit': '4일 보정', 'date_holdout': '날짜 제외'}


def metrics(frame, labels):
    return {name: error_metrics(frame[name].to_numpy()-frame['actual_mag'].to_numpy()) for name in labels}


def combine(rooftop, destination):
    destination.mkdir()
    previous = BASELINE/'basis/representative'
    old = pd.read_csv(previous/'transport_basis.csv', float_precision='round_trip')
    new = pd.read_csv(rooftop/'transport_basis.csv', float_precision='round_trip')
    assert len(old) == 131*3 and len(new) == 48*3
    basis = pd.concat([old, new], ignore_index=True)
    rays = json.loads((previous/'solar_rays.json').read_text(encoding='utf-8'))
    new_rays = json.loads((rooftop/'solar_rays.json').read_text(encoding='utf-8'))
    assert not set(rays) & set(new_rays)
    rays.update(new_rays)
    basis.to_csv(destination/'transport_basis.csv', index=False)
    write_json(destination/'solar_rays.json', rays)
    write_json(destination/'provenance.json', {
        'old_basis': str(previous.relative_to(RESEARCH)), 'old_basis_sha256': sha256(previous/'transport_basis.csv'),
        'rooftop_basis': json.loads((rooftop/'provenance.json').read_text(encoding='utf-8')),
        'previous_observations_unchanged': True, 'n': 179, 'raw_slots': 196, 'missing': 17,
    })
    return basis, {key.split('/', 1)[1]: value for key, value in rays.items() if key.startswith('representative/')}


def fit(rooftop, output):
    if output.exists():
        raise ValueError('Output already exists; do not overwrite any earlier analysis')
    output.mkdir(parents=True)
    plt.rcParams.update({'font.family': 'Malgun Gothic', 'axes.unicode_minus': False})
    basis, rays = combine(rooftop, output/'basis')
    frames = {tau: basis[(basis['cloud_tau'] == tau) & (basis['assignment'] == 'representative')].reset_index(drop=True)
              for tau in TAU_GRID}
    reference = frames[10.].copy()
    assert len(reference) == 179 and reference['uid'].is_unique
    for frame in frames.values():
        assert frame['uid'].tolist() == reference['uid'].tolist()
        assert np.array_equal(frame['actual_mag'], reference['actual_mag'])
    packed = {tau: pack(frame, rays) for tau, frame in frames.items()}
    original_artifact = BASELINE/'candidate_params.json'
    original = json.loads(original_artifact.read_text(encoding='utf-8'))
    params = JointParameters(**original['parameters'])
    values = [np.log(params.art_scale), np.log(params.twilight_gain), params.twilight_concentration]
    prediction, _ = forward(values, packed[params.cloud_optical_depth])
    reference['frozen_roof_condition'] = prediction
    control = frames[params.cloud_optical_depth].copy()
    new_ids = control['dataset'] == DATASET
    for state in ('clear', 'cloudy'):
        control.loc[new_ids, state+'_other'] = control.loc[new_ids, state+'_other_unobstructed']
    reference['frozen_unobstructed'], _ = forward(values, pack(control, rays))
    old_predictions = pd.read_csv(BASELINE/'comparison.csv', float_precision='round_trip').set_index('uid')
    check = reference[reference['dataset'] != DATASET]
    difference = float(np.max(np.abs(check['frozen_roof_condition'].to_numpy()-old_predictions.loc[check['uid'], 'joint_fit'].to_numpy())))
    assert difference < 1e-10
    frozen = reference[reference['dataset'] == DATASET].copy()
    frozen.to_csv(output/'frozen_oct28_predictions.csv', index=False)
    frozen_report = {'dataset': DATASET, 'n': 48,
                     'baseline_model_version': original['model_version'], 'baseline_parameters': asdict(params),
                     'baseline_parameter_sha256': sha256(original_artifact), 'new_labels_used_for_coefficients': False,
                     'previous_131_prediction_max_absolute_change': difference,
                     'metrics': metrics(frozen, ['frozen_unobstructed', 'frozen_roof_condition']),
                     'local_condition': 'Moon disk continuously hidden, fixed from user report, not fitted; diffuse lunar radiance retained.',
                     'interpretation': 'Frozen coefficients on new observations, with a newly recorded local roof condition. Post-observation weather model output is used; not a forecast-skill test.'}
    write_json(output/'frozen_oct28_report.json', frozen_report)
    print(json.dumps({'frozen_oct28': frozen_report['metrics']}, ensure_ascii=False), flush=True)
    # The frozen result is persisted before any access to the new fitting target.
    observed = reference['actual_mag'].to_numpy(float); dates = reference['dataset'].to_numpy()
    params, values, diagnostic = fit_grid(packed, observed, dates, np.ones(len(reference), bool))
    reference['fitted_cloud_tau'] = params.cloud_optical_depth
    for column in frames[params.cloud_optical_depth].columns:
        if column.startswith(('clear_', 'cloudy_')):
            reference['fitted_'+column] = frames[params.cloud_optical_depth][column]
    reference['four_date_fit'], detail = forward(values, packed[params.cloud_optical_depth])
    reference['four_date_fit_radiance_mean'] = detail['radiance_mean_sqm']
    reference['fitted_clear_sqm'] = detail['clear_sqm']; reference['fitted_cloudy_sqm'] = detail['cloudy_sqm']
    reference['fitted_twilight_cd_m2'] = detail['twilight_cd_m2']
    validation = {}
    for scheme in ('date_holdout', 'angular_holdout'):
        groups = dates if scheme == 'date_holdout' else np.where(reference['altitude'] == 90, 6, reference['az']//60).astype(int)
        predicted = np.full(len(reference), np.nan); coverage = np.zeros(len(reference), int); folds = []
        for group in np.unique(groups):
            test = groups == group; train = ~test
            fold_params, fold_values, fold_diagnostic = fit_grid(packed, observed, dates, train)
            fold_prediction, _ = forward(fold_values, packed[fold_params.cloud_optical_depth])
            predicted[test] = fold_prediction[test]; coverage[test] += 1
            train_ids = reference.loc[train, 'uid'].tolist(); test_ids = reference.loc[test, 'uid'].tolist()
            assert not set(train_ids) & set(test_ids)
            if scheme == 'date_holdout':
                assert not set(dates[train]) & set(dates[test])
            folds.append({'held_out_group': str(group), 'train_uids': train_ids, 'test_uids': test_ids,
                          'parameters': asdict(fold_params), 'diagnostic': fold_diagnostic,
                          'test_metrics': error_metrics(predicted[test]-observed[test])})
            print(f'{scheme}: {group}; RMSE {folds[-1]["test_metrics"]["rmse"]:.5f}', flush=True)
        assert np.all(coverage == 1) and np.isfinite(predicted).all()
        reference[scheme] = predicted; validation[scheme] = {'folds': folds, 'coverage_once_per_uid': True}
    assert np.max(np.abs(reference.loc[new_ids, 'date_holdout']-reference.loc[new_ids, 'frozen_roof_condition'])) < 2e-8
    labels = list(LABELS)
    by_date = {name: metrics(group, labels) for name, group in reference.groupby('dataset', sort=False)}
    report = {'model_version': MODEL_VERSION, 'n': 179, 'raw_slots': 196, 'valid_by_date': {k: v['four_date_fit']['n'] for k, v in by_date.items()},
              'aggregate': metrics(reference, labels), 'datasets': by_date, 'shared_parameters': asdict(params),
              'fit_diagnostic': diagnostic, 'validation': validation, 'frozen_oct28': frozen_report,
              'fit_objective': 'Equal weight per date, squared SQM residuals; same parameters across all sites and minutes.',
              'local_moon_visibility': {'previous_dates': 1., DATASET: 0., 'fitted': False},
              'previous_date_input_policy': 'Reuse exact immutable 131-observation basis and per-date locations, times, weather, terrain. Do not change previous roof/obstruction assumptions.',
              'time_policy': 'Oct28 uses all 11 supplied minute labels, start of each minute (seconds unknown), with separate native transport solves. Previous dates retain documented interval representatives.',
              'point_estimator': 'E[SQM] over clear/cloudy states, with local direct disk occultation before magnitude conversion. SQM(E[radiance]) also exported.',
              'app_adopted': False, 'production_sources_modified': False,
              'sources': [{'url': 'https://doi.org/10.1051/0004-6361/201322433', 'role': 'Jones et al. 2013 atmospheric scattered moonlight context; local roof disk occultation is a geometric inference, not a fit of this paper.'},
                          {'url': 'https://www.unihedron.com/projects/sqm-l/Instruction_sheet.pdf', 'role': 'SQM-L 20-degree FWHM; Gaussian response remains an approximation to the real wings.'}],
              'limitations': [
                  'Joint four-date fit and cross-validation are retrospective. Angular neighbors in one scan are correlated; 179 rows are not 179 independent nights.',
                  'The four dates confound site, atmosphere, time and local geometry. Only Oct26 constrains the empirical twilight gain and shape; holding it out uses declared gain=1, concentration=1 priors.',
                  'Cloud fraction is a modelled probability and optical depth is selected from assumed 1/10/30 scenarios. No local cloud morphology or measured optical depth is available.',
                  'Weather API snapshots are model products received after measurement, not colocated measured atmosphere or an independent real-time forecast test.',
                  'Oct28 coordinates are manually registered from a map screenshot (assumed uncertainty at least 10 m), not surveyed GPS. Four-storey height is recorded but exact height/roof angular mask are unknown.',
                  'The existing ground-relative atmospheric transport grid is retained. DSM can contain structures, so an invented four-storey height is not added on top; elevated sensor and surrounding buildings are unresolved.',
                  'A fixed disk visibility of zero suppresses direct Moon only. Diffuse Moon light remains, but any unmeasured obstruction of beam wings or local reflections is not reconstructed from these SQM values.',
                  'Recorded minute starts are representative times, not measured seconds. No per-row second offsets are invented.',
                  'Scattering-order convergence is a last-order criterion on the retained spatial/angular grid, not a rigorous total-error bound or a new grid-resolution/bandpass validation.',
              ]}
    reference.to_csv(output/'comparison.csv', index=False)
    write_json(output/'report.json', report)
    write_json(output/'candidate_params.json', {'model_version': MODEL_VERSION, 'parameters': asdict(params),
                                              'all_four_dates_used': True, 'coefficient_fit_performed': True,
                                              'application_adopted': False, 'default_local_moon_disk_visibility': 1.,
                                              'local_visibility_is_observation_metadata_not_fitted': True})
    for name, group in reference.groupby('dataset', sort=False):
        destination = output/name; destination.mkdir()
        group.to_csv(destination/'comparison.csv', index=False)
        write_json(destination/'report.json', {'dataset': name, 'n': len(group), 'metrics': by_date[name],
                                              'shared_parameters': asdict(params), 'model_version': MODEL_VERSION, 'app_adopted': False})
        rows = group.to_dict('records')
        for label in ('frozen_roof_condition', 'four_date_fit', 'date_holdout', 'angular_holdout'):
            save_directional_report([{**row, 'pred_mag': row[label], 'diff': row[label]-row['actual_mag']} for row in rows], str(destination/label))
        comparisons = ['frozen_roof_condition', 'four_date_fit', 'date_holdout']
        if name == DATASET:
            comparisons.insert(0, 'frozen_unobstructed')
        comparison_plot(rows, {PLOT_LABELS[label]: group[label].to_numpy() for label in comparisons},
                        destination/'observed_vs_model.png', title=name[:10]+' | 장소·시각·기상 분리, 관측일 제외는 진단')
    summary_plot(report, output)
    direction_plot(reference, output)
    print(json.dumps({'shared_parameters': asdict(params), 'aggregate': report['aggregate'], 'datasets': by_date}, ensure_ascii=False), flush=True)
    return report


def summary_plot(report, output):
    dates = list(report['datasets']); x = np.arange(5); width = .2
    fig, ax = plt.subplots(figsize=(12, 5.2))
    for j, label in enumerate(('frozen_roof_condition', 'four_date_fit', 'angular_holdout', 'date_holdout')):
        values = [report['datasets'][d][label]['rmse'] for d in dates]+[report['aggregate'][label]['rmse']]
        bars = ax.bar(x+(j-1.5)*width, values, width, label=LABELS[label])
        ax.bar_label(bars, fmt='%.3f', padding=3, fontsize=8)
    ax.set_xticks(x, [d[:10] for d in dates]+['전체 179개'])
    ax.set(ylabel='RMSE (mag/arcsec²)', title='서로 다른 장소·시각의 4일 실측 · 옥상 달 원반 가림 반영')
    ax.grid(axis='y', alpha=.2); ax.legend(fontsize=9, ncol=2)
    ax.margins(y=.2); fig.tight_layout(); fig.savefig(output/'rmse_summary.png', dpi=170); plt.close(fig)


def direction_plot(frame, output):
    fig, axes = plt.subplots(4, 2, figsize=(12, 13), layout='constrained')
    for axes_row, (name, group) in zip(axes, frame.groupby('dataset', sort=False)):
        for ax, angle, grid, title in zip(axes_row, ['az', 'altitude'], [np.arange(0, 360, 15), np.array([30, 60, 90])], ['방위각별 RMSE · 천정 제외', '고도별 RMSE']):
            view = group[group['altitude'] != 90] if angle == 'az' else group
            for label in ('frozen_roof_condition', 'four_date_fit', 'date_holdout'):
                errors = (view[label]-view['actual_mag'])**2
                values = errors.groupby(view[angle]).mean().pow(.5).reindex(grid)
                ax.plot(grid, values.to_numpy(), '.-', label=LABELS[label])
            ax.set(title=name[:10]+' · '+title, xlabel='방위각 (°)' if angle == 'az' else '고도 (°)', ylabel='RMSE (mag/arcsec²)')
            ax.set_xticks(np.arange(0, 361, 60) if angle == 'az' else grid); ax.grid(alpha=.2)
            if ax is axes[0, 0]:
                ax.legend(fontsize=8)
    fig.savefig(output/'directional_rmse_overview.png', dpi=160); plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rooftop-basis', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); fit(args.rooftop_basis, args.output)
