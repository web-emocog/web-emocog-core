# Архитектура проекта

## Компоненты
- apps/participant-web — интерфейс участника + сбор событий
- apps/researcher-web — интерфейс исследователя + QC/дашборды
- apps/api — auth, sessions, ingestion, export
- ml/runtime — browser ML inference (face/gaze/blinks/emotions)
- packages/shared — общие типы, события, схемы

## Поток данных
participant → events → api → агрегаты → researcher
