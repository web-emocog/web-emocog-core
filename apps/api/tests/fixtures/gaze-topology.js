// Synthetic geometry using MediaPipe's ANATOMICAL left/right indexing.
// Not a recording or a webcam-accuracy benchmark. Do not derive from app constants:
// that would reproduce an accidental left/right swap in the oracle.
function landmarksForGaze(x, y, { leftShiftX = 0, leftShiftY = 0, roll = 0, scale = 1 } = {}) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const put = (id, x, y) => { points[id] = { x, y }; };
  const eye = (cx, cy, width, height, inner, outer, top, bottom, iris, direction) => {
    put(inner, cx - direction * width / 2, cy);
    put(outer, cx + direction * width / 2, cy);
    put(top, cx, cy - height / 2);
    put(bottom, cx, cy + height / 2);
    const ix = cx + x * width / 2, iy = cy + y * height / 2;
    for (const [offset, dx, dy] of [[0, 0, 0], [1, -.004, 0], [2, 0, -.004], [3, .004, 0], [4, 0, .004]]) {
      put(iris + offset, ix + dx, iy + dy);
    }
  };
  eye(.65 + leftShiftX, .45 + leftShiftY, .11, .045, 362, 263, 386, 374, 473, 1);
  eye(.35, .45, .13, .05, 133, 33, 159, 145, 468, -1);
  for (const [id, x, y] of [[1, .5, .58], [234, .2, .5], [454, .8, .5], [10, .5, .2], [152, .5, .85]]) put(id, x, y);
  return points.map(point => ({
    x: .5 + scale * ((point.x - .5) * Math.cos(roll) - (point.y - .5) * Math.sin(roll)),
    y: .5 + scale * ((point.x - .5) * Math.sin(roll) + (point.y - .5) * Math.cos(roll)),
  }));
}
// Change only lids, not iris/corners/head. Synthetic nuisance intervention,
// not a claim that real eyelids/landmarks move this way.
function changeEyelids(points, { factor = 1, centerShift = 0, leftFactor = factor, rightFactor = factor } = {}) {
  const changed = points.map(point => ({ ...point }));
  for (const [top, bottom, aperture] of [[386, 374, leftFactor], [159, 145, rightFactor]]) {
    const center = (points[top].y + points[bottom].y) / 2 + centerShift;
    const height = (points[bottom].y - points[top].y) * aperture;
    changed[top].y = center - height / 2; changed[bottom].y = center + height / 2;
  }
  return changed;
}
module.exports = { landmarksForGaze, changeEyelids };
