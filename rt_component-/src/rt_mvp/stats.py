from __future__ import annotations
from typing import List, Optional
import math

def mean(xs: List[float]) -> Optional[float]:
    if not xs: return None
    s=0.0
    for x in xs: s+=x
    return s/len(xs)

def median(xs: List[float]) -> Optional[float]:
    if not xs: return None
    ys=sorted(xs); n=len(ys); m=n//2
    return ys[m] if n%2==1 else 0.5*(ys[m-1]+ys[m])

def variance_sample(xs: List[float]) -> Optional[float]:
    n=len(xs)
    if n<2: return None
    m=mean(xs); assert m is not None
    s=0.0
    for x in xs:
        d=x-m; s+=d*d
    return s/(n-1)

def std_sample(xs: List[float]) -> Optional[float]:
    v=variance_sample(xs)
    return None if v is None else math.sqrt(v)

def coefficient_of_variation(xs: List[float]) -> Optional[float]:
    m=mean(xs); sd=std_sample(xs)
    if m is None or sd is None or m==0: return None
    return sd/m

def pearson_r(x: List[float], y: List[float]) -> Optional[float]:
    if len(x)!=len(y) or len(x)<2: return None
    mx=mean(x); my=mean(y); assert mx is not None and my is not None
    num=0.0; dx2=0.0; dy2=0.0
    for xi,yi in zip(x,y):
        dx=xi-mx; dy=yi-my
        num+=dx*dy; dx2+=dx*dx; dy2+=dy*dy
    den=math.sqrt(dx2*dy2)
    return None if den==0 else num/den

def linear_regression_slope(x: List[float], y: List[float]) -> Optional[float]:
    if len(x)!=len(y) or len(x)<2: return None
    xm=mean(x); ym=mean(y); assert xm is not None and ym is not None
    num=0.0; den=0.0
    for xi,yi in zip(x,y):
        dx=xi-xm
        num+=dx*(yi-ym); den+=dx*dx
    return None if den==0 else num/den

def _inv_norm_cdf_acklam(p: float) -> float:
    a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00]
    b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01]
    c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00]
    d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00]
    plow=0.02425; phigh=1.0-plow
    if p<plow:
        q=math.sqrt(-2.0*math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1.0)
    if p>phigh:
        q=math.sqrt(-2.0*math.log(1.0-p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1.0)
    q=p-0.5; r=q*q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1.0)

def inv_norm_cdf(p: float, eps: float=1e-12) -> float:
    if p<=0.0: p=eps
    if p>=1.0: p=1.0-eps
    return _inv_norm_cdf_acklam(p)
