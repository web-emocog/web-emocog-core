import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("./engine.js");
// Функции для анализа аудио
export const MODULE_VERSION = core.MODULE_VERSION;
export const DEFAULT_CONFIG = core.DEFAULT_CONFIG;
export const mergeConfig = core.mergeConfig;
export const analyzePcmSamples = core.analyzePcmSamples;
export const analyzeAudioArrayBufferBrowser = core.analyzeAudioArrayBufferBrowser;
export const analyzeAudioFileBrowser = core.analyzeAudioFileBrowser;
export const analyzeAudioFile = core.analyzeAudioFile;
export const getCapabilities = core.getCapabilities;
export const toJsonReport = core.toJsonReport;
export const fromJsonReport = core.fromJsonReport;
export const analyzePcmSamplesJson = core.analyzePcmSamplesJson;
export const analyzeAudioArrayBufferBrowserJson = core.analyzeAudioArrayBufferBrowserJson;
export const analyzeAudioFileBrowserJson = core.analyzeAudioFileBrowserJson;
export const analyzeAudioFileJson = core.analyzeAudioFileJson;

export default core;
