"""Scene construction and resolved lunar rays for the 3-D transport solver.

Broken-cloud expectation uses independent clear/cloudy columns. It is not a
reconstruction of Kocifaj et al. (2025)'s stochastic 3-D cloud morphology.
"""
from dataclasses import dataclass
from functools import lru_cache
import math

import numpy as np

from .config import BLACK_MARBLE_RADIANCE_TO_SI
from .radiative_transfer import (
    angular_quadrature,cornette_shanks_phase,rayleigh_phase,
    scattering_matrix,solve_transport,phase_on_angular_cells,
)

MODEL_VERSION='sos3d-2026.10.28'
LUMINOUS_EFFICACY=683.


def cloud_optical_depth(liquid_water_path_kg_m2,effective_radius_um=10.):
    """Visible extinction 3 LWP / (2 rho_water r_eff), geometric optics.

    Requires an area-normalized water path. A bare mass in grams is not an
    acceptable substitute. Effective radius remains an explicit assumption.
    """
    if not np.isfinite([liquid_water_path_kg_m2,effective_radius_um]).all() or liquid_water_path_kg_m2<0 or effective_radius_um<=0:
        raise ValueError('Invalid water path or effective radius')
    return 3*liquid_water_path_kg_m2/(2*1000*effective_radius_um*1e-6)


def full_moon_illuminance(phase_angle_deg):
    """TOA V-equivalent illuminance from lunar apparent magnitude.

    The KS91 phase law is relative; its I* factor is not illuminance in lux.
    Use m_V(full)=-12.74 and the existing 12.59 SQM zero-point, integrated
    over the arcsec^2/sr conversion, to keep the photometric units consistent.
    No broad-band Black Marble spectrum is inferred from this V-band model.
    """
    alpha=abs(float(phase_angle_deg))
    if not np.isfinite(alpha) or alpha>180:
        raise ValueError('Invalid lunar phase angle')
    magnitude=-12.74+.026*alpha+4e-9*alpha**4
    zero_magnitude_illuminance=10**(12.59/2.5)/(206264.806247**2)
    return zero_magnitude_illuminance*10**(-.4*magnitude)


def look_vector(zenith_deg,azimuth_deg):
    z,p=np.radians([zenith_deg,azimuth_deg])
    return np.array([np.sin(z)*np.sin(p),np.sin(z)*np.cos(p),np.cos(z)])


def lunar_disk_response(separation_rad,angular_radius_deg=.2725,instrument_fwhm_deg=None):
    """Solid-angle-normalized radiance response: lunar disk or SQM-L beam.

    A finite disk resolves the local peak without a divergent 1/rho^2
    term. SQM-L mode is a Gaussian response approximation, not a field stop.
    """
    theta=np.asarray(separation_rad)
    if instrument_fwhm_deg is not None:
        if not np.isfinite(instrument_fwhm_deg) or instrument_fwhm_deg<=0:
            raise ValueError('Invalid instrument angular response')
        sigma=np.radians(instrument_fwhm_deg)/(2*np.sqrt(2*np.log(2)))
        return np.exp(-.5*(theta/sigma)**2)/gaussian_beam_solid_angle(float(instrument_fwhm_deg))
    radius=np.radians(angular_radius_deg)
    # Uniform finite lunar disk; boundary is a physical edge, not a singularity.
    return np.where(theta<=radius,1/(2*np.pi*(1-np.cos(radius))),0.)


@lru_cache(maxsize=8)
def gaussian_beam_solid_angle(fwhm_deg):
    mu,weights=np.polynomial.legendre.leggauss(128)
    sigma=np.radians(fwhm_deg)/(2*np.sqrt(2*np.log(2)))
    return float(2*np.pi*np.sum(np.exp(-.5*(np.arccos(mu)/sigma)**2)*weights))


@dataclass(frozen=True)
class SceneSettings:
    aod: float
    tau_m: float=.09
    molecular_height: float=8.
    aerosol_height: float=1/.65
    aerosol_albedo: float=.95
    aerosol_g: float=.75
    cloud_base: float=2.
    cloud_thickness: float=1.
    cloud_tau: float=10.
    cloud_albedo: float=.999
    cloud_g: float=.85
    ground_albedo: float=.15
    pixel_area: float=.169
    art_scale: float=1.
    emission_Q: float=.2
    emission_q: float=.5
    n_mu: int=6
    n_phi: int=8
    max_orders: int=512
    tolerance: float=.005
    moon_zenith: float=90.
    moon_azimuth: float=0.
    moon_phase: float=180.
    background_mag: float=22.
    grid_refinement: int=1

    def __post_init__(self):
        if not all(np.isfinite(value) for value in self.__dict__.values()):
            raise ValueError('Nonfinite scene setting')
        if not 0<=self.aod<=5 or not 0<=self.tau_m<=2:
            raise ValueError('Invalid atmospheric optical depth')
        if not 0<=self.aerosol_albedo<=1 or not 0<=self.cloud_albedo<=1 or not 0<=self.ground_albedo<1:
            raise ValueError('Invalid scattering or surface albedo')
        if min(self.molecular_height,self.aerosol_height,self.cloud_base,self.cloud_thickness,self.pixel_area)<=0:
            raise ValueError('Invalid atmospheric length or source area')
        if not 0<=self.cloud_tau<=80 or not 0<self.emission_Q<=1 or not 0<=self.emission_q<1 or self.art_scale<0:
            raise ValueError('Invalid cloud or source parameter')
        if self.grid_refinement not in (1,2,3):
            raise ValueError('Grid refinement must be 1, 2, or 3')


def grid_edges(settings,cloudy):
    positive=np.array([0.,.4,1.,2.,4.,8.,16.,32.,48.])
    horizontal=np.r_[-positive[:0:-1],positive]
    vertical=np.array([0.,.08,.2,.5,1.,2.,3.5,6.,10.,16.,24.,30.])
    if cloudy and settings.cloud_tau>0:
        bottom=settings.cloud_base;top=min(30.,bottom+settings.cloud_thickness)
        if not 0<bottom<top:
            raise ValueError('Cloud layer must lie within model atmosphere')
        divisions=max(4,min(32,int(np.ceil(settings.cloud_tau/.6))))
        vertical=np.unique(np.r_[vertical,np.linspace(bottom,top,divisions+1)])
    def refine(edges):
        return np.r_[np.concatenate([np.linspace(lo,hi,settings.grid_refinement+1)[:-1]
                                     for lo,hi in zip(edges[:-1],edges[1:])]),edges[-1]]
    horizontal=refine(horizontal);vertical=refine(vertical)
    return horizontal,horizontal.copy(),vertical


def cumulative_extinction(height,settings,cloudy):
    h=np.asarray(height)
    tau=settings.tau_m*(1-np.exp(-h/settings.molecular_height))+settings.aod*(1-np.exp(-h/settings.aerosol_height))
    if cloudy:
        tau+=settings.cloud_tau*np.clip((h-settings.cloud_base)/settings.cloud_thickness,0,1)
    return tau


def optical_coefficients(height,settings,cloudy):
    h=np.asarray(height)
    molecular=settings.tau_m/settings.molecular_height*np.exp(-h/settings.molecular_height)
    aerosol=settings.aod/settings.aerosol_height*np.exp(-h/settings.aerosol_height)
    cloud=np.zeros_like(h)
    if cloudy:
        cloud=np.where((h>=settings.cloud_base)&(h<=settings.cloud_base+settings.cloud_thickness),
                       settings.cloud_tau/settings.cloud_thickness,0.)
    return molecular+aerosol+cloud,(molecular,aerosol*settings.aerosol_albedo,cloud*settings.cloud_albedo)


def _angular_sources(settings,directions,weights,moon_direction):
    phases=[phase_on_angular_cells(settings.n_mu,settings.n_phi,moon_direction,kind,g)
            for kind,g in [('rayleigh',0),('aerosol',settings.aerosol_g),('cloud',settings.cloud_g)]]
    # Exact-angle first collisions keep the physical continuous normalization.
    return phases,[1.,1.,1.]


@dataclass
class SkyScene:
    settings: SceneSettings
    cloudy: bool
    edges: tuple
    centers: tuple
    directions: np.ndarray
    weights: np.ndarray
    kernels: list
    solution: object
    beam_norms: list


@lru_cache(maxsize=4)
def build_scene(settings,cloudy,pixels):
    """Cache a whole angular/spatial field, shared by all observed directions.

    Pixels are (east_km,north_km,radiance,source_horizon_deg) tuples.
    Sub-cell sources conserve their integrated upward surface radiance.
    Terrain screening here uses the supplied source horizon, not voxel terrain.
    """
    x,y,z=grid_edges(settings,cloudy)
    xc,yc,zc=[.5*(v[1:]+v[:-1]) for v in (x,y,z)]
    nx,ny,nz=len(xc),len(yc),len(zc)
    directions,weights=angular_quadrature(settings.n_mu,settings.n_phi);nd=len(weights)
    dz=np.diff(z)
    molecular=settings.tau_m*(np.exp(-z[:-1]/settings.molecular_height)-np.exp(-z[1:]/settings.molecular_height))/dz
    aerosol=settings.aod*(np.exp(-z[:-1]/settings.aerosol_height)-np.exp(-z[1:]/settings.aerosol_height))/dz
    cloud=settings.cloud_tau*np.diff(np.clip((z-settings.cloud_base)/settings.cloud_thickness,0,1))/dz if cloudy else np.zeros_like(dz)
    extinction=molecular+aerosol+cloud
    scattering=(molecular,aerosol*settings.aerosol_albedo,cloud*settings.cloud_albedo)
    beta=np.broadcast_to(extinction[:,None,None],(nz,ny,nx)).copy()
    coefficients=[np.broadcast_to(v[:,None,None],beta.shape) for v in scattering]
    kernels=[scattering_matrix(settings.n_mu,settings.n_phi,'rayleigh'),
             scattering_matrix(settings.n_mu,settings.n_phi,'aerosol',settings.aerosol_g),
             scattering_matrix(settings.n_mu,settings.n_phi,'cloud',settings.cloud_g)]
    # Channels: artificial (no cloud encounter), moon, natural background,
    # artificial after at least one cloud-scattering event.
    bottom=np.zeros((ny,nx,nd,4));top=np.zeros_like(bottom)
    up=directions[:,2]>0
    zenith=np.arccos(np.clip(directions[:,2],-1,1))
    emission=(2*settings.emission_Q*(1-settings.emission_q)*np.maximum(directions[:,2],0)
              +.554*settings.emission_q*zenith**4)/(2*settings.emission_Q*(1-settings.emission_q))
    areas=np.diff(y)[:,None]*np.diff(x)[None,:]
    for east,north,radiance,horizon in pixels:
        i=int(np.clip(np.searchsorted(x,east)-1,0,nx-1));j=int(np.clip(np.searchsorted(y,north)-1,0,ny-1))
        visible=up & (np.degrees(np.arcsin(np.clip(directions[:,2],-1,1)))>horizon)
        bottom[j,i,visible,0]+=max(radiance,0)*BLACK_MARBLE_RADIANCE_TO_SI*settings.art_scale*settings.pixel_area/areas[j,i]*emission[visible]
    moon_up=settings.moon_zenith<90
    mu_m=max(np.cos(np.radians(settings.moon_zenith)),.025)
    moon_e=full_moon_illuminance(settings.moon_phase)/LUMINOUS_EFFICACY if moon_up else 0.
    moon_direction=-look_vector(settings.moon_zenith,settings.moon_azimuth)
    phases,norms=_angular_sources(settings,directions,weights,moon_direction)
    tau=cumulative_extinction(z,settings,cloudy)
    tau_step=np.diff(tau)
    incoming_beam=moon_e*mu_m*np.diff(np.exp(-(tau[-1]-tau)/mu_m))/np.maximum(tau_step,1e-30)
    beam_source=np.zeros((nz,ny,nx,nd,4))
    for coefficient,phase in zip(scattering,phases):
        beam_source[...,1]+=(coefficient*incoming_beam)[:,None,None,None]*phase[None,None,None,:]
    direct_ground=moon_e*np.exp(-cumulative_extinction(30.,settings,cloudy)/mu_m)
    bottom[:,:,up,1]=settings.ground_albedo/np.pi*direct_ground*mu_m
    bg=10**((12.59-settings.background_mag)/2.5)/LUMINOUS_EFFICACY
    top[:,:,~up,2]=bg
    solution=solve_transport(beta,coefficients,kernels,x,y,z,directions,weights,bottom,top,
                             external_first_source=beam_source,ground_albedo=settings.ground_albedo,
                             tolerance=settings.tolerance,max_orders=settings.max_orders,
                             channel_transitions={2:((0,3),)})
    return SkyScene(settings,cloudy,(x,y,z),(xc,yc,zc),directions,weights,kernels,solution,norms)


def _sample_field(scene,points):
    # Vectorized trilinear interpolation. Cell centers extend to adjacent faces.
    x,y,z=scene.centers
    coordinates=[points[:,0],points[:,1],points[:,2]]
    bounds=[x,y,z];indices=[];fractions=[]
    for grid,values in zip(bounds,coordinates):
        lower=np.clip(np.searchsorted(grid,values)-1,0,len(grid)-2)
        fractions.append(np.clip((values-grid[lower])/(grid[lower+1]-grid[lower]),0,1))
        indices.append(lower)
    result=np.zeros((len(points),len(scene.weights),scene.solution.radiance.shape[-1]))
    for dk in (0,1):
        for dj in (0,1):
            for di in (0,1):
                factor=(fractions[0] if di else 1-fractions[0])*(fractions[1] if dj else 1-fractions[1])*(fractions[2] if dk else 1-fractions[2])
                result+=factor[:,None,None]*scene.solution.radiance[indices[2]+dk,indices[1]+dj,indices[0]+di]
    return result


def ray_radiance(scene,zenith_deg,azimuth_deg):
    """Formal ray integration at the actual requested angle, not nearest bin.

    The collimated lunar first collision is evaluated at its exact separation;
    therefore a narrow forward peak is not lost in the coarse diffuse grid.
    """
    look=look_vector(zenith_deg,azimuth_deg);mu=look[2]
    if mu<=0:
        return np.zeros(4)
    maximum=min(30.,48*mu/max(abs(look[0]),abs(look[1]),1e-12))
    vertical=scene.edges[2];boundaries=np.unique(np.r_[0.,vertical[vertical<maximum],maximum])
    boundaries=np.unique(np.r_[boundaries,.5*(boundaries[:-1]+boundaries[1:])])
    # Integrate each material interval separately. Sampling a cloud-boundary
    # discontinuity with a trapezoid would extend cloud emission into clear air.
    h=.5*(boundaries[:-1]+boundaries[1:])
    points=h[:,None]/mu*look[None,:]
    field=_sample_field(scene,points)
    settings=scene.settings
    extinction,coefficients=optical_coefficients(h,settings,scene.cloudy)
    outgoing=-look
    phases=[phase_on_angular_cells(settings.n_mu,settings.n_phi,outgoing,kind,g)*scene.weights
            for kind,g in [('rayleigh',0),('aerosol',settings.aerosol_g),('cloud',settings.cloud_g)]]
    source=np.zeros((len(h),4))
    for species,(beta,phase) in enumerate(zip(coefficients,phases)):
        incoming=np.einsum('sdc,d->sc',field,phase)
        if species==2:
            incoming[:,3]+=incoming[:,0];incoming[:,0]=0
        source+=beta[:,None]*incoming
    mu_m=max(np.cos(np.radians(settings.moon_zenith)),.025)
    e=full_moon_illuminance(settings.moon_phase)/LUMINOUS_EFFICACY if settings.moon_zenith<90 else 0.
    moon_in=-look_vector(settings.moon_zenith,settings.moon_azimuth)
    cos_m=float(np.clip(outgoing@moon_in,-1,1))
    moon_phases=[rayleigh_phase(cos_m),cornette_shanks_phase(cos_m,settings.aerosol_g),cornette_shanks_phase(cos_m,settings.cloud_g)]
    tau=cumulative_extinction(boundaries,settings,scene.cloudy)
    transmissions=np.exp(-tau/mu)
    diffuse_weights=np.divide(transmissions[:-1]-transmissions[1:],extinction,
                              out=np.diff(boundaries)/mu,where=extinction>1e-30)
    result=np.sum(source*diffuse_weights[:,None],axis=0)
    # Analytic attenuation integral for the collimated first collision. This
    # stays well behaved when the outgoing and incoming beams have equal mu.
    log_product=-tau/mu-(cumulative_extinction(30.,settings,scene.cloudy)-tau)/mu_m
    slope=np.diff(log_product)
    delta_tau=np.diff(tau)
    attenuation_average=np.exp(np.maximum(log_product[:-1],log_product[1:]))
    attenuation_average*=np.divide(-np.expm1(-np.abs(slope)),np.abs(slope),
                                  out=np.ones_like(slope),where=np.abs(slope)>1e-12)
    beam_weights=e*delta_tau/mu*attenuation_average
    for beta,phase,norm in zip(coefficients,moon_phases,scene.beam_norms):
        ratio=np.divide(beta,extinction,out=np.zeros_like(beta),where=extinction>1e-30)
        result[1]+=float(np.sum(ratio*float(phase)/(4*np.pi*norm)*beam_weights))
    # The celestial background exists beyond the finite artificial-light domain.
    result[2]+=10**((12.59-settings.background_mag)/2.5)/LUMINOUS_EFFICACY*np.exp(-cumulative_extinction(30.,settings,scene.cloudy)/mu)
    return np.maximum(result,0)


def sensor_rays(zenith_deg,azimuth_deg,fwhm_deg):
    """Integrate diffuse light over a Gaussian SQM-L angular response.

    Gauss-Laguerre in radius squared, uniform azimuth; no per-direction fitting.
    The solid-angle Jacobian sin(theta)/theta corrects the radial integration.
    """
    if fwhm_deg is None:
        return [(zenith_deg,azimuth_deg,1.)]
    if not np.isfinite(fwhm_deg) or not 0<fwhm_deg<=40:
        raise ValueError('Instrument beam FWHM outside supported range (0,40]')
    axis=look_vector(zenith_deg,azimuth_deg)
    east=np.array([np.cos(np.radians(azimuth_deg)),-np.sin(np.radians(azimuth_deg)),0.])
    perpendicular=np.cross(axis,east)
    nodes,weights=np.polynomial.laguerre.laggauss(4)
    sigma=np.radians(fwhm_deg)/(2*np.sqrt(2*np.log(2)))
    rays=[]
    corrected=weights*np.sinc(sigma*np.sqrt(2*nodes)/np.pi)
    corrected/=corrected.sum()
    for node,weight in zip(nodes,corrected):
        theta=sigma*np.sqrt(2*node)
        for phi in (np.arange(8)+.5)*2*np.pi/8:
            direction=np.cos(theta)*axis+np.sin(theta)*(np.cos(phi)*east+np.sin(phi)*perpendicular)
            z=np.degrees(np.arccos(np.clip(direction[2],-1,1)))
            a=np.degrees(np.arctan2(direction[0],direction[1]))%360
            rays.append((float(z),float(a),float(weight/8)))
    return rays


def run_modern_pipeline(pixels,observer_angles,moon_angles,config,moon_shield_deg=0.,return_components=False):
    """Independent-column cloud expectation with genuinely coupled scattering.

    Cloud fraction is a probability, never squared. Cloud optical thickness is
    an independent microphysical input, not inferred from cloud fraction.
    """
    fraction=float(config.cloud_fraction)
    if not np.isfinite(fraction) or not 0<=fraction<=1:
        raise ValueError('Invalid cloud fraction')
    tau=config.cloud_optical_depth
    optical_source='explicit_optical_depth'
    if tau is None and config.cloud_liquid_water_path_kg_m2 is not None:
        tau=cloud_optical_depth(config.cloud_liquid_water_path_kg_m2,config.cloud_effective_radius_um)
        optical_source='water_path_and_assumed_effective_radius'
    if tau is None:
        tau=10.
        optical_source='assumed_tau_10_no_cloud_microphysics_available'
    if not np.isfinite(tau) or not 0<=tau<=80:
        raise ValueError('Cloud optical thickness outside supported range [0,80]')
    base=float(config.cloud_base_h)
    base_source=config.cloud_base_source
    if fraction>0 and base>=29:
        base=2.
        base_source='assumed_2km_unavailable_cloud_base'
    settings=SceneSettings(aod=float(config.aod),tau_m=float(config.tau0_m),
        molecular_height=float(config.scale_height),aerosol_height=1/float(config.gamma),
        aerosol_albedo=float(config.omega_a),aerosol_g=float(config.g),
        cloud_base=base,cloud_thickness=float(config.cloud_thickness_km),cloud_tau=float(tau),
        cloud_albedo=float(config.cloud_single_scattering_albedo),cloud_g=float(config.cloud_asymmetry),
        ground_albedo=float(config.transport_ground_albedo),pixel_area=float(config.pixel_area),
        art_scale=float(config.art_scale),emission_Q=float(config.Q),emission_q=float(config.q),
        n_mu=int(config.transport_n_mu),n_phi=int(config.transport_n_phi),
        grid_refinement=int(config.transport_grid_refinement),
        tolerance=float(config.transport_tolerance),max_orders=int(config.transport_max_orders),
        moon_zenith=float(moon_angles[0]),moon_azimuth=float(moon_angles[1]),moon_phase=float(config.moon_phase_angle_deg))
    if fraction>0 and base+settings.cloud_thickness>30:
        raise ValueError('Cloud layer exceeds the 30 km model atmosphere')
    packed=[]
    for pixel in pixels:
        distance=float(pixel['distance_km']);bearing=float(pixel['phi_c_rad'])
        if not np.isfinite([distance,bearing,pixel['radiance'],pixel['shield_deg']]).all():
            raise ValueError('Invalid source geometry')
        packed.append((distance*np.sin(bearing),distance*np.cos(bearing),float(pixel['radiance']),float(pixel['shield_deg'])))
    packed=tuple(packed)
    rays=sensor_rays(*observer_angles,config.instrument_fwhm_deg)
    columns=[];values=[]
    for cloudy,weight in [(False,1-fraction),(True,fraction)]:
        if weight<=0:
            columns.append(None);values.append(np.zeros(4));continue
        scene=build_scene(settings,cloudy,packed)
        columns.append(scene)
        value=np.zeros(4)
        for z,a,w in rays:
            value+=w*ray_radiance(scene,z,a)
        values.append(value)
    clear,cloudy=values
    art=(1-fraction)*clear[0]+fraction*cloudy[0]
    cloud=(1-fraction)*clear[3]+fraction*cloudy[3]
    moon=(1-fraction)*clear[1]+fraction*cloudy[1]
    background=(1-fraction)*clear[2]+fraction*cloudy[2]
    direct=0.
    moon_elevation=90-settings.moon_zenith
    if config.include_direct_moon and moon_elevation>max(0.,moon_shield_deg):
        target=look_vector(*observer_angles);direction=look_vector(*moon_angles)
        separation=float(np.arccos(np.clip(target@direction,-1,1)))
        mu_m=max(np.cos(np.radians(settings.moon_zenith)),.025)
        transmission=(1-fraction)*np.exp(-cumulative_extinction(30.,settings,False)/mu_m)
        transmission+=fraction*np.exp(-cumulative_extinction(30.,settings,True)/mu_m)
        direct=full_moon_illuminance(settings.moon_phase)/LUMINOUS_EFFICACY*transmission*float(
            lunar_disk_response(separation,instrument_fwhm_deg=config.instrument_fwhm_deg))
        moon+=direct
    total=float(art+cloud+moon+background)
    if not np.isfinite(total) or total<0:
        raise ValueError('Invalid transported radiance')
    if not return_components:
        return total
    return {'total':total,'I_ml':float(moon*LUMINOUS_EFFICACY),
            'I_art':float(art/BLACK_MARBLE_RADIANCE_TO_SI),
            'I_cloud':float(cloud/BLACK_MARBLE_RADIANCE_TO_SI),'I_bg':float(background),
            'I_ml_final':float(moon),'I_art_final':float(art),
            'I_cloud_final':float(cloud),'I_bg_final':float(background),
            'I_moon_direct_final':float(direct),'model_version':MODEL_VERSION,
            'transport':{'clear':columns[0].solution.diagnostics if columns[0] else None,
                         'cloudy':columns[1].solution.diagnostics if columns[1] else None,
                         'cloud_fraction':fraction,'cloud_mixing':'independent-column radiance expectation, linear probability',
                         'cloud_optical_depth':float(tau),'cloud_optical_depth_source':optical_source,
                         'cloud_base_km':base,'cloud_base_source':base_source,
                         'cloud_thickness_km':settings.cloud_thickness,
                         'cloud_component_definition':'Artificial photons with at least one cloud-scattering event; paths are tagged through subsequent scattering.',
                         'instrument_response':'SQM-L Gaussian approximation' if config.instrument_fwhm_deg else 'resolved sky radiance',
                         'spatial_cloud_morphology_resolved':False,
                         'legacy_global_multiple_scattering_factor_applied':False}}
