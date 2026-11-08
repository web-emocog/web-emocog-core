// Explicit local experiment, Apache-2.0. No external model/data/code imported.
// Corners determine the sampling grid; iris/lids/head/targets never select
// pixel intensities or pull the image towards a predicted/known gaze point.
import { getFramePixels } from '../session-runtime/frame-pixels.mjs';
export const EYE_TOPHAT_METHOD = 'eye_tophat_ridge.experimental.v1';
export const EYE_TOPHAT_LENGTH = 320;
export const ROW_PATCH_SPEC = Object.freeze({ columns: 32, rows: 20, width: .8, height: .5,
  pooling: 2, closingRadius: 6, backgrounds: Object.freeze(['raw', 'row_contrast', 'row_tophat']) });
export const EYE_TOPHAT_SPEC = Object.freeze({ columns: 32, rows: 20, widthInCanthalWidths: .8,
  heightInCanthalWidths: .5, pooling: 2, closingRadius: 6, boundary: 'replicated_original_row',
  normalization: 'horizontal_black_tophat_then_per_eye_mean_contrast_floor_0.04' });

// Horizontal grayscale closing. Replicate boundary intensity, never pad a
// missing camera crop; subtracting the original yields a black top-hat.
// This rejects a dark region connected to a row end, not a target coordinate.
export function horizontalClosing(row, radius) {
  if (!(row instanceof Float64Array) || !row.length || !row.every(Number.isFinite)
    || !Number.isInteger(radius) || radius < 1 || radius >= row.length) return null;
  const n = row.length, dilated = new Float64Array(n+2*radius), result = new Float64Array(n);
  // Extend the ORIGINAL row before both operations. Clamping the intermediate
  // dilation instead could spuriously fill a dark feature touching the edge.
  for (let i=-radius;i<n+radius;i++) {
    let maximum=-Infinity;
    for(let j=i-radius;j<=i+radius;j++)maximum=Math.max(maximum,row[Math.max(0,Math.min(n-1,j))]);
    dilated[i+radius]=maximum;
  }
  for(let i=0;i<n;i++) {
    let minimum=Infinity;
    for(let j=i;j<=i+2*radius;j++)minimum=Math.min(minimum,dilated[j]);
    result[i]=minimum;
  }
  return result;
}

export function eyeTophatFeaturesForFrame(frame) {
  const pixels = getFramePixels(frame);
  if (!pixels || pixels.width !== frame?.frameSize?.width || pixels.height !== frame?.frameSize?.height) return null;
  return extractRowPatch(pixels, frame.landmarks, 'row_tophat');
}

function gray(data, width, x, y) {
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const at=(u,v)=>{const i=4*(v*width+u);return (.299*data[i]+.587*data[i+1]+.114*data[i+2])/255;};
  return (1-fy)*((1-fx)*at(ix,iy)+fx*at(ix+1,iy))+fy*((1-fx)*at(ix,iy+1)+fx*at(ix+1,iy+1));
}

export function extractRowPatch(pixels, landmarks, mode='row_contrast') {
  const {width,height,data}=pixels||{}, s=ROW_PATCH_SPEC;
  if(![width,height].every(v=>Number.isSafeInteger(v)&&v>1&&v<=16384)
    ||!(data instanceof Uint8Array||data instanceof Uint8ClampedArray)||data.length!==width*height*4
    ||!Array.isArray(landmarks)||landmarks.length<478||!s.backgrounds.includes(mode))return null;
  const result=[];
  for(const [aId,bId]of [[362,263],[133,33]]) {
    const a=landmarks[aId],b=landmarks[bId];
    if(![a?.x,a?.y,b?.x,b?.y].every(Number.isFinite))return null;
    let ux=(b.x-a.x)*width,uy=(b.y-a.y)*height;
    const size=Math.hypot(ux,uy);if(size<1)return null;
    ux/=size;uy/=size;if(ux<0){ux=-ux;uy=-uy;}
    const cx=(a.x+b.x)*width/2,cy=(a.y+b.y)*height/2,grid=new Float64Array(s.columns*s.rows);
    for(let r=0;r<s.rows;r++)for(let c=0;c<s.columns;c++) {
      const u=((c+.5)/s.columns-.5)*s.width*size,v=((r+.5)/s.rows-.5)*s.height*size;
      const x=cx+u*ux-v*uy,y=cy+u*uy+v*ux;
      if(x<0||y<0||x>=width-1||y>=height-1)return null;
      grid[r*s.columns+c]=gray(data,width,x,y);
    }
    if(mode==='row_contrast')for(let r=0;r<s.rows;r++) {
      const row=grid.slice(r*s.columns,(r+1)*s.columns),sorted=Array.from(row).sort((a,b)=>a-b);
      const background=sorted[Math.floor((s.columns-1)*.75)];
      for(let c=0;c<s.columns;c++)grid[r*s.columns+c]=Math.max(0,background-row[c]);
    }
    if(mode==='row_tophat')for(let r=0;r<s.rows;r++) {
      const row=grid.slice(r*s.columns,(r+1)*s.columns),background=horizontalClosing(row,s.closingRadius);
      for(let c=0;c<s.columns;c++)grid[r*s.columns+c]=Math.max(0,background[c]-row[c]);
    }
    const pooled=[];
    for(let r=0;r<s.rows;r+=2)for(let c=0;c<s.columns;c+=2)pooled.push(
      (grid[r*s.columns+c]+grid[r*s.columns+c+1]+grid[(r+1)*s.columns+c]+grid[(r+1)*s.columns+c+1])/4);
    const mean=pooled.reduce((a,b)=>a+b,0)/pooled.length;
    const sd=Math.sqrt(pooled.reduce((a,v)=>a+(v-mean)**2,0)/pooled.length);
    if(!Number.isFinite(sd)||sd<1e-6)return null;
    for(const v of pooled)result.push((v-mean)/Math.max(sd,.04));
  }
  return result;
}
