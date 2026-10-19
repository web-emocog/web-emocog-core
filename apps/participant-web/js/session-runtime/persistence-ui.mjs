const TEXT = {
    ru: {
        local: 'Хранилище браузера недоступно. Разрешите сохранение данных сайта или откройте обычное окно браузера. Сессия ещё не начата.',
        restore: 'Не удалось прочитать сохранённую сессию. Не очищайте данные сайта и не начинайте новое прохождение. Закройте другие вкладки исследования и повторите загрузку; если ошибка останется, обратитесь к исследователю.',
        network: 'Нет ответа от сервера. Проверьте подключение и повторите попытку. Сессия не будет создана повторно.',
        permission: 'Сервер отклонил доступ к сессии. Проверьте приглашение у исследователя.',
        expired: 'Приглашение истекло или исчерпан лимит участников. Обратитесь к исследователю.',
        server: 'На сервере временная ошибка. Повторите попытку позже.',
        invalid: 'Сервер отклонил формат данных. Скачайте JSON и передайте исследователю.',
        prepare: 'Не удалось подготовить резервную копию. Скачайте JSON на финальном экране.',
        saved: 'Промежуточная копия сохранена на сервере.',
        backup: 'Промежуточная копия пока не отправлена. Продолжайте в этой вкладке, не закрывайте её.',
        compact: 'Используется резервное хранилище вкладки. Не закрывайте вкладку: сырые отсчёты могут сохраниться не полностью.',
        finalLocal: 'Не удалось сохранить результат в браузере. Не закрывайте вкладку до успешной отправки или скачивания JSON.',
        checkpointLocal: 'Не удалось сохранить точку восстановления в браузере. Не перезагружайте и не закрывайте эту вкладку; на финальном экране сохраните JSON.'
    },
    en: {
        local: 'Browser storage is unavailable. Allow site storage or use a regular browser window. The experiment has not started.',
        restore: 'The saved session could not be read. Do not clear site data or start another run. Close other study tabs and reload; if the error persists, contact the researcher.',
        network: 'The server did not respond. Check your connection and retry. This will not create a duplicate session.',
        permission: 'The server denied access to this session. Ask the researcher to check the invitation.',
        expired: 'The invitation expired or its participant limit was reached. Contact the researcher.',
        server: 'The server is temporarily unavailable. Please retry later.',
        invalid: 'The server rejected the data format. Download the JSON and send it to the researcher.',
        prepare: 'A backup could not be prepared. Download the JSON on the final screen.',
        saved: 'An interim copy is saved on the server.',
        backup: 'The interim copy has not been uploaded yet. Keep this tab open.',
        compact: 'Tab backup storage is in use. Keep this tab open: raw samples may be incomplete.',
        finalLocal: 'The browser could not save the result. Keep this tab open until upload succeeds or you download the JSON.',
        checkpointLocal: 'The browser could not save a recovery checkpoint. Do not reload or close this tab; download the JSON on the final screen.'
    }
};
export function persistenceErrorCode(error, stage) {
    if (stage === 'local' || error?.code === 'checkpoint_persistence_failed') return 'local';
    const status = error?.httpStatus ?? error?.status;
    if (status === 410) return 'expired';
    if ([401, 403, 404, 409].includes(status)) return 'permission';
    if ([400, 413, 415, 422].includes(status)) return 'invalid';
    return status >= 429 ? 'server' : 'network';
}
export function persistenceMessage(code, lang) { return (TEXT[lang] || TEXT.en)[code] || (TEXT[lang] || TEXT.en).network; }
export function showPersistenceNotice(code, lang) {
    let node = document.getElementById('sessionPersistenceStatus');
    if (!node) {
        node = document.createElement('p'); node.id = 'sessionPersistenceStatus'; node.setAttribute('role', 'status');
        node.style.cssText = 'position:fixed;bottom:10px;left:12px;right:12px;max-width:780px;margin:auto;padding:8px 12px;background:#f8faf8;color:#17332b;border:1px solid #829b8b;border-radius:10px;z-index:1100;font-size:13px;pointer-events:none;';
        document.body.appendChild(node);
    }
    node.textContent = persistenceMessage(code, lang);
    node.dataset.persistenceCode = code;
}
