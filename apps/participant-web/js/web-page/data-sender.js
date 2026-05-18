/**
 * data-sender.js
 * Модуль отправки данных сессии на сервер wecog.ru
 *
 * Использование:
 *   import { sendSessionData } from './data-sender.js';
 *   const result = await sendSessionData(state.sessionData);
 */

// ─────────────────────────────────────────────
// КОНФИГУРАЦИЯ
// ─────────────────────────────────────────────

const SENDER_CONFIG = {
    // TODO: Юля уточняет реальный endpoint
    BASE_URL: 'https://wecog.ru',
    ENDPOINT: '/api/sessions',          // placeholder — заменить на реальный

    // Retry-логика
    MAX_RETRIES: 3,
    RETRY_DELAYS_MS: [2000, 5000, 10000], // экспоненциальная задержка

    // Таймаут одного запроса (большой JSON может весить несколько МБ)
    REQUEST_TIMEOUT_MS: 30000,

    // Версия формата данных (для серверной валидации)
    PAYLOAD_VERSION: '1.0.0',
};

// ─────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ─────────────────────────────────────────────

/**
 * Задержка через Promise
 * @param {number} ms
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fetch с таймаутом через AbortController
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timerId);
    }
}

/**
 * Определяем — стоит ли повторять запрос по коду ответа
 * Не повторяем: 400 (плохие данные), 401/403 (авторизация), 422 (валидация)
 * Повторяем:    429 (rate limit), 5xx (серверные ошибки), сетевые ошибки
 * @param {number|null} statusCode — null если сетевая ошибка / таймаут
 */
function isRetryable(statusCode) {
    if (statusCode === null) return true;           // сетевая ошибка / таймаут
    if (statusCode === 429) return true;            // rate limit
    if (statusCode >= 500 && statusCode < 600) return true; // серверные ошибки
    return false;
}

// ─────────────────────────────────────────────
// ПОДГОТОВКА PAYLOAD
// ─────────────────────────────────────────────

/**
 * Оборачивает sessionData в конверт с метаданными отправки
 * @param {object} sessionData — state.sessionData
 * @returns {object}
 */
function buildPayload(sessionData) {
    return {
        // Метаданные конверта
        _meta: {
            payloadVersion: SENDER_CONFIG.PAYLOAD_VERSION,
            sentAt: new Date().toISOString(),
            userAgent: navigator.userAgent,
            origin: window.location.origin,
        },

        // Идентификаторы (дублируем на верхний уровень для удобства серверной маршрутизации)
        sessionId:     sessionData?.ids?.session     ?? null,
        participantId: sessionData?.ids?.participant ?? null,

        // Полные данные сессии
        data: sessionData,
    };
}

// ─────────────────────────────────────────────
// ОСНОВНАЯ ФУНКЦИЯ ОТПРАВКИ
// ─────────────────────────────────────────────

/**
 * Отправляет данные сессии на сервер с retry-логикой
 *
 * @param {object} sessionData — state.sessionData
 * @param {object} [options]
 * @param {function} [options.onRetry]   — колбэк при каждой попытке: (attempt, maxRetries, error) => void
 * @param {function} [options.onSuccess] — колбэк при успехе: (responseBody) => void
 * @param {function} [options.onFailure] — колбэк при финальной ошибке: (error) => void
 *
 * @returns {Promise<{ success: boolean, status: number|null, body: any, attempts: number, error: string|null }>}
 */
export async function sendSessionData(sessionData, options = {}) {
    const url = `${SENDER_CONFIG.BASE_URL}${SENDER_CONFIG.ENDPOINT}`;
    const payload = buildPayload(sessionData);

    let lastError = null;
    let lastStatus = null;

    // Сериализуем один раз — не хотим делать это на каждой попытке
    let bodyJson;
    try {
        bodyJson = JSON.stringify(payload);
    } catch (serializeError) {
        const msg = `[DataSender] Ошибка сериализации JSON: ${serializeError.message}`;
        console.error(msg);
        options.onFailure?.(serializeError);
        return { success: false, status: null, body: null, attempts: 0, error: msg };
    }

    const totalAttempts = 1 + SENDER_CONFIG.MAX_RETRIES;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        const isLastAttempt = attempt === totalAttempts;

        console.log(`[DataSender] Попытка ${attempt}/${totalAttempts} → ${url}`);
        options.onRetry?.(attempt, totalAttempts, lastError);

        try {
            const response = await fetchWithTimeout(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept':       'application/json',
                        // TODO: добавить авторизацию когда Юля даст токен:
                        // 'Authorization': `Bearer ${API_TOKEN}`,
                    },
                    body: bodyJson,
                },
                SENDER_CONFIG.REQUEST_TIMEOUT_MS
            );

            lastStatus = response.status;

            // Пробуем распарсить тело ответа
            let responseBody = null;
            try {
                responseBody = await response.json();
            } catch {
                // Сервер вернул не-JSON (например, пустой 200 OK) — это нормально
                responseBody = null;
            }

            if (response.ok) {
                // ✅ Успех
                console.log(`[DataSender] ✅ Успешно отправлено (${response.status}), попытка ${attempt}`);
                options.onSuccess?.(responseBody);
                return {
                    success: true,
                    status:  response.status,
                    body:    responseBody,
                    attempts: attempt,
                    error:   null,
                };
            }

            // ❌ HTTP-ошибка
            lastError = `HTTP ${response.status}`;
            console.warn(`[DataSender] ❌ HTTP ${response.status} на попытке ${attempt}`);

            if (!isRetryable(response.status) || isLastAttempt) {
                // Не повторяем (4xx) или исчерпали попытки
                break;
            }

        } catch (networkError) {
            // Сетевая ошибка или таймаут (AbortError)
            lastStatus = null;
            lastError = networkError.name === 'AbortError'
                ? `Таймаут (${SENDER_CONFIG.REQUEST_TIMEOUT_MS}ms)`
                : networkError.message;

            console.warn(`[DataSender] ⚠️ Сетевая ошибка на попытке ${attempt}: ${lastError}`);

            if (isLastAttempt) break;
        }

        // Ждём перед следующей попыткой
        const waitMs = SENDER_CONFIG.RETRY_DELAYS_MS[attempt - 1] ?? 10000;
        console.log(`[DataSender] Ждём ${waitMs}ms перед следующей попыткой...`);
        await delay(waitMs);
    }

    // Все попытки исчерпаны
    const finalError = `Не удалось отправить данные после ${totalAttempts} попыток. Последняя ошибка: ${lastError}`;
    console.error(`[DataSender] 💥 ${finalError}`);
    options.onFailure?.(new Error(finalError));

    return {
        success:  false,
        status:   lastStatus,
        body:     null,
        attempts: totalAttempts,
        error:    finalError,
    };
}

// ─────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНАЯ: только скачать (резервный путь)
// ─────────────────────────────────────────────

/**
 * Скачивает sessionData как JSON-файл (резервный путь если сервер недоступен)
 * Дублирует логику из ui.js — используется внутри handleSendWithFallback
 * @param {object} sessionData
 */
export function downloadSessionDataFallback(sessionData) {
    try {
        const json = JSON.stringify(sessionData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const sessionId = sessionData?.ids?.session ?? 'unknown';
        a.href     = url;
        a.download = `wecog_session_${sessionId}_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        console.log('[DataSender] 💾 Данные скачаны локально как резервная копия');
    } catch (e) {
        console.error('[DataSender] Ошибка скачивания резервной копии:', e);
    }
}

// ─────────────────────────────────────────────
// ВЫСОКОУРОВНЕВАЯ ФУНКЦИЯ: отправить + fallback
// ─────────────────────────────────────────────

/**
 * Главная точка входа для finishSession():
 * 1. Пытается отправить данные на сервер
 * 2. Если не удалось — автоматически скачивает JSON локально
 * 3. Возвращает статус для обновления UI
 *
 * @param {object} sessionData — state.sessionData
 * @param {object} [uiCallbacks]
 * @param {function} [uiCallbacks.onSending]  — UI: "Отправляем данные..."
 * @param {function} [uiCallbacks.onSuccess]  — UI: "Данные отправлены ✅"
 * @param {function} [uiCallbacks.onFallback] — UI: "Сервер недоступен, скачиваем локально"
 *
 * @returns {Promise<{ sent: boolean, downloaded: boolean, attempts: number }>}
 */
export async function handleSendWithFallback(sessionData, uiCallbacks = {}) {
    uiCallbacks.onSending?.();

    const result = await sendSessionData(sessionData, {
        onRetry: (attempt, max) => {
            console.log(`[DataSender] Повтор ${attempt}/${max}...`);
        },
    });

    if (result.success) {
        uiCallbacks.onSuccess?.(result);
        return { sent: true, downloaded: false, attempts: result.attempts };
    }

    // Сервер недоступен — скачиваем локально как резервную копию
    console.warn('[DataSender] Сервер недоступен, активируем fallback-скачивание');
    uiCallbacks.onFallback?.(result);
    downloadSessionDataFallback(sessionData);

    return { sent: false, downloaded: true, attempts: result.attempts };
}