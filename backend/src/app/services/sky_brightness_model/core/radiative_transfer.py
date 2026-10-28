"""Positive 3-D discrete-ordinates transport with successive scattering orders.

This is an independent finite-volume implementation of the scalar transport
equation, not a port of MSOS-LP1. Spatial/angular discretization errors and
scattering-order convergence are separate diagnostics. Lengths are km;
extinction/scattering coefficients are km^-1 and radiance is W m^-2 sr^-1.
"""
from dataclasses import dataclass
from functools import lru_cache
import math

import numpy as np
from numba import njit


class TransportConvergenceError(RuntimeError):
    """The requested scattering-order tolerance was not reached."""

    def __init__(self,message,diagnostics=None):
        super().__init__(message)
        self.diagnostics=diagnostics


@lru_cache(maxsize=16)
def angular_quadrature(n_mu=8, n_phi=12):
    if n_mu < 2 or n_mu % 2 or n_phi < 4:
        raise ValueError('Use an even polar quadrature and at least four azimuths')
    mu, wm = np.polynomial.legendre.leggauss(n_mu)
    phi = (np.arange(n_phi)+.5)*2*np.pi/n_phi
    directions = np.array([[math.sqrt(1-m*m)*math.sin(p),
                            math.sqrt(1-m*m)*math.cos(p),m] for m in mu for p in phi])
    weights = np.repeat(wm,n_phi)*(2*np.pi/n_phi)
    directions.setflags(write=False); weights.setflags(write=False)
    return directions, weights


def rayleigh_phase(cosine):
    """Phase function with its 4pi normalization removed."""
    return .75*(1+np.asarray(cosine)**2)


def cornette_shanks_phase(cosine,g):
    """Cornette & Shanks phase shape; its integral is 4pi, Rayleigh at g=0.

    Here g is the analytic shape parameter, not the exact first moment. That
    moment is 3*g*(4+g*g)/(5*(2+g*g)); do not label this an aerosol retrieval.
    """
    if not np.isfinite(g) or not 0 <= g < .98:
        raise ValueError('Scattering asymmetry must be in [0, .98)')
    c=np.clip(cosine,-1,1)
    return 1.5*(1-g*g)/(2+g*g)*(1+c*c)/(1+g*g-2*g*c)**1.5


@lru_cache(maxsize=16)
def _angular_cells(n_mu,n_phi):
    """Fine integration inside each solid-angle cell of the coarse field."""
    _,polar_weights=np.polynomial.legendre.leggauss(n_mu)
    edges=np.r_[-1.,-1.+np.cumsum(polar_weights)]
    nodes,weights=np.polynomial.legendre.leggauss(12)
    directions=[];measures=[]
    for lo,hi in zip(edges[:-1],edges[1:]):
        mu=(lo+hi)/2+nodes*(hi-lo)/2
        for j in range(n_phi):
            phi=(j+.5)*2*np.pi/n_phi+nodes*np.pi/n_phi
            m,p=np.meshgrid(mu,phi,indexing='ij')
            directions.append(np.stack([np.sqrt(1-m*m)*np.sin(p),
                                        np.sqrt(1-m*m)*np.cos(p),m],axis=-1).reshape(-1,3))
            measures.append(np.outer(weights,weights).ravel()*(hi-lo)/2*np.pi/n_phi)
    return np.asarray(directions),np.asarray(measures)


def phase_on_angular_cells(n_mu,n_phi,axis,kind,g=0.):
    """Deposit a continuous beam into integrated angular cells, not a bin peak."""
    cells,measure=_angular_cells(n_mu,n_phi)
    _,weights=angular_quadrature(n_mu,n_phi)
    cosine=np.clip(cells@np.asarray(axis),-1,1)
    phase=rayleigh_phase(cosine) if kind=='rayleigh' else cornette_shanks_phase(cosine,g)
    probability=np.sum(phase*measure,axis=1)/(4*np.pi)
    return probability/(probability.sum()*weights)


@lru_cache(maxsize=64)
def scattering_matrix(n_mu,n_phi,kind,g=0.):
    """Conserve quadrature energy and reciprocity, including forward lobes.

    Symmetric balancing fixes discrete normalization, not angular resolution:
    refinement is still needed to resolve a narrow forward lobe.
    """
    directions,weights=angular_quadrature(n_mu,n_phi)
    cosine=np.clip(directions@directions.T,-1,1)
    if kind=='rayleigh':
        raw=rayleigh_phase(cosine)/(4*np.pi)
    else:
        # Integrate narrow lobes inside angular cells. Nodal sampling followed
        # by normalization alone would assign too much to the forward diagonal.
        cells,measure=_angular_cells(n_mu,n_phi)
        cosine=np.clip(np.einsum('id,jsd->ijs',directions,cells),-1,1)
        raw=np.sum(cornette_shanks_phase(cosine,g)*measure[None,:,:],axis=-1)
        raw/=4*np.pi*weights[None,:]
        raw=.5*(raw+raw.T)
    scale=np.ones(len(weights))
    for _ in range(1000):
        rows=scale*(raw@(weights*scale))
        if np.max(np.abs(rows-1))<1e-12:
            break
        scale/=np.sqrt(rows)
    else:
        raise TransportConvergenceError('Angular normalization did not converge')
    kernel=raw*scale[:,None]*scale[None,:]*weights[None,:]
    kernel.setflags(write=False)
    return kernel


@njit
def transport_sweep(source, extinction, x_widths, y_widths, z_widths,
                    directions, bottom, top):
    """First-order upwind finite-volume sweep, vacuum lateral boundaries.

    Every cell equation conserves inflow + source = outflow + extinction.
    The method is positive for arbitrary optical cell depths.
    """
    nz,ny,nx,nd,nc=source.shape
    result=np.zeros_like(source)
    for d in range(nd):
        vx,vy,vz=directions[d]
        xs,xe,xi=(0,nx,1) if vx>=0 else (nx-1,-1,-1)
        ys,ye,yi=(0,ny,1) if vy>=0 else (ny-1,-1,-1)
        zs,ze,zi=(0,nz,1) if vz>=0 else (nz-1,-1,-1)
        for k in range(zs,ze,zi):
            az=abs(vz)/z_widths[k]
            for j in range(ys,ye,yi):
                ay=abs(vy)/y_widths[j]
                for i in range(xs,xe,xi):
                    ax=abs(vx)/x_widths[i]
                    denominator=extinction[k,j,i]+ax+ay+az
                    for channel in range(nc):
                        value=source[k,j,i,d,channel]
                        if 0<=i-xi<nx:
                            value+=ax*result[k,j,i-xi,d,channel]
                        if 0<=j-yi<ny:
                            value+=ay*result[k,j-yi,i,d,channel]
                        if 0<=k-zi<nz:
                            value+=az*result[k-zi,j,i,d,channel]
                        elif vz>0:
                            value+=az*bottom[j,i,d,channel]
                        else:
                            value+=az*top[j,i,d,channel]
                        result[k,j,i,d,channel]=value/denominator
    return result


@lru_cache(maxsize=8)
def _wavefronts(nz,ny,nx):
    coordinates=np.indices((nz,ny,nx)).reshape(3,-1)
    level=coordinates.sum(axis=0)
    return tuple(coordinates[:,level==value] for value in range(nz+ny+nx-2))


def transport_sweep_numpy(source,extinction,x_widths,y_widths,z_widths,directions,bottom,top):
    """Same upwind equation in NumPy wavefronts for Android/iOS without JIT.

    Cells on one sweep diagonal are independent. All directions and source
    channels are advanced together; this changes execution, not the physics.
    """
    nz,ny,nx,nd,_=source.shape
    result=np.zeros_like(source);d=np.arange(nd)[None,:]
    signs=np.where(directions>=0,1,-1)
    for bk,bj,bi in _wavefronts(nz,ny,nx):
        i=np.where(signs[None,:,0]>0,bi[:,None],nx-1-bi[:,None])
        j=np.where(signs[None,:,1]>0,bj[:,None],ny-1-bj[:,None])
        k=np.where(signs[None,:,2]>0,bk[:,None],nz-1-bk[:,None])
        ax=np.abs(directions[None,:,0])/x_widths[i]
        ay=np.abs(directions[None,:,1])/y_widths[j]
        az=np.abs(directions[None,:,2])/z_widths[k]
        value=source[k,j,i,d,:].copy()
        for base,coefficient,axis in [(bi,ax,0),(bj,ay,1),(bk,az,2)]:
            mask=base>0
            if np.any(mask):
                pi=i[mask]-(signs[None,:,0] if axis==0 else 0)
                pj=j[mask]-(signs[None,:,1] if axis==1 else 0)
                pk=k[mask]-(signs[None,:,2] if axis==2 else 0)
                value[mask]+=coefficient[mask,:,None]*result[pk,pj,pi,d,:]
        boundary=bk==0
        if np.any(boundary):
            illumination=np.where((directions[:,2]>0)[None,:,None],
                                  bottom[j[boundary],i[boundary],d,:],top[j[boundary],i[boundary],d,:])
            value[boundary]+=az[boundary,:,None]*illumination
        result[k,j,i,d,:]=value/(extinction[k,j,i]+ax+ay+az)[...,None]
    return result


def scattering_source(field,coefficients,kernels,channel_transitions=None):
    """Integrate radiance from all incident directions separately by species."""
    result=np.zeros_like(field)
    transitions=channel_transitions or {}
    for species,(coefficient,kernel) in enumerate(zip(coefficients,kernels)):
        incoming=np.einsum('...jc,ij->...ic',field,kernel,optimize=True)
        for origin,destination in transitions.get(species,()):
            incoming[...,destination]+=incoming[...,origin]
            incoming[...,origin]=0
        result+=np.asarray(coefficient)[...,None,None]*incoming
    return result


@dataclass
class TransportSolution:
    radiance: np.ndarray
    unscattered: np.ndarray
    first_order: np.ndarray
    diagnostics: dict


def solve_transport(extinction, scattering_coefficients, kernels,
                    x_edges,y_edges,z_edges,directions,weights,bottom,top,
                    external_first_source=None,ground_albedo=.15,
                    tolerance=.003,max_orders=512,require_convergence=True,channel_transitions=None):
    """Sum actual directional scattering orders instead of a fitted multiplier.

    The geometric tail estimate is an observed convergence diagnostic, not the
    analytical truncation-error guarantee of MSOS-LP1. No unresolved tail is
    multiplied onto the answer. Spatial/angular convergence needs refinement.
    """
    beta=np.asarray(extinction,dtype=float)
    if beta.ndim!=3 or not np.isfinite(beta).all() or np.any(beta<0):
        raise ValueError('Invalid 3-D extinction')
    if not 0<=ground_albedo<1 or not 0<tolerance<1 or max_orders<2:
        raise ValueError('Invalid transport controls')
    coefficients=[np.broadcast_to(np.asarray(v,dtype=float),beta.shape) for v in scattering_coefficients]
    if any(not np.isfinite(v).all() or np.any(v<0) for v in coefficients):
        raise ValueError('Invalid scattering coefficient')
    if np.any(sum(coefficients)>beta+1e-12):
        raise ValueError('Scattering exceeds extinction')
    widths=[np.diff(np.asarray(e,dtype=float)) for e in (x_edges,y_edges,z_edges)]
    if any(not np.isfinite(v).all() or np.any(v<=0) for v in widths):
        raise ValueError('Grid edges must increase')
    nz,ny,nx=beta.shape;nd=len(weights);nc=bottom.shape[-1]
    if tuple(map(len,widths))!=(nx,ny,nz) or bottom.shape!=(ny,nx,nd,nc) or top.shape!=bottom.shape:
        raise ValueError('Inconsistent transport shapes')
    if np.any(bottom<0) or np.any(top<0) or not np.isfinite(bottom).all() or not np.isfinite(top).all():
        raise ValueError('Invalid boundary illumination')
    shape=(nz,ny,nx,nd,nc)
    zero=np.zeros(shape);blank=np.zeros_like(bottom)
    # The mobile adapter replaces njit with the ordinary Python function.
    # Avoid millions of Python cell loops there by using identical wavefronts.
    sweep=transport_sweep_numpy if getattr(transport_sweep,'py_func',None) is transport_sweep else transport_sweep
    direct=sweep(zero,beta,*widths,directions,bottom,top)
    previous=direct;total=direct.copy();first=None
    external=np.zeros(shape) if external_first_source is None else np.asarray(external_first_source,dtype=float)
    if external.shape!=shape or np.any(external<0) or not np.isfinite(external).all():
        raise ValueError('Invalid external beam scattering source')
    down=directions[:,2]<0
    horizontal_weights=np.where(down,-directions[:,2]*weights,0)
    volume=widths[2][:,None,None]*widths[1][None,:,None]*widths[0][None,None,:]
    measure=volume[...,None,None]*weights[None,None,None,:,None]
    fractions=[];previous_norm=None;ratios=[];converged=False;tail=None
    for order in range(1,max_orders+1):
        source=scattering_source(previous,coefficients,kernels,channel_transitions)
        if order==1:
            source+=external
        irradiance=np.einsum('yidc,d->yic',previous[0],horizontal_weights)
        reflected=np.repeat((ground_albedo/np.pi*irradiance)[:,:,None,:],nd,axis=2)
        next_field=sweep(source,beta,*widths,directions,reflected,blank)
        if order==1:
            first=next_field.copy()
        total+=next_field
        norms=np.sum(next_field*measure,axis=(0,1,2,3))
        denominators=np.maximum(np.sum(total*measure,axis=(0,1,2,3)),1e-30)
        channel_fractions=norms/denominators
        fraction=float(np.max(channel_fractions));fractions.append(fraction)
        ratio=(np.divide(norms,previous_norm,out=np.zeros_like(norms),where=previous_norm>0)
               if previous_norm is not None else np.ones_like(norms))
        ratios.append(ratio)
        if len(ratios)>=4 and np.max(ratios[-4:])<1:
            r=np.max(ratios[-4:],axis=0)
            channel_tails=channel_fractions*r/np.maximum(1-r,1e-15)
            tail=float(np.max(channel_tails))
            if order>=5 and tail<tolerance and max(fractions[-3:])<tolerance:
                converged=True;break
        if np.max(norms)==0:
            converged=True;tail=0.;break
        previous=next_field;previous_norm=norms
    info={'scattering_orders':order,'converged':converged,'last_order_fraction':fractions[-1],
          'observed_tail_fraction_estimate':tail,'requested_order_tolerance':tolerance,
          'spatial_grid_shape':[nz,ny,nx],'angular_directions':nd,
          'order_fractions':fractions,'order_ratios':[v.tolist() for v in ratios],
          'last_order_fraction_by_channel':channel_fractions.tolist(),
          'convergence_scope':'Each source channel independently; a bright Moon cannot hide unconverged artificial light.',
          'error_scope':'Observed scattering-order convergence; not a spatial/angular error bound or exact MSOS-LP1 guarantee.',
          'method':'3-D upwind finite-volume discrete ordinates; positive successive-order summation',
          'lateral_boundary':'vacuum','ground_reflection':'Lambertian',
          'single_global_multiplier_used':False}
    if require_convergence and not converged:
        raise TransportConvergenceError(f'Scattering orders did not converge after {order} orders; '
                                        f'estimated tail={tail}, required={tolerance}',info)
    return TransportSolution(total,direct,first,info)
