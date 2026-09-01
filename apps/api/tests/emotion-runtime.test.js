const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

function makeLandmarks(overrides = {}) {
  const landmarks = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const defaults = {
    234: { x: 0.30, y: 0.50, z: 0 }, 454: { x: 0.70, y: 0.50, z: 0 },
    10: { x: 0.50, y: 0.25, z: 0 }, 152: { x: 0.50, y: 0.75, z: 0 },
    33: { x: 0.42, y: 0.42, z: 0 }, 263: { x: 0.58, y: 0.42, z: 0 },
    159: { x: 0.42, y: 0.40, z: 0 }, 145: { x: 0.42, y: 0.44, z: 0 },
    386: { x: 0.58, y: 0.40, z: 0 }, 374: { x: 0.58, y: 0.44, z: 0 },
    61: { x: 0.44, y: 0.62, z: 0 }, 291: { x: 0.56, y: 0.62, z: 0 },
    13: { x: 0.50, y: 0.61, z: 0 }, 14: { x: 0.50, y: 0.63, z: 0 },
    0: { x: 0.50, y: 0.60, z: 0 }, 17: { x: 0.50, y: 0.65, z: 0 },
    1: { x: 0.50, y: 0.55, z: 0 }, 107: { x: 0.44, y: 0.37, z: 0 },
    336: { x: 0.56, y: 0.37, z: 0 }, 70: { x: 0.38, y: 0.37, z: 0 },
    300: { x: 0.62, y: 0.37, z: 0 }, 117: { x: 0.38, y: 0.52, z: 0 },
    346: { x: 0.62, y: 0.52, z: 0 }, 203: { x: 0.47, y: 0.57, z: 0 },
    423: { x: 0.53, y: 0.57, z: 0 }, 127: { x: 0.35, y: 0.65, z: 0 },
    356: { x: 0.65, y: 0.65, z: 0 },
  };
  Object.entries({ ...defaults, ...overrides }).forEach(([index, point]) => {
    landmarks[Number(index)] = point;
  });
  return landmarks;
}

describe('browser emotion runtime', () => {
  it('abstains when only camera metadata is available', async () => {
    const api = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/public-api.js')).href);
    const sample = api.getEmotionSample({ face: { detected: true }, illumination: { score: 0.95 } });
    assert.equal(sample.dominant, 'unknown');
    assert.equal(sample.emotionInferred, false);
    assert.equal(sample.degraded, true);
    assert.equal(sample.scores.happiness, 0);
  });

  it('calibrates a personal neutral baseline before reporting expression changes', async () => {
    const module = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/emotion-analyzer.js')).href);
    const analyzer = new module.EmotionAnalyzer();
    let result;
    for (let index = 0; index < 18; index += 1) {
      result = analyzer.analyzeLandmarks(makeLandmarks());
      assert.equal(result.dominant, 'neutral');
    }
    assert.equal(result.calibrationReady, true);

    const smile = makeLandmarks({
      61: { x: 0.35, y: 0.59, z: 0 },
      291: { x: 0.65, y: 0.59, z: 0 },
      117: { x: 0.38, y: 0.49, z: 0 },
      346: { x: 0.62, y: 0.49, z: 0 },
    });
    const neutralHappiness = result.scores.happiness;
    for (let index = 0; index < 6; index += 1) result = analyzer.analyzeLandmarks(smile);

    assert.ok(result.scores.happiness > neutralHappiness + 0.15);
    assert.equal(result.dominant, 'happiness');
    assert.ok(result.confidence >= 0.7);
  });

  it('keeps a transient ambiguous surprise score neutral until it is sustained', async () => {
    const module = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/emotion-analyzer.js')).href);
    const analyzer = new module.EmotionAnalyzer();
    analyzer._auBaselineReady = true;
    const scores = {
      neutral: 0.10,
      happiness: 0.03,
      sadness: 0.03,
      anger: 0.03,
      fear: 0.04,
      surprise: 0.70,
      disgust: 0.02,
    };
    assert.equal(analyzer._dominant(scores), 'neutral');
    assert.equal(analyzer._dominant(scores), 'surprise');
    const neutralScores = analyzer._publishScores(scores, 'neutral');
    assert.ok(neutralScores.neutral >= 0.65);
    assert.ok(neutralScores.surprise < neutralScores.neutral);
  });

  it('returns to neutral and reacts to a new sustained expression without sticky output', async () => {
    const module = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/emotion-analyzer.js')).href);
    const analyzer = new module.EmotionAnalyzer();
    analyzer._auBaselineReady = true;
    const happiness = { neutral:0.08, happiness:0.74, sadness:0.03, anger:0.03, fear:0.03, surprise:0.05, disgust:0.04 };
    const anger = { neutral:0.08, happiness:0.02, sadness:0.03, anger:0.76, fear:0.04, surprise:0.03, disgust:0.04 };
    const neutral = { neutral:0.72, happiness:0.06, sadness:0.05, anger:0.04, fear:0.04, surprise:0.05, disgust:0.04 };

    assert.equal(analyzer._dominant(happiness), 'neutral');
    assert.equal(analyzer._dominant(happiness), 'happiness');
    assert.equal(analyzer._dominant(neutral), 'neutral');
    assert.equal(analyzer._dominant(anger), 'neutral');
    assert.equal(analyzer._dominant(anger), 'anger');
  });
});
