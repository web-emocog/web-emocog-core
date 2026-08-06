const test = require('node:test');
const assert = require('node:assert/strict');
const geometry = require('../../web/aoi-geometry');
const protocolAoi = require('../../web/aoi-protocol');

test('AOI normalized geometry', async t => {
  await t.test('normalizes a rectangle independently of viewport resolution', () => {
    const result = geometry.normalizeGeometry('rectangle', [
      { x: 0.8, y: 0.7 },
      { x: 0.2, y: 0.1 },
    ]);
    assert.deepEqual(result, {
      ok: true,
      points: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.7 }],
    });
  });

  await t.test('rejects empty, out-of-range and self-intersecting AOIs', () => {
    assert.equal(geometry.normalizeGeometry('rectangle', [{ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.2 }]).ok, false);
    assert.equal(geometry.normalizeGeometry('polygon', [{ x: -0.1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]).ok, false);
    const bowTie = geometry.normalizeGeometry('polygon', [
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 },
    ]);
    assert.equal(bowTie.ok, false);
    assert.equal(bowTie.code, 'aoi_polygon_self_intersection');
  });

  await t.test('accepts a simple polygon', () => {
    const triangle = geometry.normalizeGeometry('polygon', [
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.8 },
    ]);
    assert.equal(triangle.ok, true);
    assert.equal(triangle.points.length, 3);
  });
});

test('AOI protocol round-trip contract', async t => {
  const validAoi = {
    id: 'face', name: 'Face', shape: 'rectangle',
    points: [{ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.8 }],
    order: 1, isTarget: true, validityInterval: { startMs: 0, endMs: 1000 },
  };

  await t.test('copies only AOIs for stimuli referenced by the block', () => {
    const definitions = protocolAoi.buildAoiDefinitions([
      { id: 'cat', aois: [validAoi] },
      { id: 'dog', aois: [{ ...validAoi, id: 'dog-face' }] },
    ], ['cat']);
    assert.deepEqual(Object.keys(definitions), ['cat']);
    assert.equal(definitions.cat[0].id, 'face');
    assert.notEqual(definitions.cat[0], validAoi);
  });

  await t.test('validates version, duplicate ids, intervals and geometry server-side', () => {
    const valid = protocolAoi.validateProtocolAois({
      blocks: [{ id: 'main', blockConfig: {
        aoiSchemaVersion: '1.2', aoiDefinitions: { cat: [validAoi] },
      } }],
    });
    assert.equal(valid.ok, true);

    const invalid = protocolAoi.validateProtocolAois({
      blocks: [{ id: 'main', blockConfig: {
        aoiSchemaVersion: '1.1',
        aoiDefinitions: { cat: [validAoi, { ...validAoi }] },
      } }],
    });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some(error => error.code === 'aoi_schema_version_invalid'));
    assert.ok(invalid.errors.some(error => error.code === 'aoi_id_duplicate'));
  });
});
