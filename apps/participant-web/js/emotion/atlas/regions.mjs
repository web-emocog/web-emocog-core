// Coordinates are in the input image, before any CSS presentation transform.
// This regional QC tests geometry only. A face model can fit an occluded region.
import { mirrorIndex } from './mesh-mirror.mjs';

const inside = n => Number.isFinite(n) && n >= 0 && n <= 1;
const validPad = n => Number.isFinite(n) && n >= 0 && n <= 1;

function readPoint(landmarks, index, mirrored) {
  const point = landmarks?.[mirrored ? mirrorIndex(index) : index];
  return point && inside(point.x) && inside(point.y) ? { x: point.x, y: point.y } : null;
}

function hull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  function boundary(list) {
    const out = [];
    for (const p of list) {
      while (out.length > 1) {
        const a = out[out.length - 2], b = out[out.length - 1];
        if ((b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x) > 0) break;
        out.pop();
      }
      out.push(p);
    }
    return out.slice(0, -1);
  }
  return [...boundary(sorted), ...boundary(sorted.reverse())];
}

function boxFor(points, pad) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs)-x, h = Math.max(...ys)-y;
  return { xMin:Math.max(0, x-w*pad), xMax:Math.min(1, x+w*(1+pad)),
    yMin:Math.max(0, y-h*pad), yMax:Math.min(1, y+h*(1+pad)) };
}

/** Compute hulls and bounding boxes. Input landmarks use MediaPipe-normalised x,y.
 * canonicalCentre uses outer-canthus distance units and a face-fixed axis:
 * +x towards anatomical left and +y down. Corrects image roll/scale, not yaw or pitch.
 * width and height are the actual inference image dimensions. Padding expands boxes
 * for display, never the selected anatomical anchors or the detector's field of view.
 */
export function projectZones(landmarks, zones, {width, height, inputMirrored, paddingFraction=0.08, zonePadding={}}={}) {
  if (!Array.isArray(zones)) throw new TypeError('zones must be an array');
  if (!validPad(paddingFraction)) throw new RangeError('paddingFraction must be in [0,1]');
  const ids = new Set(zones.map(z => z.id));
  for (const [id, pad] of Object.entries(zonePadding)) {
    if (!ids.has(id) || !validPad(pad)) throw new RangeError('Invalid zonePadding: '+id);
  }
  const result = { valid:false, reason:null, zones:{}, zoneQuality:{}, boxes:{}, reasons:{} };
  const mirrored = inputMirrored === true;
  const right = readPoint(landmarks, 33, mirrored), left = readPoint(landmarks, 263, mirrored);
  let ref;
  if (typeof inputMirrored !== 'boolean') result.reason = 'unknown_input_parity';
  else if (![width,height].every(n=>Number.isFinite(n)&&n>0)) result.reason = 'missing_frame_dimensions';
  else if (!left || !right) result.reason = 'missing_eye_reference';
  else {
    const dx = (left.x-right.x)*width, dy=(left.y-right.y)*height;
    const span = Math.hypot(dx,dy);
    if (span < 1) result.reason = 'degenerate_eye_reference';
    else ref = {ux:dx/span, uy:dy/span, span, x:(left.x+right.x)/2, y:(left.y+right.y)/2};
  }
  for (const zone of zones) {
    const groups = zone.anchorGroups ?? [zone.anchors];
    const points = (zone.anchors ?? []).map(i=>readPoint(landmarks,i,mirrored));
    let reason = result.reason;
    if (!reason && (!points.length || points.some(p=>!p))) reason = 'missing_or_outside_anchor';
    if (!reason && !groups.every(g=>g.length>=3 && g.every(i=>zone.anchors.includes(i)))) reason='invalid_anchor_group';
    // Fully closed eyes can have nearly collinear boundaries. Their horizontal
    // extent remains visible; do not systematically censor closed eyes.
    if (!reason) {
      const collapsed = groups.some(group => {
        const anchor = readPoint(landmarks, group[0], mirrored);
        return group.every(index => {
          const p = readPoint(landmarks, index, mirrored);
          return p.x === anchor.x && p.y === anchor.y;
        });
      });
      if (collapsed) reason = 'collapsed_zone';
    }
    result.zoneQuality[zone.id] = !reason;
    result.reasons[zone.id] = reason ? [reason] : [];
    if (reason) {
      result.zones[zone.id] = {valid:false, reason};
      continue;
    }
    const pad = zonePadding[zone.id] ?? paddingFraction;
    const centre = {x:points.reduce((s,p)=>s+p.x,0)/points.length, y:points.reduce((s,p)=>s+p.y,0)/points.length};
    const dx=(centre.x-ref.x)*width/ref.span, dy=(centre.y-ref.y)*height/ref.span;
    const axisDown = mirrored ? -1 : 1;
    const canonicalCentre = {x:dx*ref.ux+dy*ref.uy, y:axisDown*(-dx*ref.uy+dy*ref.ux)};
    const polygons=groups.map(g=>hull(g.map(i=>readPoint(landmarks,i,mirrored))));
    const box=boxFor(points,pad);
    result.boxes[zone.id]=box;
    result.zones[zone.id]={valid:true,reason:null,box,centre,canonicalCentre,
      polygons,groupBoxes:polygons.map(p=>boxFor(p,pad))};
  }
  result.valid = Boolean(ref) && Object.values(result.zoneQuality).some(Boolean);
  if (!result.valid && !result.reason) result.reason='no_valid_zones';
  return result;
}

export function assessZones(catalog, landmarks, options) {
  return projectZones(landmarks,catalog.zones,options);
}
