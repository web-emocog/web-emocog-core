// Original local experiment, informed by Timm & Barth (VISAPP 2011).
// No upstream code/weights. All eye images are transient; never export them.
import { getFramePixels } from '../session-runtime/frame-pixels.mjs';

export const EYE_GRADIENT_METHOD = 'eye_gradient_iris.experimental.v1';
export const EYE_GRADIENT_ALL_METHOD = 'eye_gradient_all_iris.experimental.v1';
export const EYE_GRADIENT_LENGTH = 4;
export const EYE_GRADIENT_SPEC = Object.freeze({ columns: 40, rows: 24,
    widthInCanthalWidths: 1, heightInCanthalWidths: .6,
    gradient: 'central_difference_binomial_3', support: 'lateral',
    magnitude: 'mean_plus_half_sd', centerWeight: 'inverted_smoothed_quantile_range',
    search: 'stride2_then_5x5', refinement: 'separate_axis_parabolic', targetsUsed: false });

// Small, image-independent lattice kernel: no participant data or frame history.
// The scoring lattice is integer-valued until the final subpixel refinement.
const kernelWidth = 2*EYE_GRADIENT_SPEC.columns+1;
const inverseDistance2 = new Float64Array(kernelWidth*(2*EYE_GRADIENT_SPEC.rows+1));
for(let dy=-EYE_GRADIENT_SPEC.rows;dy<=EYE_GRADIENT_SPEC.rows;dy++)
    for(let dx=-EYE_GRADIENT_SPEC.columns;dx<=EYE_GRADIENT_SPEC.columns;dx++) {
        const d2=dx*dx+dy*dy;
        inverseDistance2[(dy+EYE_GRADIENT_SPEC.rows)*kernelWidth+dx+EYE_GRADIENT_SPEC.columns]=d2?1/d2:0;
    }

function gray(data, width, x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const at = (px, py) => {
        const i = 4 * (py * width + px);
        return (.299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]) / 255;
    };
    return (1 - fy) * ((1 - fx) * at(ix, iy) + fx * at(ix + 1, iy))
        + fy * ((1 - fx) * at(ix, iy + 1) + fx * at(ix + 1, iy + 1));
}

function eyeGrid(pixels, a, b) {
    const { width, height, data } = pixels, spec = EYE_GRADIENT_SPEC;
    if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return null;
    let ux = (b.x - a.x) * width, uy = (b.y - a.y) * height;
    const size = Math.hypot(ux, uy); if (size < 1) return null;
    ux /= size; uy /= size; if (ux < 0) { ux = -ux; uy = -uy; }
    const cx = (a.x + b.x) * width / 2, cy = (a.y + b.y) * height / 2;
    const values = new Float64Array(spec.columns * spec.rows);
    for (let row = 0; row < spec.rows; row++) for (let col = 0; col < spec.columns; col++) {
        const u = ((col + .5) / spec.columns - .5) * spec.widthInCanthalWidths * size;
        const v = ((row + .5) / spec.rows - .5) * spec.heightInCanthalWidths * size;
        const x = cx + u * ux - v * uy, y = cy + u * uy + v * ux;
        if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return null;
        values[row * spec.columns + col] = gray(data, width, x, y);
    }
    return values;
}

function locateCenter(values, support) {
    const { columns: w, rows: h } = EYE_GRADIENT_SPEC;
    const smooth = values.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
            sum += values[(y + dy) * w + x + dx] * (dy === 0 ? 2 : 1) * (dx === 0 ? 2 : 1);
        smooth[y * w + x] = sum / 16;
    }
    const sorted = Array.from(smooth).sort((a,b) => a-b);
    const lo = sorted[Math.floor(sorted.length * .1)], hi = sorted[Math.floor(sorted.length * .9)];
    if (hi - lo < 1e-6) return null;
    const gradients = [];
    let sum = 0, sum2 = 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
        const gx = (smooth[y * w + x + 1] - smooth[y * w + x - 1]) / 2;
        const gy = (smooth[(y + 1) * w + x] - smooth[(y - 1) * w + x]) / 2;
        const magnitude = Math.hypot(gx, gy);
        gradients.push({ x, y, gx, gy, magnitude }); sum += magnitude; sum2 += magnitude * magnitude;
    }
    const mean = sum / gradients.length, sd = Math.sqrt(Math.max(0, sum2 / gradients.length - mean * mean));
    const threshold = mean + .5 * sd;
    const strong = gradients.filter(g => g.magnitude > Math.max(threshold, 1e-8))
        .map(g => ({ x: g.x, y: g.y, gx: g.gx / g.magnitude, gy: g.gy / g.magnitude }));
    if (strong.length < 8) return null;
    // Reject a one-dimensional stripe: it cannot identify a 2D eye center.
    const xx = strong.reduce((s,g) => s+g.gx*g.gx,0), yy = strong.reduce((s,g) => s+g.gy*g.gy,0);
    const xy = strong.reduce((s,g) => s+g.gx*g.gy,0);
    if ((xx*yy-xy*xy)/(strong.length*strong.length) < 1e-5) return null;
    // Our lateral-support ablation suppresses near-horizontal lid boundaries.
    // It is NOT claimed to reproduce the paper or to be lid/occlusion invariant.
    const votes = support === 'lateral' ? strong.filter(g => Math.abs(g.gx) >= .35) : strong;
    if (votes.length < 8) return null;
    const scores = new Float64Array(w * h);
    let maximum = -Infinity, bestX = -1, bestY = -1;
    const minX = 5, maxX = w - 6, minY = 3, maxY = h - 4;
    const scoreAt = (x,y) => {
        const darkness = Math.max(0,Math.min(1,(hi-smooth[y*w+x])/(hi-lo)));
        let score = 0;
        // Zero-weight candidates have exactly zero objective. Skip their votes,
        // not any input frame or calibration/validation observation.
        if(darkness>0)for (const g of votes) {
            const dx = g.x-x, dy = g.y-y, dot=dx*g.gx+dy*g.gy;
            if(dot>0)score+=dot*dot*inverseDistance2[(dy+h)*kernelWidth+dx+w];
        }
        score = score/votes.length*darkness;
        scores[y*w+x] = score;
        return score;
    };
    // Coarse-to-fine optimization of this image-only objective, not a target
    // prior. It can miss another local maximum; the negative benchmark includes
    // glare/occlusion and is not grounds for scientific promotion.
    for (let y = minY; y <= maxY; y+=2) for (let x = minX; x <= maxX; x+=2) {
        const score=scoreAt(x,y);
        if (score > maximum) { maximum = score; bestX = x; bestY = y; }
    }
    const coarseX=bestX,coarseY=bestY;
    for(let y=Math.max(minY,coarseY-2);y<=Math.min(maxY,coarseY+2);y++)
        for(let x=Math.max(minX,coarseX-2);x<=Math.min(maxX,coarseX+2);x++) {
            const score=scoreAt(x,y);
            if(score>maximum){maximum=score;bestX=x;bestY=y;}
        }
    // A constrained border maximum is not a measured center. No coordinate clamp.
    if (!(maximum > 0) || bestX === minX || bestX === maxX || bestY === minY || bestY === maxY) return null;
    const refine = (a,b,c) => {
        const curvature = a-2*b+c;
        return curvature < -1e-12 ? Math.max(-.5,Math.min(.5,.5*(a-c)/curvature)) : 0;
    };
    const at = bestY*w+bestX;
    scoreAt(bestX-1,bestY);scoreAt(bestX+1,bestY);scoreAt(bestX,bestY-1);scoreAt(bestX,bestY+1);
    const x = bestX + refine(scores[at-1],scores[at],scores[at+1]);
    const y = bestY + refine(scores[at-w],scores[at],scores[at+w]);
    return [2*((x+.5)/w-.5)*EYE_GRADIENT_SPEC.widthInCanthalWidths,
        2*((y+.5)/h-.5)*EYE_GRADIENT_SPEC.heightInCanthalWidths];
}

export function extractEyeGradientFeatures(pixels, landmarks, { support = 'lateral' } = {}) {
    const { width, height, data } = pixels || {};
    if (![width,height].every(v => Number.isSafeInteger(v) && v > 1 && v <= 16384)
        || !(data instanceof Uint8ClampedArray || data instanceof Uint8Array)
        || data.length !== width*height*4 || !Array.isArray(landmarks) || landmarks.length < 478
        || !['all','lateral'].includes(support)) return null;
    const result = [];
    for (const [a,b] of [[362,263],[133,33]]) {
        const grid = eyeGrid(pixels,landmarks[a],landmarks[b]);
        if (!grid) return null;
        const center = locateCenter(grid,support);
        if (!center) return null;
        result.push(...center);
    }
    return result;
}

export function eyeGradientFeaturesForFrame(frame, options) {
    const pixels = getFramePixels(frame);
    if (!pixels || pixels.width !== frame?.frameSize?.width || pixels.height !== frame?.frameSize?.height) return null;
    return extractEyeGradientFeatures(pixels,frame.landmarks,options);
}
