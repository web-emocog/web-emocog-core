"use strict";

// Версия ядра для внешней интеграции и трассировки отчётов.
const MODULE_VERSION = "1.2.0-core";

// Runtime-настройки по умолчанию.
const DEFAULT_CONFIG = {
  max_audio_duration_sec: 0,
  abstain_confidence_threshold: 0.35,
  abstain_quality_threshold: 0.40,
  strict_mode: false,
};

// Пороги strict-mode (фиксированный balanced preset).
const STRICT_QUALITY_THRESHOLD = 0.55;
const STRICT_CONFIDENCE_THRESHOLD = 0.55;
const STRICT_FLAG_THRESHOLD_DELTA = 0.10;

// Ссылки на публикации, по которым сформированы эвристические правила.
const LITERATURE = {
  jang2025_schizophrenia_acoustic: {
    title: "Acoustic biomarkers for schizophrenia spectrum disorders and their associations with symptoms and cognitive functioning",
    url: "https://pubmed.ncbi.nlm.nih.gov/40120847/",
    year: 2025,
  },
  li2025_adrd_benchmark: {
    title: "Benchmarking Foundation Speech and Language methods for Alzheimer's Disease and Related Dementia Detection from Spontaneous Speech",
    url: "https://arxiv.org/abs/2506.11119",
    year: 2025,
  },
  kent2025_adrd_pauses: {
    title: "Pauses in Speech as a Biomarker for Alzheimer's Disease and Mild Cognitive Impairment: A Meta-analysis",
    url: "https://pubmed.ncbi.nlm.nih.gov/41378466/",
    year: 2025,
  },
  kong2025_depression_voice: {
    title: "Speech analysis for detecting depression in older adults: a systematic review",
    url: "https://pubmed.ncbi.nlm.nih.gov/41459266/",
    year: 2025,
  },
  godinho2020_parkinson_voice: {
    title: "Acoustic analysis of voice in Parkinson's disease: a systematic review of voice disability and meta-analysis of studies",
    url: "https://pubmed.ncbi.nlm.nih.gov/32436206/",
    year: 2020,
  },
  lowit2019_down_syndrome_speech: {
    title: "Speech and motor speech disorders and intelligibility in adolescents with Down syndrome",
    url: "https://pubmed.ncbi.nlm.nih.gov/31221010/",
    year: 2019,
  },
  naess2012_down_syndrome_voice: {
    title: "Speech impairment in Down syndrome: a review",
    url: "https://pubmed.ncbi.nlm.nih.gov/23275397/",
    year: 2013,
  },
};

// Текстовый контур отключен: держим ключи для JSON-совместимости.
const DISABLED_TEXT_FEATURES = {
  word_count: 0.0,
  unique_word_count: 0.0,
  type_token_ratio: 0.0,
  filler_ratio: 0.0,
  repetition_ratio: 0.0,
  avg_word_length: 0.0,
  sentence_count: 0.0,
  mean_words_per_sentence: 0.0,
};

module.exports = {
  MODULE_VERSION,
  DEFAULT_CONFIG,
  STRICT_QUALITY_THRESHOLD,
  STRICT_CONFIDENCE_THRESHOLD,
  STRICT_FLAG_THRESHOLD_DELTA,
  LITERATURE,
  DISABLED_TEXT_FEATURES,
};
