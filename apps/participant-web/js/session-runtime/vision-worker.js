// Classic worker: the pinned MediaPipe WASM loader uses importScripts.
let analyzer;
let task;
let pose;
self.onmessage = async ({ data }) => {
    const { id, type } = data;
    let bitmap = data.bitmap;
    try {
        if (type === 'init') {
            task = data.task;
            const vision = await import('../vendor/mediapipe/vision_bundle.mjs');
            Object.assign(self, { FilesetResolver: vision.FilesetResolver,
                FaceLandmarker: vision.FaceLandmarker, ImageSegmenter: vision.ImageSegmenter });
            if (task === 'face') {
                const { PrecheckAnalyzer } = await import('../precheck-analyzer/PrecheckAnalyzer.js?v=20261025-1');
                analyzer = new PrecheckAnalyzer({ ...data.options, worker: false });
                if (data.options.thresholds) analyzer.thresholds = data.options.thresholds;
                if (!await analyzer.initialize()) throw new Error('vision_worker_init_failed');
            } else if (task === 'segment') {
                const { FaceSegmenter } = await import('../face-segmenter/FaceSegmenter.js?v=20261025-1');
                analyzer = new FaceSegmenter({ ...data.options, worker: false });
                if (!await analyzer.initialize()) throw new Error('vision_worker_init_failed');
            } else if (task === 'pose') {
                const files = await vision.FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', self.location).href);
                const options = delegate => ({ baseOptions: {
                    modelAssetPath: new URL('../vendor/mediapipe/models/pose_landmarker_lite.task', self.location).href,
                    ...(delegate ? { delegate } : {}) },
                    canvas: new OffscreenCanvas(1, 1), runningMode: 'VIDEO', numPoses: 1,
                    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5, outputSegmentationMasks: false });
                try { pose = await vision.PoseLandmarker.createFromOptions(files, options('GPU')); }
                catch (_) { pose = await vision.PoseLandmarker.createFromOptions(files, options(null)); }
            } else throw new Error('vision_worker_unknown_task');
            // Compile/warm up before the short per-frame deadline starts. No
            // participant samples or pose baseline are produced by this frame.
            const warmup = new OffscreenCanvas(640, 480);
            if (task === 'face') {
                const frame = await analyzer.analyzeFrame(warmup, { timestamp: 0, wallTimestamp: 0 });
                if (frame.error) throw new Error('vision_worker_warmup_failed');
                analyzer.reset();
            } else if (task === 'segment') {
                const frame = await analyzer.segmentFrame(warmup, null, 0);
                if (frame.error) throw new Error('vision_worker_warmup_failed');
                analyzer.reset();
            } else pose.detectForVideo(warmup, 0);
            self.postMessage({ id, result: task === 'segment'
                ? { ready: true, inferenceDelegate: analyzer.inferenceDelegate,
                    delegateFallbackReason: analyzer.cpuFallbackReason || null } : true });
        } else if (type === 'reset') {
            analyzer?.reset();
        } else if (type === 'frame') {
            let result;
            if (task === 'face') {
                const { getFramePixels } = await import('./frame-pixels.mjs');
                const frame = await analyzer.analyzeFrame(bitmap, data);
                frame.timestamp = data.timestamp;
                frame.wallTimestamp = data.wallTimestamp;
                const imageData = getFramePixels(frame);
                self.postMessage({ id, result: { frame, imageData } }, imageData ? [imageData.data.buffer] : []);
                return;
            } else if (task === 'segment') {
                result = await analyzer.segmentFrame(bitmap, data.landmarks, data.timestamp);
                result.inferenceDelegate = analyzer.inferenceDelegate;
                result.delegateFallbackReason = analyzer.cpuFallbackReason || null;
                // QC needs derived regions, not a raw per-pixel mask on the UI thread.
                if (result.maskAnalysis) result.maskAnalysis._rawMaskData = null;
            } else {
                result = pose.detectForVideo(bitmap, data.timestamp);
            }
            self.postMessage({ id, result });
        }
    } catch (_) {
        self.postMessage({ id, error: 'vision_worker_task_failed' });
    } finally {
        bitmap?.close();
    }
};
