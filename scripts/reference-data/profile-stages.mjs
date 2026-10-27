// Diagnostic-only instrumentation of first-party code served by the private
// replay harness. Production sources, model inputs and formulas are unchanged.
export function profileFaceStages(source, faceInput = 'bitmap', faceOutputs = 'full', faceCanvas = 'default') {
  if (!['bitmap', 'imageData'].includes(faceInput)) throw new Error('invalid_reference_face_input');
  if (!['full', 'used'].includes(faceOutputs)) throw new Error('invalid_reference_face_outputs');
  if (!['default', 'compute'].includes(faceCanvas)) throw new Error('invalid_reference_face_canvas');
  if (faceCanvas === 'compute') {
    const original = 'canvas: createAnalysisCanvas()';
    if (source.split(original).length !== 2) throw new Error('reference_profile_source_changed');
    source = source.replace(original, `canvas: (() => {
      const canvas = createAnalysisCanvas();
      if (!canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false })) {
        throw new Error('reference_compute_context_unavailable');
      }
      return canvas;
    })()`);
  }
  if (faceOutputs === 'used') {
    const original = 'outputFaceBlendshapes: true,';
    if (source.split(original).length !== 2) throw new Error('reference_profile_source_changed');
    source = source.replace(original, 'outputFaceBlendshapes: false,');
  }
  const edits = [
    ['const mpResults = this.faceLandmarker.detectForVideo(videoElement, timestamp);',
      `const inferenceStarted = performance.now();\n            const mpResults = this.faceLandmarker.detectForVideo(${faceInput === 'imageData' ? 'imageData' : 'videoElement'}, timestamp);\n            const inferenceFinished = performance.now();`],
    ['analysisTime: Math.round(analysisTime)',
      'analysisTime: Math.round(analysisTime),\n                replayStageMs: { pixels: inferenceStarted - startTime, inference: inferenceFinished - inferenceStarted, derived: performance.now() - inferenceFinished }'],
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('reference_profile_source_changed');
    source = source.replace(before, after);
  }
  return source;
}
