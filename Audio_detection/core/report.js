"use strict";

// Функции для анализа аудио
const {
  analyzeAudioArrayBufferBrowser,
  analyzeAudioFile,
  analyzeAudioFileBrowser,
  analyzePcmSamples,
} = require("./analyzer");

// Функция для преобразования результата анализа в JSON-формат
function toJsonReport(result, pretty = true) {
  return JSON.stringify(result, null, pretty ? 2 : 0);
}

// Функция для преобразования JSON-строки отчёта в объект
function fromJsonReport(jsonText) {
  if (typeof jsonText !== "string") {
    throw new Error("Ожидается JSON-строка отчёта.");
  }
  return JSON.parse(jsonText);
}

// Функция для анализа PCM-образцов
function analyzePcmSamplesJson(samples, sampleRate, runtimeConfig = {}, pretty = true) {
  const report = analyzePcmSamples(samples, sampleRate, runtimeConfig);
  return toJsonReport(report, pretty);
}

// Функция для анализа аудиофайлов в браузере
async function analyzeAudioFileBrowserJson(file, runtimeConfig = {}, pretty = true) {
  const report = await analyzeAudioFileBrowser(file, runtimeConfig);
  return toJsonReport(report, pretty);
}

// Функция для анализа аудиомассивов в браузере
async function analyzeAudioArrayBufferBrowserJson(arrayBuffer, runtimeConfig = {}, pretty = true) {
  const report = await analyzeAudioArrayBufferBrowser(arrayBuffer, runtimeConfig);
  return toJsonReport(report, pretty);
}

// Функция для анализа аудиофайлов в браузере
async function analyzeAudioFileJson(file, runtimeConfig = {}, pretty = true) {
  const report = await analyzeAudioFile(file, runtimeConfig);
  return toJsonReport(report, pretty);
}

module.exports = {
  toJsonReport,
  fromJsonReport,
  analyzePcmSamplesJson,
  analyzeAudioArrayBufferBrowserJson,
  analyzeAudioFileBrowserJson,
  analyzeAudioFileJson,
};
