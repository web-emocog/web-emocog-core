// Оптимизированный rPPG алгоритм — единая версия (SAFE)
export { RppgEngine } from "./RppgEngine.js?v=20261107-resp1";
export { DEFAULTS } from "./config.js";
export { MotionRespirationEstimator, MOTION_RESPIRATION_METHOD_VERSION } from "./signal/respiration-motion.js?v=20261122-integrity1";
export { SessionReporter } from "./session/SessionReporter.js?v=20261019-5";
export {
  getVideoFrameStub,
  getLandmarksStub,
  sendSessionJsonStub,
} from "./integration/io_stubs.js";
