"""Physical invariants for the directional multiple-scattering transport solver."""
import unittest
import numpy as np

from app.services.sky_brightness_model.core.radiative_transfer import (
    angular_quadrature,cornette_shanks_phase,rayleigh_phase,
    scattering_matrix,scattering_source,solve_transport,TransportConvergenceError,
    transport_sweep,transport_sweep_numpy,
)


class RadiativeTransferTests(unittest.TestCase):
    def test_phase_functions_and_discrete_operator_conserve_energy(self):
        mu,w=np.polynomial.legendre.leggauss(512)
        for phase in [rayleigh_phase(mu),cornette_shanks_phase(mu,.75)]:
            self.assertAlmostEqual(float(np.sum(phase*w)/2),1.,places=9)
        directions,weights=angular_quadrature(4,8)
        np.testing.assert_allclose(np.linalg.norm(directions,axis=1),1,atol=1e-14)
        self.assertAlmostEqual(float(weights.sum()),4*np.pi)
        for kind,g in [('rayleigh',0),('aerosol',.75),('cloud',.85)]:
            kernel=scattering_matrix(4,8,kind,g)
            np.testing.assert_allclose(kernel.sum(axis=1),1,atol=1e-11)
            np.testing.assert_allclose(weights@kernel,weights,atol=1e-11)
            self.assertTrue(np.all(kernel>=0))

    def scene(self,ssa=.7):
        directions,weights=angular_quadrature(4,8)
        edges=np.array([0.,.5,1.])
        beta=np.ones((2,2,2))*.4
        bottom=np.zeros((2,2,len(weights),1));top=np.zeros_like(bottom)
        bottom[:,:,directions[:,2]>0,:]=1
        solution=solve_transport(beta,[beta*ssa],[scattering_matrix(4,8,'rayleigh')],
                                 edges,edges,edges,directions,weights,bottom,top,
                                 ground_albedo=0,tolerance=1e-9,max_orders=100)
        return solution,beta,directions,weights,edges,bottom

    def test_discrete_flux_budget_closes_without_creating_light(self):
        for ssa in (0.,.7):
            solution,beta,dirs,w,edges,bottom=self.scene(ssa)
            field=solution.radiance[...,0];dx=.5;area=dx*dx;volume=dx**3
            incoming=float(np.sum(bottom[:,:,:,0]*np.maximum(dirs[:,2],0)*w))*area
            escaped=0.
            for axis in range(3):
                spatial_axis=2-axis
                for sign,index in [(-1,0),(1,-1)]:
                    face=np.take(field,index,axis=spatial_axis)
                    escaped+=float(np.sum(face*np.maximum(sign*dirs[:,axis],0)*w))*area
            absorbed=float(np.sum(field*(beta*(1-ssa))[...,None]*w))*volume
            self.assertAlmostEqual((escaped+absorbed)/incoming,1.,places=7)
            self.assertTrue(solution.diagnostics['converged'])

    def test_higher_orders_change_direction_distribution(self):
        solution,_,dirs,_,_,_=self.scene(.9)
        down=dirs[:,2]<0
        first=solution.first_order[0,0,0,down,0]
        total=(solution.radiance-solution.unscattered)[0,0,0,down,0]
        self.assertTrue(np.all(total>=first))
        self.assertGreater(float(np.ptp(total/first)),.001)
        self.assertGreater(solution.diagnostics['scattering_orders'],2)

    def test_invalid_absorption_and_unconverged_orders_are_not_silently_used(self):
        dirs,w=angular_quadrature(4,8);edges=np.array([0.,1.]);beta=np.ones((1,1,1))
        bottom=np.ones((1,1,len(w),1));top=np.zeros_like(bottom)
        arguments=(edges,edges,edges,dirs,w,bottom,top)
        with self.assertRaises(ValueError):
            solve_transport(beta,[beta*1.1],[scattering_matrix(4,8,'rayleigh')],*arguments)
        with self.assertRaises(TransportConvergenceError):
            solve_transport(beta,[beta*.99],[scattering_matrix(4,8,'rayleigh')],*arguments,
                            max_orders=2,tolerance=1e-12)

    def test_cloud_path_tags_move_light_without_duplicating_it(self):
        dirs,w=angular_quadrature(4,8);beta=np.ones((1,1,1))*.4
        field=np.ones((1,1,1,len(w),4));field[...,3]=0
        kernel=scattering_matrix(4,8,'cloud',.85)
        plain=scattering_source(field,[beta],[kernel])
        tagged=scattering_source(field,[beta],[kernel],{0:((0,3),)})
        np.testing.assert_allclose(plain.sum(axis=-1),tagged.sum(axis=-1),atol=1e-14)
        self.assertTrue(np.all(tagged[...,0]==0))
        np.testing.assert_allclose(tagged[...,3],plain[...,0])

    def test_uniform_absorber_refines_toward_beer_lambert(self):
        dirs,w=angular_quadrature(4,8);beta_value=.4;errors=[]
        bottom=np.zeros((1,1,len(w),1));top=np.zeros_like(bottom)
        up=dirs[:,2]>0;bottom[:,:,up,0]=1
        for layers in (4,32):
            beta=np.full((layers,1,1),beta_value)
            solution=solve_transport(beta,[np.zeros_like(beta)],[scattering_matrix(4,8,'rayleigh')],
                                     np.array([0.,1e9]),np.array([0.,1e9]),np.linspace(0,1,layers+1),
                                     dirs,w,bottom,top,ground_albedo=0)
            expected=np.exp(-beta_value/dirs[up,2])
            errors.append(float(np.max(np.abs(solution.radiance[-1,0,0,up,0]-expected))))
        self.assertLess(errors[1],errors[0]/4)
        self.assertLess(errors[1],.01)

    def test_mobile_wavefront_and_native_sweep_solve_the_same_equation(self):
        rng=np.random.default_rng(4321);dirs,w=angular_quadrature(4,8)
        source=rng.random((3,2,4,len(w),3));beta=rng.random((3,2,4))
        widths=[np.array([.2,.5,.8,1.]),np.array([.3,.7]),np.array([.1,.3,1.])]
        bottom=rng.random((2,4,len(w),3));top=rng.random(bottom.shape)
        args=(source,beta,*widths,dirs,bottom,top)
        np.testing.assert_allclose(transport_sweep_numpy(*args),transport_sweep(*args),rtol=1e-14,atol=1e-14)


if __name__=='__main__':
    unittest.main()
