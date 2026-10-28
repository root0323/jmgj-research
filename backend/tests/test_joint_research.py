"""Statistical calibration invariants, including held-out-target isolation."""
import importlib.util
from pathlib import Path
import sys
import unittest
import numpy as np

source=Path(__file__).resolve().parents[1]/'tools/sky_brightness/research/joint_model.py'
spec=importlib.util.spec_from_file_location('_joint_research_test',source)
joint=importlib.util.module_from_spec(spec);sys.modules[spec.name]=joint;spec.loader.exec_module(joint)


def example():
    n=12
    return {'art':np.column_stack([np.linspace(.002,.009,n),np.linspace(.02,.01,n)]),
            'other':np.column_stack([np.linspace(.001,.004,n),np.linspace(.003,.001,n)]),
            'probability':np.linspace(.2,.8,n),'solar':np.r_[np.zeros(8),np.full(4,.005)],
            'beam_weight':np.ones((n,2))*.5,'beam_delta':np.column_stack([np.linspace(-.7,.7,n),np.linspace(.3,-.3,n)])}


class JointResearchTests(unittest.TestCase):
    def test_expected_magnitude_matches_conditional_loss_estimand(self):
        data=example();prediction,detail=joint.forward(joint.PRIOR,data)
        expected=(1-data['probability'])*detail['clear_sqm']+data['probability']*detail['cloudy_sqm']
        np.testing.assert_allclose(prediction,expected,atol=1e-13)
        self.assertTrue(np.all(prediction>=detail['radiance_mean_sqm']-1e-12))

    def test_analytic_gradient_matches_finite_difference(self):
        data=example();values=np.array([-.4,.5,1.3])
        _,gradient=joint.forward(values,data,True)
        for i in range(3):
            shift=np.zeros(3);shift[i]=1e-6
            plus,_=joint.forward(values+shift,data);minus,_=joint.forward(values-shift,data)
            np.testing.assert_allclose(gradient[:,i],(plus-minus)/2e-6,atol=3e-8)

    def test_holdout_targets_cannot_change_fit_or_twilight_prior(self):
        data=example();observed,_=joint.forward([-.3,.8,1.8],data)
        dates=np.repeat(['22','27','26'],4);mask=dates!='26'
        first,diagnostic=joint.fit_one(data,observed,dates,mask)
        altered=observed.copy();altered[~mask]+=1000
        second,_=joint.fit_one(data,altered,dates,mask)
        np.testing.assert_array_equal(first,second)
        self.assertFalse(diagnostic['twilight_parameters_fitted'])
        np.testing.assert_array_equal(first[1:],joint.PRIOR[1:])

    def test_date_weighting_and_solar_domain(self):
        dates=np.array(['a','a','a','b'])
        weights=joint.equal_date_weights(dates,np.ones(4,bool))
        self.assertAlmostEqual(weights[:3].sum(),.5);self.assertAlmostEqual(weights[3],.5)
        self.assertEqual(joint.twilight_zenith(-42),0)
        self.assertGreater(joint.twilight_zenith(-9),joint.twilight_zenith(-10))
        for unsupported in (-16,-3,10,-91):
            with self.assertRaises(ValueError):joint.twilight_zenith(unsupported)

    def test_positive_moon_background_is_not_scaled_with_artificial_gain(self):
        data=example();data['art'][:]=0;data['solar'][:]=0
        low,_=joint.forward([-2.,0.,1.],data);high,_=joint.forward([1.,0.,1.],data)
        np.testing.assert_array_equal(low,high)
