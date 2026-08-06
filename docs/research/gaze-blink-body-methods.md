# Методические основания gaze, blink и body pose

## Область применения

Модуль предназначен для исследовательского сбора webcam-derived признаков.
Он не является медицинским изделием, не ставит диагноз и не заменяет
лабораторный eye tracker, полисомнографию или клиническую оценку.

## Gaze estimation

### Основания

- [MediaPipe Iris](https://github.com/google/mediapipe/blob/master/docs/solutions/iris.md)
  описывает real-time iris и eye-contour landmarks по одной RGB-камере.
- [MPIIGaze: Real-World Dataset and Deep Appearance-Based Gaze Estimation](https://arxiv.org/abs/1711.09017)
  показывает важность оценки в реальных условиях с вариациями освещения,
  внешности и позы головы.
- [Offset Calibration for Appearance-Based Gaze Estimation via Gaze Decomposition](https://openaccess.thecvf.com/content_WACV_2020/papers/Chen_Offset_Calibration_for_Appearance-Based_Gaze_Estimation_via_Gaze_Decomposition_WACV_2020_paper.pdf)
  разделяет subject-independent estimate и subject-dependent calibration bias
  и оценивает calibration на данных, не входящих в fit.

### Применение в проекте

- predictor использует только нормализованные iris features;
- head pose и translation считаются отдельным nuisance/OOD channel;
- calibration target не передается в prediction;
- post-calibration affine correction выбирается по leave-one-target-out
  cross-validation;
- финальная оценка проводится на независимом benchmark target set;
- сохраняется сравнение `baseline raw` против `new corrected`;
- rejected/OOD кадр не заменяется последней display-точкой.

### Сглаживание

[1 Euro Filter](https://doi.org/10.1145/2207676.2208639) обосновывает
speed-adaptive low-pass filtering для шумных интерактивных сигналов. В проекте
используется собственный velocity-adaptive EMA: при малой скорости cutoff ниже,
при быстром переводе взгляда выше. Скорость считается по последовательным
`corrected` inputs, а не по сглаженному output, чтобы исключить feedback lag.

## Browser coordinate system

- [`getBoundingClientRect()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)
  возвращает положение target относительно viewport.
- [CSSOM View / Visual Viewport specification](https://wicg.github.io/visual-viewport/)
  определяет `offsetLeft`, `offsetTop`, `width`, `height` и `scale`.

Панель вкладок и адресная строка находятся вне content viewport. Поэтому
калибровочные координаты берутся из фактического DOM target rect и
`visualViewport`; высота browser chrome не измеряется и не вычитается.

## Blinks и PERCLOS

- [Real-Time Eye Blink Detection using Facial Landmarks](https://cmp.felk.cvut.cz/ftp/articles/cech/Soukupova-TR-2016-05.pdf)
  использует изменение eye aspect ratio во времени, а не одиночный кадр.
- [PERCLOS: A Valid Psychophysiological Measure of Alertness](https://rosap.ntl.bts.gov/view/dot/113)
  определяет PERCLOS как долю времени, в течение которого глаза закрыты не
  менее чем на 80 процентов, и рассматривает минутное окно.

Проект непрерывно ведет:

- число blink events по согласованному состоянию обоих глаз;
- duration;
- closure amplitude;
- opening speed;
- incomplete blink proxy;
- PERCLOS windows 30 и 60 секунд.

PERCLOS и blink dynamics сохраняются отдельно. Обычные короткие blink events
не интерпретируются как микросон автоматически. Webcam PERCLOS зависит от
видимости век, очков, частоты кадров и качества landmarks.

## Body posture и movement

[BlazePose: On-device Real-time Body Pose Tracking](https://arxiv.org/abs/2006.10204)
описывает real-time single-person pose estimation по 33 body keypoints.
В проекте MediaPipe Pose Landmarker Lite оценивает плечи и бедра отдельно от
face pipeline и формирует:

- normalized torso translation;
- landmark и torso-center velocity;
- movement bursts;
- lateral/torso lean;
- shoulder roll;
- forward-lean proxy;
- confidence.

Сырые изображения не сохраняются. Движение корпуса является поведенческим
признаком и не имеет самостоятельной клинической интерпретации.

## Open-source licenses

- [MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE):
  Apache-2.0.
- Репозиторий EmoCog: Apache-2.0.
- Собственные signal-processing, calibration, validation и aggregation
  реализации находятся под лицензией репозитория.

Перед обновлением модели необходимо повторно проверить лицензию model asset,
зафиксировать URL/версию и выполнить baseline-versus-new benchmark.
