"""Physical and validation invariants for local roof occultation research."""
import csv
import inspect
from pathlib import Path
import sys
import unittest

import numpy as np

research = Path(__file__).resolve().parents[1]/'tools/sky_brightness/research'
sys.path.insert(0, str(research))
from roof_model import conditional_components, RoofSkyModel
from joint_model import fit_grid, TAU_GRID, forward, PRIOR


class RoofResearchTests(unittest.TestCase):
    def test_local_shadow_removes_disk_but_retains_diffuse_and_other_sources(self):
        parts = {'I_ml_final': 7., 'I_moon_direct_final': 5., 'I_art_final': 11.,
                 'I_cloud_final': 13., 'I_bg_final': 3.}
        lit = conditional_components(parts, 1.)
        shaded = conditional_components(parts, 0.)
        self.assertEqual(shaded['other'], 5.*683)
        self.assertEqual(lit['other']-shaded['other'], 5.*683)
        for name in ('art', 'background', 'moon_diffuse', 'moon_direct_unobstructed'):
            self.assertEqual(lit[name], shaded[name])
        self.assertGreater(shaded['moon_diffuse'], 0)
        self.assertEqual(shaded['moon_direct_visible'], 0)

    def test_partial_visibility_is_linear_in_photons_not_magnitudes(self):
        parts = {'I_ml_final': .009, 'I_moon_direct_final': .005, 'I_art_final': .001,
                 'I_cloud_final': .002, 'I_bg_final': .003}
        blocked = conditional_components(parts, 0.)
        unblocked = conditional_components(parts, 1.)
        partial = conditional_components(parts, .25)
        self.assertAlmostEqual(partial['other'], .75*blocked['other']+.25*unblocked['other'])
        for invalid in (-.01, 1.01, np.nan, np.inf):
            with self.assertRaises(ValueError):
                conditional_components(parts, invalid)

    def test_tau_selection_cannot_read_held_out_labels(self):
        n = 9
        data = {'art': np.ones((n, 2))*.002, 'other': np.ones((n, 2))*.003,
                'probability': np.linspace(.1, .9, n), 'solar': np.zeros(n),
                'beam_weight': np.ones((n, 1)), 'beam_delta': np.zeros((n, 1))}
        grid = {tau: {**data, 'art': data['art']*(1+tau/100)} for tau in TAU_GRID}
        labels, _ = forward(PRIOR, grid[10.]); dates = np.repeat(['22', '27', '28'], 3)
        train = dates != '28'
        first, _, _ = fit_grid(grid, labels, dates, train)
        changed = labels.copy(); changed[~train] = np.nan
        second, _, _ = fit_grid(grid, changed, dates, train)
        self.assertEqual(first, second)

    def test_original_minute_labels_missing_slot_and_confirmed_mask_are_preserved(self):
        base = research/'datasets/2026-10-28_2113-2123_KST_jeju_science_rooftop'
        with (base/'raw/sqm_observations.csv').open(encoding='utf-8', newline='') as handle:
            raw = list(csv.DictReader(handle))
        with (base/'inputs/v001_valid_48.csv').open(encoding='utf-8', newline='') as handle:
            selected = list(csv.DictReader(handle))
        self.assertEqual(len(raw), 49); self.assertEqual(len(selected), 48)
        self.assertEqual([row['observation_id'] for row in raw if row['sqm_mag_arcsec2'] == '-'], ['21'])
        expected = {row['observation_id']: row for row in raw}
        for row in selected:
            original = expected[row['observation_id']]
            self.assertEqual(row['time'], original['date']+' '+original['time_kst'])
            self.assertEqual(float(row['actual_mag']), float(original['sqm_mag_arcsec2']))
            self.assertEqual(float(row['local_moon_disk_visibility']), 0.)
        self.assertEqual(len({row['time'] for row in selected}), 11)
        self.assertNotIn('actual_mag', inspect.signature(RoofSkyModel.predict).parameters)
