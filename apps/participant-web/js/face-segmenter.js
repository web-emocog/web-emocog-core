/**
 * Face Segmenter Module v1.2
 * Проверка видимости областей лица через MediaPipe Image Segmenter
 * 
 * Использует модель Selfie Segmenter для точной сегментации:
 * - Маска лица/человека (foreground vs background)
 * - Мультикласс: skin, hair, clothes, background и др.
 * 
 * Преимущества перед анализом по лэндмаркам:
 * - Точная пиксельная маска области лица
 * - Детекция окклюзий (волосы, руки, предметы)
 * - Независимость от точности лэндмарок на закрытых областях
 * 
 * v1.2 - Улучшена детекция руки на лице:
 * - Снижены пороги handOcclusionThreshold до 0.05 (5%)
 * - Более агрессивная детекция body_skin в областях лица
 * - Добавлен глобальный анализ body_skin по всему лицу
 * 
 * v1.1 - Улучшена детекция окклюзий:
 * - body_skin в области лица теперь считается окклюзией (рука)
 * - Более строгие пороги для лба (волосы)
 * - Добавлен анализ аномального присутствия body_skin
 * 
 * @version 1.2.0
 * @requires @mediapipe/tasks-vision
 */

class FaceSegmenter {
    constructor(options = {}) {
        this.isInitialized = false;
        this.imageSegmenter = null;
        
        // Режим работы
        this.runningMode = options.runningMode || "VIDEO";
        
        // Тип сегментации
        // 'selfie' - бинарная маска человек/фон
        // 'selfie_multiclass' - мультиклассовая (skin, hair, body, clothes, etc.)
        this.segmentationType = options.segmentationType || "selfie_multiclass";
        
        // Пороговые значения
        this.thresholds = {
            // Минимальная уверенность для маски
            maskConfidence: options.maskConfidence ?? 0.5,
            
            // Минимальный процент видимой кожи лица в каждой области
            minSkinVisibility: options.minSkinVisibility ?? 0.60,
            
            // Минимальный процент кожи для всего лица
            minTotalFaceSkin: options.minTotalFaceSkin ?? 0.55,
            
            // Порог для определения окклюзии волосами
            hairOcclusionThreshold: options.hairOcclusionThreshold ?? 0.25,
            
            // Порог для определения окклюзии рукой (body_skin в области лица)
            // ВАЖНО: body_skin НЕ должно быть в области лица вообще!
            // Если > 5% области лица = body_skin, это рука
            handOcclusionThreshold: options.handOcclusionThreshold ?? 0.05,
            
            // Глобальный порог body_skin для всего лица
            // Если > 8% всего лица = body_skin, точно рука
            globalHandThreshold: options.globalHandThreshold ?? 0.08,
            
            // Допустимая асимметрия между левой и правой стороной
            maxAsymmetry: options.maxAsymmetry ?? 0.30
        };
        
        // Индексы классов для Selfie Multiclass Segmenter
        // Согласно документации MediaPipe:
        // 0 - background
        // 1 - hair
        // 2 - body-skin (тело, руки)
        // 3 - face-skin (лицо)
        // 4 - clothes
        // 5 - others (accessories и т.д.)
        this.CLASS_INDICES = {
            BACKGROUND: 0,
            HAIR: 1,
            BODY_SKIN: 2,  // Включает руки!
            FACE_SKIN: 3,
            CLOTHES: 4,
            OTHERS: 5
        };
        
        // Названия классов для отладки
        this.CLASS_NAMES = ['background', 'hair', 'body_skin', 'face_skin', 'clothes', 'others'];
        
        // Canvas для обработки масок
        this._maskCanvas = null;
        this._maskCtx = null;
        
        // Последний результат сегментации
        this.lastResult = null;
        
        // Callbacks
        this.onInitialized = options.onInitialized || null;
        this.onError = options.onError || null;
    }

    /**
     * Инициализация MediaPipe Image Segmenter
     */
    async initialize() {
        if (this.isInitialized) return true;
        
        try {
            console.log('[FaceSegmenter] Инициализация v1.2 (MediaPipe Image Segmenter)...');
            
            // Проверяем наличие MediaPipe
            if (typeof FilesetResolver === 'undefined' || typeof ImageSegmenter === 'undefined') {
                throw new Error('MediaPipe Vision не загружен. Добавьте скрипты в HTML.');
            }
            
            // Загружаем WASM модуль
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
            );
            
            // Выбираем модель в зависимости от типа сегментации
            const modelPath = this.segmentationType === 'selfie_multiclass'
                ? "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
                : "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
            
            // Создаём Image Segmenter
            this.imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: modelPath,
                    delegate: "GPU"
                },
                runningMode: this.runningMode,
                outputCategoryMask: true,
                outputConfidenceMasks: true
            });
            
            // Создаём canvas для обработки масок
            this._maskCanvas = document.createElement('canvas');
            this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
            
            this.isInitialized = true;
            console.log(`[FaceSegmenter] MediaPipe Image Segmenter готов (${this.segmentationType})`);
            
            if (this.onInitialized) {
                this.onInitialized();
            }
            
            return true;
            
        } catch (error) {
            console.error('[FaceSegmenter] Ошибка инициализации:', error);
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * Сегментация кадра видео
     * @param {HTMLVideoElement} videoElement - видео элемент
     * @param {Object} faceLandmarks - лэндмарки лица от Face Landmarker (опционально)
     * @returns {Object} результат сегментации с анализом видимости областей
     */
    async segmentFrame(videoElement, faceLandmarks = null) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!videoElement || videoElement.readyState < 2) {
            return this._createErrorResult('Видео не готово');
        }

        const startTime = performance.now();
        
        try {
            const width = videoElement.videoWidth || 640;
            const height = videoElement.videoHeight || 480;
            
            // Выполняем сегментацию
            const timestamp = performance.now();
            const segmentationResult = this.imageSegmenter.segmentForVideo(videoElement, timestamp);
            
            // Обрабатываем маски
            const maskAnalysis = this._analyzeMasks(segmentationResult, width, height, faceLandmarks);
            
            // Анализируем видимость областей лица
            const faceVisibility = this._analyzeFaceRegionsVisibility(maskAnalysis, faceLandmarks, width, height);
            
            const analysisTime = performance.now() - startTime;
            
            this.lastResult = {
                maskAnalysis,
                faceVisibility,
                isComplete: faceVisibility.isComplete,
                score: faceVisibility.score,
                issues: faceVisibility.issues,
                timestamp: Date.now(),
                frameSize: { width, height },
                analysisTime: Math.round(analysisTime)
            };

            // Освобождаем ресурсы маски
            if (segmentationResult.categoryMask) {
                segmentationResult.categoryMask.close();
            }
            if (segmentationResult.confidenceMasks) {
                segmentationResult.confidenceMasks.forEach(mask => mask.close());
            }

            return this.lastResult;
            
        } catch (error) {
            console.error('[FaceSegmenter] Ошибка сегментации:', error);
            return this._createErrorResult(error.message);
        }
    }

    /**
     * Анализ масок сегментации
     */
    _analyzeMasks(segmentationResult, width, height, faceLandmarks) {
        const result = {
            hasData: false,
            classDistribution: {},
            faceRegion: null,
            confidenceMap: null,
            // Сохраняем сырые данные для точного анализа областей
            _rawMaskData: null,
            _maskDimensions: null
        };

        // Получаем категориальную маску
        const categoryMask = segmentationResult.categoryMask;
        if (!categoryMask) {
            return result;
        }

        result.hasData = true;

        // Получаем данные маски
        const maskData = categoryMask.getAsUint8Array();
        const maskWidth = categoryMask.width;
        const maskHeight = categoryMask.height;

        // Сохраняем копию сырых данных для анализа областей
        result._rawMaskData = new Uint8Array(maskData);
        result._maskDimensions = { width: maskWidth, height: maskHeight };

        // Считаем распределение классов
        const classCounts = new Array(6).fill(0);
        const totalPixels = maskData.length;

        for (let i = 0; i < maskData.length; i++) {
            const classIdx = maskData[i];
            if (classIdx < classCounts.length) {
                classCounts[classIdx]++;
            }
        }

        // Формируем распределение
        for (let i = 0; i < classCounts.length; i++) {
            result.classDistribution[this.CLASS_NAMES[i]] = {
                count: classCounts[i],
                ratio: classCounts[i] / totalPixels
            };
        }

        // Определяем область лица на основе лэндмарок или центра кадра
        result.faceRegion = this._extractFaceRegion(maskData, maskWidth, maskHeight, faceLandmarks, width, height);

        // Получаем карту уверенности для кожи лица (если доступна)
        if (segmentationResult.confidenceMasks && segmentationResult.confidenceMasks.length > this.CLASS_INDICES.FACE_SKIN) {
            const faceSkinMask = segmentationResult.confidenceMasks[this.CLASS_INDICES.FACE_SKIN];
            if (faceSkinMask) {
                result.confidenceMap = {
                    faceSkin: this._extractConfidenceStats(faceSkinMask, faceLandmarks, width, height)
                };
            }
        }

        return result;
    }

    /**
     * Извлечение и анализ области лица из маски
     */
    _extractFaceRegion(maskData, maskWidth, maskHeight, faceLandmarks, frameWidth, frameHeight) {
        // Определяем bounding box лица
        let faceBox;
        
        if (faceLandmarks && faceLandmarks.length > 0) {
            // Используем лэндмарки для определения области
            let minX = 1, maxX = 0, minY = 1, maxY = 0;
            for (const point of faceLandmarks) {
                minX = Math.min(minX, point.x);
                maxX = Math.max(maxX, point.x);
                minY = Math.min(minY, point.y);
                maxY = Math.max(maxY, point.y);
            }
            
            // Расширяем область на 10% для захвата волос по краям
            const padX = (maxX - minX) * 0.1;
            const padY = (maxY - minY) * 0.1;
            
            faceBox = {
                x: Math.max(0, minX - padX),
                y: Math.max(0, minY - padY),
                width: Math.min(1, maxX - minX + 2 * padX),
                height: Math.min(1, maxY - minY + 2 * padY)
            };
        } else {
            // Используем центральную область кадра
            faceBox = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
        }

        // Преобразуем координаты в координаты маски
        const startX = Math.floor(faceBox.x * maskWidth);
        const endX = Math.floor((faceBox.x + faceBox.width) * maskWidth);
        const startY = Math.floor(faceBox.y * maskHeight);
        const endY = Math.floor((faceBox.y + faceBox.height) * maskHeight);

        // Анализируем пиксели в области лица
        const regionStats = {
            totalPixels: 0,
            faceSkin: 0,
            hair: 0,
            background: 0,
            bodySkin: 0,
            clothes: 0,
            others: 0
        };

        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const idx = y * maskWidth + x;
                if (idx >= maskData.length) continue;
                
                const classIdx = maskData[idx];
                regionStats.totalPixels++;
                
                switch (classIdx) {
                    case this.CLASS_INDICES.FACE_SKIN:
                        regionStats.faceSkin++;
                        break;
                    case this.CLASS_INDICES.HAIR:
                        regionStats.hair++;
                        break;
                    case this.CLASS_INDICES.BACKGROUND:
                        regionStats.background++;
                        break;
                    case this.CLASS_INDICES.BODY_SKIN:
                        regionStats.bodySkin++;
                        break;
                    case this.CLASS_INDICES.CLOTHES:
                        regionStats.clothes++;
                        break;
                    default:
                        regionStats.others++;
                }
            }
        }

        // Вычисляем соотношения
        const total = regionStats.totalPixels || 1;
        
        return {
            boundingBox: faceBox,
            stats: regionStats,
            ratios: {
                faceSkin: regionStats.faceSkin / total,
                hair: regionStats.hair / total,
                background: regionStats.background / total,
                bodySkin: regionStats.bodySkin / total,
                clothes: regionStats.clothes / total,
                others: regionStats.others / total,
                // Общая видимость кожи (лицо + тело)
                totalSkin: (regionStats.faceSkin + regionStats.bodySkin) / total,
                // Окклюзия (волосы + другое)
                occlusion: (regionStats.hair + regionStats.others + regionStats.clothes) / total
            }
        };
    }

    /**
     * Извлечение статистики уверенности для маски
     */
    _extractConfidenceStats(confidenceMask, faceLandmarks, frameWidth, frameHeight) {
        const data = confidenceMask.getAsFloat32Array();
        const width = confidenceMask.width;
        const height = confidenceMask.height;

        let sum = 0;
        let count = 0;
        let highConfCount = 0;
        
        const threshold = this.thresholds.maskConfidence;

        // Если есть лэндмарки, анализируем только область лица
        if (faceLandmarks && faceLandmarks.length > 0) {
            for (const point of faceLandmarks) {
                const x = Math.floor(point.x * width);
                const y = Math.floor(point.y * height);
                const idx = y * width + x;
                
                if (idx >= 0 && idx < data.length) {
                    const confidence = data[idx];
                    sum += confidence;
                    count++;
                    if (confidence >= threshold) {
                        highConfCount++;
                    }
                }
            }
        } else {
            // Анализируем весь кадр
            for (let i = 0; i < data.length; i++) {
                const confidence = data[i];
                sum += confidence;
                count++;
                if (confidence >= threshold) {
                    highConfCount++;
                }
            }
        }

        return {
            averageConfidence: count > 0 ? sum / count : 0,
            highConfidenceRatio: count > 0 ? highConfCount / count : 0,
            sampledPoints: count
        };
    }

    /**
     * Анализ видимости конкретных областей лица
     * Использует лэндмарки для определения позиций ключевых областей
     */
    _analyzeFaceRegionsVisibility(maskAnalysis, faceLandmarks, frameWidth, frameHeight) {
        if (!maskAnalysis.hasData) {
            return {
                isComplete: false,
                score: 0,
                issues: ['no_segmentation_data'],
                regions: {}
            };
        }

        const issues = [];
        let score = 100;
        const regions = {};
        
        // Флаг для детекции руки на лице
        let handDetectedOnFace = false;
        
        // v1.2: ГЛОБАЛЬНАЯ ПРОВЕРКА body_skin по всему лицу
        // Если body_skin > globalHandThreshold в области лица — это точно рука
        if (maskAnalysis.faceRegion) {
            const globalBodySkinRatio = maskAnalysis.faceRegion.ratios.bodySkin;
            regions.globalBodySkinRatio = globalBodySkinRatio;
            
            if (globalBodySkinRatio >= this.thresholds.globalHandThreshold) {
                handDetectedOnFace = true;
                issues.push('hand_on_face');
                // Сильно снижаем score при глобальной детекции руки
                score -= 30;
                console.log(`[FaceSegmenter] Глобальная детекция руки: body_skin=${(globalBodySkinRatio * 100).toFixed(1)}% (порог ${this.thresholds.globalHandThreshold * 100}%)`);
            }
        }

        // Если есть лэндмарки, анализируем конкретные области
        if (faceLandmarks && faceLandmarks.length >= 468) {
            // Определяем области лица по лэндмаркам
            const faceAreas = this._defineFaceAreas(faceLandmarks);
            
            // Анализируем каждую область
            regions.forehead = this._analyzeAreaVisibility(maskAnalysis, faceAreas.forehead, 'forehead');
            regions.leftCheek = this._analyzeAreaVisibility(maskAnalysis, faceAreas.leftCheek, 'leftCheek');
            regions.rightCheek = this._analyzeAreaVisibility(maskAnalysis, faceAreas.rightCheek, 'rightCheek');
            regions.leftEye = this._analyzeAreaVisibility(maskAnalysis, faceAreas.leftEye, 'leftEye');
            regions.rightEye = this._analyzeAreaVisibility(maskAnalysis, faceAreas.rightEye, 'rightEye');
            regions.nose = this._analyzeAreaVisibility(maskAnalysis, faceAreas.nose, 'nose');
            regions.mouth = this._analyzeAreaVisibility(maskAnalysis, faceAreas.mouth, 'mouth');
            regions.chin = this._analyzeAreaVisibility(maskAnalysis, faceAreas.chin, 'chin');

            // Проверяем наличие руки на любой области лица (если ещё не детектирована глобально)
            if (!handDetectedOnFace) {
                const allRegions = [regions.forehead, regions.leftCheek, regions.rightCheek, 
                                   regions.leftEye, regions.rightEye, regions.nose, 
                                   regions.mouth, regions.chin];
                
                for (const region of allRegions) {
                    if (region && region.reason === 'hand_occlusion') {
                        handDetectedOnFace = true;
                        break;
                    }
                }
            }

            // Проверяем лоб
            if (!regions.forehead.isVisible) {
                if (regions.forehead.reason === 'hand_occlusion') {
                    issues.push('forehead_hand_occluded');
                } else {
                    issues.push('forehead_occluded');
                }
                score -= 15;
            }

            // Проверяем щёки (критично для eye-tracking)
            if (!regions.leftCheek.isVisible) {
                if (regions.leftCheek.reason === 'hand_occlusion') {
                    issues.push('left_cheek_hand_occluded');
                } else {
                    issues.push('left_cheek_occluded');
                }
                issues.push('left_side_occluded');
                score -= 20;
            }
            if (!regions.rightCheek.isVisible) {
                if (regions.rightCheek.reason === 'hand_occlusion') {
                    issues.push('right_cheek_hand_occluded');
                } else {
                    issues.push('right_cheek_occluded');
                }
                issues.push('right_side_occluded');
                score -= 20;
            }

            // Проверяем глаза
            if (!regions.leftEye.isVisible) {
                if (regions.leftEye.reason === 'hand_occlusion') {
                    issues.push('left_eye_hand_occluded');
                } else {
                    issues.push('left_eye_occluded');
                }
                score -= 15;
            }
            if (!regions.rightEye.isVisible) {
                if (regions.rightEye.reason === 'hand_occlusion') {
                    issues.push('right_eye_hand_occluded');
                } else {
                    issues.push('right_eye_occluded');
                }
                score -= 15;
            }
            
            // Добавляем общий issue для руки на лице (если ещё не добавлен)
            if (handDetectedOnFace && !issues.includes('hand_on_face')) {
                issues.push('hand_on_face');
            }

            // Проверяем симметрию
            const asymmetry = this._checkSymmetry(regions);
            if (!asymmetry.isSymmetric) {
                if (!issues.some(i => i.includes('occluded'))) {
                    issues.push('asymmetric_visibility');
                    score -= 10;
                }
            }
            regions.symmetry = asymmetry;

        } else {
            // Анализируем на основе общей маски без лэндмарок
            const faceRegion = maskAnalysis.faceRegion;
            
            if (faceRegion) {
                // v1.2: НЕ считаем bodySkin как видимую кожу — это может быть рука!
                const faceSkinRatio = faceRegion.ratios.faceSkin;
                const bodySkinRatio = faceRegion.ratios.bodySkin;
                const hairRatio = faceRegion.ratios.hair;
                
                regions.overall = {
                    faceSkinVisibility: faceSkinRatio,
                    bodySkinRatio: bodySkinRatio,
                    hairOcclusion: hairRatio,
                    isVisible: faceSkinRatio >= this.thresholds.minTotalFaceSkin && 
                               bodySkinRatio < this.thresholds.globalHandThreshold
                };

                if (faceSkinRatio < this.thresholds.minTotalFaceSkin) {
                    issues.push('insufficient_face_visibility');
                    score -= 30;
                }

                if (hairRatio > this.thresholds.hairOcclusionThreshold) {
                    issues.push('hair_occlusion');
                    score -= 15;
                }
                
                // Проверка на руку без лэндмарок
                if (bodySkinRatio >= this.thresholds.globalHandThreshold && !handDetectedOnFace) {
                    issues.push('hand_on_face');
                    score -= 25;
                }
            }
        }

        // Проверяем общую видимость кожи лица из маски
        if (maskAnalysis.faceRegion) {
            // v1.2: Только face_skin считается видимой кожей лица
            const faceSkinRatio = maskAnalysis.faceRegion.ratios.faceSkin;
            regions.totalFaceSkinVisibility = faceSkinRatio;
            
            if (faceSkinRatio < this.thresholds.minTotalFaceSkin && !issues.includes('insufficient_face_visibility')) {
                issues.push('low_skin_visibility');
                score -= 20;
            }
        }

        // Убираем дубликаты
        const uniqueIssues = [...new Set(issues)];
        
        // v1.2: Более строгая проверка — если рука на лице, isComplete = false
        const isComplete = score >= 70 && uniqueIssues.length === 0 && !handDetectedOnFace;

        return {
            isComplete,
            score: Math.max(0, score),
            issues: uniqueIssues,
            regions,
            handDetected: handDetectedOnFace,
            thresholds: this.thresholds
        };
    }

    /**
     * Определение областей лица по лэндмаркам MediaPipe Face Mesh
     */
    _defineFaceAreas(landmarks) {
        // Индексы ключевых точек MediaPipe Face Mesh (478 точек)
        const LANDMARK_INDICES = {
            // Лоб (верхняя часть лица)
            FOREHEAD: [10, 108, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389, 251, 284, 332, 297, 338],
            
            // Левая щека
            LEFT_CHEEK: [355, 429, 358, 327, 326, 2, 164, 167, 393, 391, 269, 270, 409, 287, 410, 322],
            
            // Правая щека
            RIGHT_CHEEK: [126, 209, 129, 98, 97, 2, 164, 167, 168, 166, 39, 40, 185, 57, 186, 92],
            
            // Левый глаз с окружением
            LEFT_EYE: [276, 283, 282, 295, 285, 336, 296, 334, 293, 300, 383, 372, 340, 346, 263, 362, 398, 384, 385, 386, 387, 388, 466, 373, 374, 380, 381, 382],
            
            // Правый глаз с окружением
            RIGHT_EYE: [46, 53, 52, 65, 55, 107, 66, 105, 63, 70, 156, 143, 111, 117, 33, 133, 173, 157, 158, 159, 160, 161, 246, 144, 145, 153, 154, 155],
            
            // Нос
            NOSE: [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327],
            
            // Рот
            MOUTH: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
            
            // Подбородок
            CHIN: [152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
        };

        const getAreaBounds = (indices) => {
            const points = indices.map(i => landmarks[i]).filter(p => p);
            if (points.length === 0) return null;
            
            let minX = 1, maxX = 0, minY = 1, maxY = 0;
            for (const p of points) {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }
            
            return {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
                points
            };
        };

        return {
            forehead: getAreaBounds(LANDMARK_INDICES.FOREHEAD),
            leftCheek: getAreaBounds(LANDMARK_INDICES.LEFT_CHEEK),
            rightCheek: getAreaBounds(LANDMARK_INDICES.RIGHT_CHEEK),
            leftEye: getAreaBounds(LANDMARK_INDICES.LEFT_EYE),
            rightEye: getAreaBounds(LANDMARK_INDICES.RIGHT_EYE),
            nose: getAreaBounds(LANDMARK_INDICES.NOSE),
            mouth: getAreaBounds(LANDMARK_INDICES.MOUTH),
            chin: getAreaBounds(LANDMARK_INDICES.CHIN)
        };
    }

    /**
     * Анализ видимости конкретной области лица
     * Проверяет, какой процент области покрыт кожей vs волосами/другим
     */
    _analyzeAreaVisibility(maskAnalysis, areaBounds, areaName) {
        if (!areaBounds || !maskAnalysis.hasData) {
            return { isVisible: false, skinRatio: 0, hairRatio: 0, reason: 'no_data' };
        }

        // Если есть сохранённые данные маски, делаем точечный анализ
        if (maskAnalysis._rawMaskData && maskAnalysis._maskDimensions) {
            return this._analyzeAreaPixels(
                maskAnalysis._rawMaskData,
                maskAnalysis._maskDimensions,
                areaBounds,
                areaName
            );
        }

        // Fallback: используем общие данные о соотношении классов
        const faceRegion = maskAnalysis.faceRegion;
        if (!faceRegion) {
            return { isVisible: false, skinRatio: 0, hairRatio: 0, reason: 'no_face_region' };
        }
        
        const skinRatio = faceRegion.ratios.faceSkin;
        const hairRatio = faceRegion.ratios.hair;
        
        // Определяем видимость на основе порогов
        const isCheekorForehead = ['leftCheek', 'rightCheek', 'forehead'].includes(areaName);
        const minSkin = isCheekorForehead 
            ? this.thresholds.minSkinVisibility 
            : this.thresholds.minSkinVisibility * 0.8;
        
        const isVisible = skinRatio >= minSkin && hairRatio < this.thresholds.hairOcclusionThreshold;

        return {
            isVisible,
            skinRatio: Math.round(skinRatio * 100) / 100,
            hairRatio: Math.round(hairRatio * 100) / 100,
            occlusionRatio: Math.round(faceRegion.ratios.occlusion * 100) / 100,
            bounds: areaBounds,
            areaName,
            reason: !isVisible ? (hairRatio >= this.thresholds.hairOcclusionThreshold ? 'hair_occlusion' : 'low_skin') : null
        };
    }

    /**
     * Точный пиксельный анализ конкретной области лица
     * @param {Uint8Array} maskData - данные категориальной маски
     * @param {Object} dimensions - размеры маски {width, height}
     * @param {Object} areaBounds - границы области {x, y, width, height, points}
     * @param {string} areaName - название области для логирования
     */
    _analyzeAreaPixels(maskData, dimensions, areaBounds, areaName) {
        const { width: maskWidth, height: maskHeight } = dimensions;
        
        // Преобразуем нормализованные координаты в координаты маски
        const startX = Math.max(0, Math.floor(areaBounds.x * maskWidth));
        const endX = Math.min(maskWidth, Math.ceil((areaBounds.x + areaBounds.width) * maskWidth));
        const startY = Math.max(0, Math.floor(areaBounds.y * maskHeight));
        const endY = Math.min(maskHeight, Math.ceil((areaBounds.y + areaBounds.height) * maskHeight));

        // Счётчики классов для этой области
        const counts = {
            total: 0,
            faceSkin: 0,
            bodySkin: 0,
            hair: 0,
            background: 0,
            clothes: 0,
            others: 0
        };

        // Анализируем пиксели в прямоугольной области
        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const idx = y * maskWidth + x;
                if (idx >= maskData.length) continue;
                
                const classIdx = maskData[idx];
                counts.total++;
                
                switch (classIdx) {
                    case this.CLASS_INDICES.FACE_SKIN:
                        counts.faceSkin++;
                        break;
                    case this.CLASS_INDICES.BODY_SKIN:
                        counts.bodySkin++;
                        break;
                    case this.CLASS_INDICES.HAIR:
                        counts.hair++;
                        break;
                    case this.CLASS_INDICES.BACKGROUND:
                        counts.background++;
                        break;
                    case this.CLASS_INDICES.CLOTHES:
                        counts.clothes++;
                        break;
                    default:
                        counts.others++;
                }
            }
        }

        // Дополнительно: если есть точки лэндмарок, сэмплируем их
        if (areaBounds.points && areaBounds.points.length > 0) {
            const pointCounts = { faceSkin: 0, bodySkin: 0, hair: 0, other: 0, total: 0 };
            
            for (const point of areaBounds.points) {
                const px = Math.floor(point.x * maskWidth);
                const py = Math.floor(point.y * maskHeight);
                const pidx = py * maskWidth + px;
                
                if (pidx >= 0 && pidx < maskData.length) {
                    pointCounts.total++;
                    const classIdx = maskData[pidx];
                    
                    if (classIdx === this.CLASS_INDICES.FACE_SKIN) {
                        pointCounts.faceSkin++;
                    } else if (classIdx === this.CLASS_INDICES.BODY_SKIN) {
                        // body_skin на лэндмарках лица = вероятно рука
                        pointCounts.bodySkin++;
                    } else if (classIdx === this.CLASS_INDICES.HAIR) {
                        pointCounts.hair++;
                    } else {
                        pointCounts.other++;
                    }
                }
            }
            
            // Сохраняем результаты сэмплирования по лэндмаркам
            if (pointCounts.total > 0) {
                counts.landmarkFaceSkinRatio = pointCounts.faceSkin / pointCounts.total;
                counts.landmarkBodySkinRatio = pointCounts.bodySkin / pointCounts.total;
                counts.landmarkHairRatio = pointCounts.hair / pointCounts.total;
            }
        }

        // Вычисляем соотношения
        const total = counts.total || 1;
        
        // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ v1.1:
        // body_skin в области лица — это окклюзия (рука), НЕ видимая кожа лица!
        // Только face_skin считается видимой кожей лица
        const faceSkinRatio = counts.faceSkin / total;
        const bodySkinRatio = counts.bodySkin / total;
        const hairRatio = counts.hair / total;
        
        // Окклюзия = волосы + body_skin (рука) + одежда + другое
        const occlusionRatio = (counts.hair + counts.bodySkin + counts.clothes + counts.others) / total;
        
        // Определяем пороги в зависимости от области
        let minFaceSkinThreshold = this.thresholds.minSkinVisibility;
        let maxHairThreshold = this.thresholds.hairOcclusionThreshold;
        let maxHandThreshold = this.thresholds.handOcclusionThreshold;

        // Для разных областей разные пороги
        // v1.2: Значительно снижены пороги для body_skin (рука)
        switch (areaName) {
            case 'forehead':
                // Лоб часто закрыт волосами — более строгий порог для волос
                maxHairThreshold = 0.35;
                minFaceSkinThreshold = 0.40;
                maxHandThreshold = 0.05;  // Снижено с 0.10 — руки на лбу редки, но если есть — сразу детектим
                break;
            case 'leftCheek':
            case 'rightCheek':
                // Щёки критичны для трекинга — очень строгие пороги для руки
                minFaceSkinThreshold = 0.45;
                maxHairThreshold = 0.20;
                maxHandThreshold = 0.05;  // Снижено с 0.12 — даже 5% body_skin на щеке = рука
                break;
            case 'leftEye':
            case 'rightEye':
                // Глаза должны быть видимы
                minFaceSkinThreshold = 0.20;
                maxHairThreshold = 0.15;
                maxHandThreshold = 0.05;  // Снижено с 0.10
                break;
            case 'nose':
                // Нос обычно виден
                minFaceSkinThreshold = 0.40;
                maxHairThreshold = 0.10;
                maxHandThreshold = 0.08;  // Снижено с 0.15
                break;
            case 'mouth':
                // Рот может быть частично закрыт рукой
                minFaceSkinThreshold = 0.35;
                maxHairThreshold = 0.10;
                maxHandThreshold = 0.08;  // Снижено с 0.15
                break;
            case 'chin':
                // Подбородок может быть закрыт рукой
                minFaceSkinThreshold = 0.30;
                maxHairThreshold = 0.20;
                maxHandThreshold = 0.10;  // Снижено с 0.20
                break;
        }

        // Определяем видимость
        // Область видима если:
        // 1. Достаточно face_skin
        // 2. Не слишком много волос
        // 3. Не слишком много body_skin (рука)
        const isVisible = faceSkinRatio >= minFaceSkinThreshold && 
                          hairRatio < maxHairThreshold && 
                          bodySkinRatio < maxHandThreshold;
        
        // Определяем причину невидимости
        let reason = null;
        if (!isVisible) {
            if (bodySkinRatio >= maxHandThreshold) {
                // Приоритет: рука на лице — самая частая проблема
                reason = 'hand_occlusion';
            } else if (hairRatio >= maxHairThreshold) {
                reason = 'hair_occlusion';
            } else if (faceSkinRatio < minFaceSkinThreshold) {
                if (occlusionRatio > 0.3) {
                    reason = 'object_occlusion';
                } else if (counts.background / total > 0.3) {
                    reason = 'out_of_frame';
                } else {
                    reason = 'low_skin_visibility';
                }
            }
        }

        return {
            isVisible,
            faceSkinRatio: Math.round(faceSkinRatio * 100) / 100,
            bodySkinRatio: Math.round(bodySkinRatio * 100) / 100,  // Отдельно показываем body_skin
            hairRatio: Math.round(hairRatio * 100) / 100,
            occlusionRatio: Math.round(occlusionRatio * 100) / 100,
            backgroundRatio: Math.round((counts.background / total) * 100) / 100,
            bounds: {
                x: areaBounds.x,
                y: areaBounds.y,
                width: areaBounds.width,
                height: areaBounds.height
            },
            pixelCounts: counts,
            thresholds: { 
                minFaceSkin: minFaceSkinThreshold, 
                maxHair: maxHairThreshold,
                maxHand: maxHandThreshold 
            },
            areaName,
            reason,
            // Для обратной совместимости
            skinRatio: Math.round(faceSkinRatio * 100) / 100,
            // Дополнительная инфа для отладки
            landmarkFaceSkinRatio: counts.landmarkFaceSkinRatio,
            landmarkBodySkinRatio: counts.landmarkBodySkinRatio,
            landmarkHairRatio: counts.landmarkHairRatio
        };
    }

    /**
     * Проверка симметрии видимости левой и правой стороны лица
     */
    _checkSymmetry(regions) {
        const leftVisible = (regions.leftCheek?.isVisible ? 1 : 0) + (regions.leftEye?.isVisible ? 1 : 0);
        const rightVisible = (regions.rightCheek?.isVisible ? 1 : 0) + (regions.rightEye?.isVisible ? 1 : 0);
        
        const totalPossible = 2; // щека + глаз на каждой стороне
        const leftRatio = leftVisible / totalPossible;
        const rightRatio = rightVisible / totalPossible;
        
        const asymmetry = Math.abs(leftRatio - rightRatio);
        const isSymmetric = asymmetry <= this.thresholds.maxAsymmetry;
        
        let occludedSide = null;
        if (!isSymmetric) {
            occludedSide = leftRatio < rightRatio ? 'left' : 'right';
        }

        return {
            isSymmetric,
            asymmetry: Math.round(asymmetry * 100) / 100,
            leftVisibility: leftRatio,
            rightVisibility: rightRatio,
            occludedSide
        };
    }

    /**
     * Создание маски визуализации для отладки
     * @returns {ImageData} - данные изображения с визуализацией маски
     */
    createVisualizationMask(segmentationResult, width, height) {
        if (!this._maskCanvas) {
            this._maskCanvas = document.createElement('canvas');
            this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
        }
        
        this._maskCanvas.width = width;
        this._maskCanvas.height = height;
        
        const categoryMask = segmentationResult.categoryMask;
        if (!categoryMask) return null;
        
        const maskData = categoryMask.getAsUint8Array();
        const maskWidth = categoryMask.width;
        const maskHeight = categoryMask.height;
        
        const imageData = this._maskCtx.createImageData(width, height);
        const pixels = imageData.data;
        
        // Цвета для каждого класса
        const classColors = {
            0: [0, 0, 0, 0],        // background - прозрачный
            1: [139, 69, 19, 150],   // hair - коричневый
            2: [255, 218, 185, 150], // body_skin - персиковый
            3: [255, 200, 150, 150], // face_skin - светло-персиковый
            4: [100, 100, 255, 150], // clothes - синий
            5: [128, 128, 128, 150]  // others - серый
        };
        
        // Масштабируем маску до размера кадра
        const scaleX = maskWidth / width;
        const scaleY = maskHeight / height;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const maskX = Math.floor(x * scaleX);
                const maskY = Math.floor(y * scaleY);
                const maskIdx = maskY * maskWidth + maskX;
                
                const classIdx = maskData[maskIdx] || 0;
                const color = classColors[classIdx] || [0, 0, 0, 0];
                
                const pixelIdx = (y * width + x) * 4;
                pixels[pixelIdx] = color[0];
                pixels[pixelIdx + 1] = color[1];
                pixels[pixelIdx + 2] = color[2];
                pixels[pixelIdx + 3] = color[3];
            }
        }
        
        return imageData;
    }

    /**
     * Создание результата ошибки
     */
    _createErrorResult(message) {
        return {
            maskAnalysis: { hasData: false },
            faceVisibility: {
                isComplete: false,
                score: 0,
                issues: [message],
                regions: {}
            },
            isComplete: false,
            score: 0,
            issues: [message],
            error: message,
            timestamp: Date.now()
        };
    }

    /**
     * Получение последнего результата сегментации
     */
    getLastResult() {
        return this.lastResult;
    }

    /**
     * Сброс состояния
     */
    reset() {
        this.lastResult = null;
    }

    /**
     * Освобождение ресурсов
     */
    dispose() {
        if (this.imageSegmenter) {
            this.imageSegmenter.close();
            this.imageSegmenter = null;
        }
        this._maskCanvas = null;
        this._maskCtx = null;
        this.isInitialized = false;
        this.reset();
    }
}

// Экспорт для использования как модуль
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaceSegmenter;
}
