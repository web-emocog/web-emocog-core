"use strict";

/*
  Совместимый фасад поверх разнесённого core-модуля.
  Оставлен для старых импортов require('./core/engine').
*/

const { DEFAULT_CONFIG, MODULE_VERSION } = require("./constants");
const {
  analyzePcmSamples,
  analyzeAudioArrayBufferBrowser,
  analyzeAudioFileBrowser,
  analyzeAudioFile,
  getCapabilities,
  mergeConfig,
} = require("./analyzer");
const {
  toJsonReport,
  fromJsonReport,
  analyzePcmSamplesJson,
  analyzeAudioArrayBufferBrowserJson,
  analyzeAudioFileBrowserJson,
  analyzeAudioFileJson,
} = require("./report");

const exportedApi = {
  MODULE_VERSION,
  DEFAULT_CONFIG,
  mergeConfig,
  analyzePcmSamples,
  analyzeAudioArrayBufferBrowser,
  analyzeAudioFileBrowser,
  analyzeAudioFile,
  getCapabilities,
  toJsonReport,
  fromJsonReport,
  analyzePcmSamplesJson,
  analyzeAudioArrayBufferBrowserJson,
  analyzeAudioFileBrowserJson,
  analyzeAudioFileJson,
};

module.exports = exportedApi;
