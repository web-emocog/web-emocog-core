// Оптимизированный rPPG алгоритм — единая версия (SAFE)
export { RppgEngine } from "./RppgEngine.js";
export { DEFAULTS } from "./config.js";
export { SessionReporter } from "./session/SessionReporter.js";
export {
  getVideoFrameStub,
  getLandmarksStub,
  sendSessionJsonStub,
} from "./integration/io_stubs.js";
