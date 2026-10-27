const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/face-segmenter/mask-reader.mjs')));

function fixture(values) {
  const gl = Object.fromEntries(['READ_FRAMEBUFFER', 'READ_FRAMEBUFFER_BINDING', 'PIXEL_PACK_BUFFER',
    'PIXEL_PACK_BUFFER_BINDING', 'PACK_ROW_LENGTH', 'PACK_SKIP_ROWS', 'PACK_SKIP_PIXELS',
    'COLOR_ATTACHMENT0', 'TEXTURE_2D', 'FRAMEBUFFER_COMPLETE', 'RGBA', 'FLOAT'].map((key, i) => [key, i + 1]));
  gl.NO_ERROR = 0;
  const state = new Map([[gl.READ_FRAMEBUFFER_BINDING, 'previous-fbo'],
    [gl.PIXEL_PACK_BUFFER_BINDING, 'previous-pbo'], [gl.PACK_ROW_LENGTH, 5],
    [gl.PACK_SKIP_ROWS, 1], [gl.PACK_SKIP_PIXELS, 2]]);
  const original = new Map(state);
  let allocated = 0, deleted = 0;
  Object.assign(gl, { isContextLost: () => false, createFramebuffer: () => { allocated++; return {}; },
    deleteFramebuffer() { deleted++; }, getParameter: key => state.get(key),
    bindFramebuffer: (_target, value) => state.set(gl.READ_FRAMEBUFFER_BINDING, value),
    bindBuffer: (_target, value) => state.set(gl.PIXEL_PACK_BUFFER_BINDING, value),
    pixelStorei: (key, value) => state.set(key, value), framebufferTexture2D() {},
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE, getError: () => gl.NO_ERROR,
    readPixels(_x, _y, _w, _h, format, type, out) {
      assert.equal(format, gl.RGBA); assert.equal(type, gl.FLOAT);
      assert.equal(state.get(gl.PIXEL_PACK_BUFFER_BINDING), null);
      assert.equal(state.get(gl.PACK_SKIP_ROWS), 0);
      values.forEach((value, i) => { out[i * 4] = value; out[i * 4 + 1] = 123; });
    } });
  return { gl, state, original, counts: () => ({ allocated, deleted }), mask: {
    width: values.length, height: 1, canvas: { getContext: () => gl },
    hasWebGLTexture: () => true, hasFloat32Array: () => false, hasUint8Array: () => false,
    getAsWebGLTexture: () => ({}),
    getAsFloat32Array() { throw new Error('vendor_readback_must_not_run'); },
    getAsUint8Array() { throw new Error('vendor_readback_must_not_run'); } } };
}

test('GPU readback extracts R exactly and preserves the pinned float32-to-byte conversion', async () => {
  const { MaskReader } = await load(); const reader = new MaskReader();
  const values = [0, 1 / 255, 2 / 255, 5 / 255, .499, 1]; const f = fixture(values);
  const expected = new Float32Array(values);
  assert.deepEqual(reader.floats(f.mask), expected);
  assert.deepEqual(reader.bytes(f.mask), new Uint8Array(expected.map(value => 255 * value)));
  assert.deepEqual(f.state, f.original);
  assert.deepEqual(f.counts(), { allocated: 1, deleted: 0 });
  reader.dispose(); reader.dispose();
  assert.deepEqual(f.counts(), { allocated: 1, deleted: 1 });
});

test('readback restores GL state on incomplete framebuffer, driver error and thrown read', async () => {
  const { MaskReader } = await load();
  for (const failure of ['incomplete', 'driver', 'throw']) {
    const reader = new MaskReader(); const f = fixture([.5]);
    if (failure === 'incomplete') f.gl.checkFramebufferStatus = () => -1;
    if (failure === 'driver') f.gl.getError = () => 1;
    if (failure === 'throw') f.gl.readPixels = () => { throw new Error('read_failure'); };
    assert.throws(() => reader.floats(f.mask), /mask_framebuffer_incomplete|mask_readback_failed|read_failure/);
    assert.deepEqual(f.state, f.original); reader.dispose();
  }
});

test('CPU arrays require no WebGL and scratch storage is reused, bounded and released', async () => {
  const { MaskReader } = await load(); const reader = new MaskReader();
  const bytes = new Uint8Array([1, 2]); const floats = new Float32Array([.1, .2]);
  assert.equal(reader.bytes({ hasUint8Array: () => true, getAsUint8Array: () => bytes }), bytes);
  assert.equal(reader.floats({ hasFloat32Array: () => true, getAsFloat32Array: () => floats }), floats);
  const f = fixture([.5]); const a = reader.floats(f.mask); const b = reader.floats(f.mask);
  assert.equal(a, b);
  assert.throws(() => reader.floats({ ...f.mask, width: Infinity }), /invalid_mask_dimensions/);
  assert.throws(() => reader.floats({ ...f.mask, width: 4_194_305 }), /invalid_mask_dimensions/);
  f.gl.isContextLost = () => true;
  assert.throws(() => reader.floats(f.mask), /mask_webgl_unavailable/);
  reader.dispose(); assert.equal(reader.contexts.size, 0);
});
