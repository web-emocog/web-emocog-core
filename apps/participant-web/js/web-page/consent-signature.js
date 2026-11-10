/**
 * ========================================
 * CONSENT SIGNATURE MODULE v1.0
 * ========================================
 * Модуль для создания цифровой подписи документов участником.
 * 
 * Функции:
 * - Генерация hash документа (SHA-256)
 * - Создание подписи с timestamp и participant ID
 * - Сохранение в state.sessionData.consent
 * 
 * Автор: EmoCog Research Team
 * Дата: 15.03.2026
 */

function noteConsentFailure(event) {
    try {
        const debug = window.WECOG_DEBUG;
        if (debug?.enabled) debug.error('consent', event);
    } catch (_) { /* Consent is independent of the optional logger. */ }
}

/**
 * Вычисляет SHA-256 hash текста документа
 * @param {string} documentText - Полный текст документа
 * @returns {Promise<string>} - Hex-строка hash (64 символа)
 */
async function generateDocumentHash(documentText) {
    try {
        // Кодируем текст в Uint8Array
        const encoder = new TextEncoder();
        const data = encoder.encode(documentText);
        
        // Вычисляем SHA-256
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        
        // Конвертируем в hex-строку
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        return hashHex;
    } catch (_) {
        noteConsentFailure('document:hash-failed');
        return null;
    }
}

// ========================================
// 2. ЗАГРУЗКА ДОКУМЕНТА И ГЕНЕРАЦИЯ HASH
// ========================================

/**
 * Загружает HTML-документ и вычисляет его hash
 * @param {string} documentUrl - Путь к HTML-файлу (например, 'documents/informed-consent-v1.0.html')
 * @returns {Promise<Object>} - { text, hash, version }
 */
async function loadDocumentAndHash(documentUrl) {
    const controller = new AbortController();
    // Cover response.text(), not only response headers: a stalled document
    // must not leave the consent screen pending indefinitely.
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(documentUrl, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const htmlText = await response.text();
        
        // Извлекаем версию из URL (например, "v1.0")
        const versionMatch = documentUrl.match(/v(\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : '1.0';
        
        // Генерируем hash
        const hash = await generateDocumentHash(htmlText);
        
        return {
            text: htmlText,
            hash: hash,
            version: version,
            url: documentUrl
        };
    } catch (_) {
        noteConsentFailure('document:load-failed');
        return null;
    } finally {
        clearTimeout(deadline);
    }
}

// ========================================
// 3. СОЗДАНИЕ ЦИФРОВОЙ ПОДПИСИ
// ========================================

/**
 * Создаёт цифровую подпись участника для документа
 * @param {string} documentType - Тип документа ('informed_consent' или 'privacy_policy')
 * @param {Object} documentData - Данные документа { hash, version, url }
 * @param {string} participantId - UUID участника
 * @returns {Promise<Object>} - Объект подписи
 */
async function createConsentSignature(documentType, documentData, participantId) {
    try {
        const signature = {
            documentType: documentType,
            documentVersion: documentData.version,
            documentHash: documentData.hash,
            documentUrl: documentData.url,
            participantId: participantId,
            signedAt: new Date().toISOString(),
            language: navigator.language || 'unknown'
        };

        return signature;
        
    } catch (_) {
        noteConsentFailure('signature:create-failed');
        return null;
    }
}

// ========================================
// 4. СОХРАНЕНИЕ ПОДПИСИ В STATE
// ========================================

/**
 * Сохраняет подпись в state.sessionData.consent
 * @param {Object} signature - Объект подписи
 * @param {Object} state - Глобальный state приложения
 */
function saveConsentSignature(signature, state) {
    if (!state.sessionData.consent) {
        state.sessionData.consent = {};
    }
    
    // Сохраняем подпись по типу документа
    const docType = signature.documentType;
    state.sessionData.consent[docType] = signature;
}

// ========================================
// 5. ГЛАВНАЯ ФУНКЦИЯ: ПОДПИСАНИЕ ДОКУМЕНТА
// ========================================

/**
 * Полный процесс подписания документа участником
 * @param {string} documentType - 'informed_consent' или 'privacy_policy'
 * @param {string} documentUrl - Путь к HTML-файлу
 * @param {string} participantId - UUID участника
 * @param {Object} state - Глобальный state приложения
 * @returns {Promise<boolean>} - true если успешно, false если ошибка
 */
async function signDocument(documentType, documentUrl, participantId, state) {
    try {
        // 1. Загружаем документ и вычисляем hash
        const documentData = await loadDocumentAndHash(documentUrl);
        if (!documentData || !documentData.hash) {
            throw new Error('Failed to load document or generate hash');
        }
        
        // 2. Создаём подпись
        const signature = await createConsentSignature(
            documentType,
            documentData,
            participantId
        );
        
        if (!signature) {
            throw new Error('Failed to create signature');
        }
        
        // 3. Сохраняем в state
        saveConsentSignature(signature, state);
        
        return true;
        
    } catch (_) {
        noteConsentFailure('signature:failed');
        return false;
    }
}

// ========================================
// 6. ЭКСПОРТ ФУНКЦИЙ
// ========================================

window.ConsentSignature = {
    generateDocumentHash,
    loadDocumentAndHash,
    createConsentSignature,
    saveConsentSignature,
    signDocument
};
