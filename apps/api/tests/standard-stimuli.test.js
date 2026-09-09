/**
 * Standard virtual stimulus resolver tests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveStandardStimulus,
  resolveParticipantStimulus,
  normalizeStimulusId,
  parseEmotionFromStdId,
} = require('../../shared/standard-stimuli');

describe('standard-stimuli', () => {
  it('normalizes api: prefix on stimulus ids', () => {
    assert.equal(normalizeStimulusId('api:42'), '42');
    assert.equal(normalizeStimulusId('std_go_green_circle'), 'std_go_green_circle');
  });

  it('resolves simple RT black square', () => {
    const s = resolveStandardStimulus('std_simple_black_square');
    assert.equal(s.type, 'shape');
    assert.equal(s.style.backgroundColor, '#020617');
    assert.equal(s.style.borderRadius, '10px');
  });

  it('resolves go/nogo circles with distinct colors and round shape', () => {
    const go = resolveStandardStimulus('std_go_green_circle');
    const nogo = resolveStandardStimulus('std_nogo_red_circle');
    assert.equal(go.style.borderRadius, '50%');
    assert.equal(nogo.style.borderRadius, '50%');
    assert.notEqual(go.style.backgroundColor, nogo.style.backgroundColor);
  });

  it('prefers image URL over std resolver', () => {
    const s = resolveParticipantStimulus({
      stimulusId: 'std_simple_black_square',
      url: 'https://example.com/custom.png',
    });
    assert.equal(s.type, 'image');
    assert.equal(s.src, 'https://example.com/custom.png');
  });

  it('resolveParticipantStimulus uses std mapping when no url', () => {
    const s = resolveParticipantStimulus({ stimulusId: 'std_nogo_red_circle' });
    assert.equal(s.type, 'shape');
    assert.equal(s.style.backgroundColor, '#dc2626');
  });

  it('returns fallback for unknown ids', () => {
    const s = resolveParticipantStimulus({ stimulusId: 'user_photo_123' });
    assert.equal(s.type, 'shape');
    assert.equal(s.stimulusId, 'user_photo_123');
  });

  it('parses emotion category from std_emo id', () => {
    assert.equal(parseEmotionFromStdId('std_emo_happy_03'), 'happy');
    assert.equal(parseEmotionFromStdId('std_emo_fear_01'), 'fear');
  });

  it('renders distinct emotion face images by id without meta', () => {
    const happy = resolveStandardStimulus('std_emo_happy_02', null, { lang: 'en' });
    const sad = resolveStandardStimulus('std_emo_sad_01', null, { lang: 'en' });
    assert.equal(happy.type, 'image');
    assert.equal(sad.type, 'image');
    assert.match(happy.src, /^data:image\/svg\+xml/);
    assert.match(sad.src, /^data:image\/svg\+xml/);
    assert.notEqual(happy.src, sad.src);
  });
});
