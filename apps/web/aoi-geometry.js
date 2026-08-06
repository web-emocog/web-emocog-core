(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmocogAoiGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN_SIZE = 0.0005;

  function rounded(value) {
    return Math.round(value * 10000) / 10000;
  }

  function normalizePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return null;
    }
    return { x: rounded(x), y: rounded(y) };
  }

  function orientation(a, b, c) {
    const cross = ((b.y - a.y) * (c.x - b.x)) - ((b.x - a.x) * (c.y - b.y));
    if (Math.abs(cross) < 1e-10) return 0;
    return cross > 0 ? 1 : 2;
  }

  function onSegment(a, b, c) {
    return b.x <= Math.max(a.x, c.x) + 1e-10
      && b.x + 1e-10 >= Math.min(a.x, c.x)
      && b.y <= Math.max(a.y, c.y) + 1e-10
      && b.y + 1e-10 >= Math.min(a.y, c.y);
  }

  function segmentsIntersect(a, b, c, d) {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(a, c, b)) return true;
    if (o2 === 0 && onSegment(a, d, b)) return true;
    if (o3 === 0 && onSegment(c, a, d)) return true;
    if (o4 === 0 && onSegment(c, b, d)) return true;
    return false;
  }

  function polygonArea(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
      const next = points[(index + 1) % points.length];
      sum += (points[index].x * next.y) - (next.x * points[index].y);
    }
    return Math.abs(sum) / 2;
  }

  function isSelfIntersecting(points) {
    const count = points.length;
    for (let left = 0; left < count; left += 1) {
      const leftNext = (left + 1) % count;
      for (let right = left + 1; right < count; right += 1) {
        const rightNext = (right + 1) % count;
        if (left === right || leftNext === right || rightNext === left) continue;
        if (left === 0 && rightNext === 0) continue;
        if (segmentsIntersect(points[left], points[leftNext], points[right], points[rightNext])) return true;
      }
    }
    return false;
  }

  function normalizeGeometry(shape, sourcePoints) {
    if (shape !== 'rectangle' && shape !== 'polygon') {
      return { ok: false, code: 'aoi_shape_invalid' };
    }
    if (!Array.isArray(sourcePoints)) return { ok: false, code: 'aoi_points_invalid' };
    const points = sourcePoints.map(normalizePoint);
    if (points.some(point => point == null)) return { ok: false, code: 'aoi_coordinate_invalid' };

    if (shape === 'rectangle') {
      if (points.length !== 2) return { ok: false, code: 'aoi_rectangle_points_invalid' };
      const minX = Math.min(points[0].x, points[1].x);
      const minY = Math.min(points[0].y, points[1].y);
      const maxX = Math.max(points[0].x, points[1].x);
      const maxY = Math.max(points[0].y, points[1].y);
      if (maxX - minX < MIN_SIZE || maxY - minY < MIN_SIZE) {
        return { ok: false, code: 'aoi_rectangle_empty' };
      }
      return { ok: true, points: [{ x: minX, y: minY }, { x: maxX, y: maxY }] };
    }

    if (points.length < 3) return { ok: false, code: 'aoi_polygon_points_invalid' };
    const unique = new Set(points.map(point => `${point.x}:${point.y}`));
    if (unique.size !== points.length) {
      return { ok: false, code: 'aoi_polygon_empty' };
    }
    if (isSelfIntersecting(points)) return { ok: false, code: 'aoi_polygon_self_intersection' };
    if (polygonArea(points) < MIN_SIZE * MIN_SIZE) return { ok: false, code: 'aoi_polygon_empty' };
    return { ok: true, points };
  }

  return {
    MIN_SIZE,
    normalizeGeometry,
    polygonArea,
    isSelfIntersecting
  };
});
