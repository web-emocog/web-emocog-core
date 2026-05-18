// Заглушки для интеграции с будущими модулями.
// Здесь НЕ реализуем I/O, только места подключения.

// Получить кадр видео (ImageData) и метаданные.
// Реальную реализацию даст модуль захвата (web/desktop/stream).
export function getVideoFrameStub() {
  return null; // { imageData, width, height, timestampMs }
}

// Получить landmarks лица (например MediaPipe FaceMesh).
export function getLandmarksStub() {
  return null; // Array of landmarks
}

// Отправить JSON с результатом сессии в хранилище/сервер.
export function sendSessionJsonStub(_sessionJson) {
  // TODO: подключить реальный транспорт (HTTP, файл, IPC и т.д.)
}
