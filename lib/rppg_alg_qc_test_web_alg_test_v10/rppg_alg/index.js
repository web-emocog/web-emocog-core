// Оптимизированный rPPG алгоритм — единая версия (SAFE)
export { RppgEngine } from "./RppgEngine.js?v=20261019-5";
export { DEFAULTS } from "./config.js";
export { SessionReporter } from "./session/SessionReporter.js?v=20261019-5";
export {
  getVideoFrameStub,
  getLandmarksStub,
  sendSessionJsonStub,
} from "./integration/io_stubs.js";
