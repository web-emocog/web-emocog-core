/**
 * Visualization
 * 
 * Создание визуализации масок сегментации для отладки
 * 
 * @module face-segmenter/visualization
 */

import { CLASS_COLORS } from './constants.js';

/**
 * Создание маски визуализации для отладки
 * 
 * @param {Object} segmentationResult - результат сегментации от MediaPipe
 * @param {number} width - целевая ширина
 * @param {number} height - целевая высота
 * @param {CanvasRenderingContext2D} ctx - контекст canvas (опционально)
 * @returns {ImageData|null} - данные изображения с визуализацией маски
 */
export function createVisualizationMask(segmentationResult, width, height, ctx = null) {
    // Создаём canvas если контекст не передан
    let canvas, context;
    if (ctx) {
        context = ctx;
        canvas = ctx.canvas;
    } else {
        canvas = document.createElement('canvas');
        context = canvas.getContext('2d', { willReadFrequently: true });
    }
    
    canvas.width = width;
    canvas.height = height;
    
    const categoryMask = segmentationResult.categoryMask;
    if (!categoryMask) return null;
    
    const maskData = categoryMask.getAsUint8Array();
    const maskWidth = categoryMask.width;
    const maskHeight = categoryMask.height;
    
    const imageData = context.createImageData(width, height);
    const pixels = imageData.data;
    
    // Масштабируем маску до размера кадра
    const scaleX = maskWidth / width;
    const scaleY = maskHeight / height;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const maskX = Math.floor(x * scaleX);
            const maskY = Math.floor(y * scaleY);
            const maskIdx = maskY * maskWidth + maskX;
            
            const classIdx = maskData[maskIdx] || 0;
            const color = CLASS_COLORS[classIdx] || [0, 0, 0, 0];
            
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
 * Отрисовка маски на canvas
 * 
 * @param {CanvasRenderingContext2D} ctx - контекст canvas
 * @param {ImageData} maskImageData - данные маски
 */
export function drawMaskOnCanvas(ctx, maskImageData) {
    if (!ctx || !maskImageData) return;
    ctx.putImageData(maskImageData, 0, 0);
}

/**
 * Создание легенды цветов для визуализации
 * 
 * @returns {Array} массив объектов {name, color}
 */
export function getColorLegend() {
    return [
        { name: 'Background', color: 'transparent' },
        { name: 'Hair', color: 'rgb(139, 69, 19)' },
        { name: 'Body Skin', color: 'rgb(255, 218, 185)' },
        { name: 'Face Skin', color: 'rgb(255, 200, 150)' },
        { name: 'Clothes', color: 'rgb(100, 100, 255)' },
        { name: 'Others', color: 'rgb(128, 128, 128)' }
    ];
}
