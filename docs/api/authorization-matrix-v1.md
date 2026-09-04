# Авторизация и tenant scope v1

## Модель доступа

Единый серверный модуль `apps/api/security/permissions.js` отвечает за:

- проверку staff JWT;
- сопоставление `role -> operation`;
- platform-wide scope;
- членство в организации и проекте;
- доступ к протоколу и сессии через проект.

`admin` является техническим именем роли `platform-admin`. Только эта роль
имеет доступ ко всем организациям и проектам. Email-bypass отсутствует:
публичная регистрация создаёт только `respondent`, а bootstrap администратора
выполняется отдельной операционной командой. Для `PI`, `researcher`, `analyst`
и `assistant` одновременно обязательны записи в `user_organizations` и
`user_projects`. `org_admin` имеет доступ к проектам назначенных организаций;
при назначении роли и создании проекта сервер поддерживает соответствующие
project memberships. `developer` предназначен только для технических экранов:
tenant-операции и назначение tenant memberships ему запрещены.

Инструкция для оператора: [Аккаунты и роли](../operations/USER_ROLES.md).
Матрица ниже сверена с текущим `security/permissions.js`; дополнительные
ограничения конкретных маршрутов продолжают действовать.

## Матрица role x operation

`A` - разрешено, `-` - запрещено. Любое разрешение для роли, отличной от
`platform-admin`, действует только внутри явного membership scope.

| Operation | platform-admin | org_admin | PI | researcher | analyst | assistant | developer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `organization.read` | A | A | A | A | A | A | - |
| `organization.manage` | A | A | A | - | - | - | - |
| `project.read` | A | A | A | A | A | A | - |
| `project.create` | A | A | A | A | - | - | - |
| `project.update` | A | A | A | A | - | - | - |
| `project.delete` | A | A | A | - | - | - | - |
| `protocol.read` | A | A | A | A | A | A | - |
| `protocol.write` | A | A | A | A | - | - | - |
| `protocol.publish` | A | A | A | A | - | - | - |
| `invitation.read` | A | A | A | A | A | A | - |
| `invitation.write` | A | A | A | A | - | - | - |
| `session.read` | A | A | A | A | A | A | - |
| `session.write` | A | A | A | A | - | A | - |
| `analytics.read` | A | A | A | A | A | - | - |
| `export.read` | A | A | A | A | A | - | - |
| `stimulus.read` | A | A | A | A | A | A | - |
| `stimulus.write` | A | A | A | A | - | - | - |
| `user.manage` | A | A | A | - | - | - | - |
| `platform.admin` | A | - | - | - | - | - | - |

Роль `respondent` не является staff-ролью и не получает эти операции.
Участник работает только по публичному приглашению и ограниченному ingest
token.

## Own и foreign tenant

| Субъект | Own organization + own project | Own organization + foreign project | Foreign organization | Platform-wide |
| --- | --- | --- | --- | --- |
| `platform-admin` | По матрице | По матрице | По матрице | Разрешено |
| `org_admin` | По матрице | Проекты назначенной организации доступны | Запрещено | Запрещено |
| `PI/researcher/analyst/assistant` | По матрице | Запрещено | Запрещено | Запрещено |
| `developer` | Запрещено | Запрещено | Запрещено | Запрещено |
| `respondent` | Только invitation/session ingest token | Запрещено | Запрещено | Запрещено |

Own project означает наличие обеих связей:

```text
user -> user_organizations -> organization
user -> user_projects -> project -> organization
```

Для `PI/researcher/analyst/assistant` совпадения только по `organization_id`
недостаточно. `org_admin` является явным исключением с organization-wide scope.
Создание новых организаций остаётся отдельной platform-admin операцией.

## Researcher workflow

1. `POST /projects` создает проект только в организации исследователя и сразу
   добавляет его в `user_projects`.
2. `POST /protocols` создает протокол только в доступном проекте.
3. Публикация выполняется созданием приглашения. Сервер одновременно проверяет
   `protocol.publish`, `invitation.write` и membership протокола.
4. Участник открывает опубликованное приглашение и получает ingest token,
   связанный с `session + invitation + protocol + project`.
5. Staff-сессия создается через `POST /sessions/start` с обязательным
   `project_id` или `protocol_id`.
6. `/ingest` принимает один `session_feature.v1`; staff ingest разрешен только
   для уже созданной project-scoped сессии.
7. Аналитика и экспорт повторно проверяют project membership.

Удаление проекта и управление пользователями в workflow роли `researcher`
не входят. Наличие доступа к developer UI не даёт доступ к этому workflow.

## Participant ingest token

```text
POST /invitations/by-code/:code/ingest-token
body: { "session_id": "S-..." }
```

Сервер выдает JWT с:

- `scope=participant:ingest`;
- `sid`;
- `invitation_id` и `invitation_code`;
- `protocol_id`;
- `project_id`;
- `iss=wecog-api`;
- `aud=wecog-participant-ingest`;
- ограниченным временем действия из `INGEST_TOKEN_EXPIRES_IN`.

`POST /ingest` проверяет весь tuple. Неверная session, invitation, protocol или
project возвращает `409`; отсутствующий, истекший или неверно подписанный token
возвращает `401`.

## Критерии приемки

1. Работа принята ответственным по задаче.
2. Все staff-маршруты используют `apps/api/security/permissions.js`.
3. Foreign-tenant запрос не возвращает и не изменяет данные.
4. Только `platform-admin` имеет platform-wide scope.
5. Researcher проходит workflow от создания проекта до analytics/export, но не
   может удалить проект или управлять пользователями. Developer не получает
   tenant-операций, а org_admin не получает platform-wide scope.
6. Participant ingest без server-issued token возвращает `401`.
7. Token mismatch возвращает `409`.
8. `npm test` проходит без ошибок.
9. Работа принята тимлидом/техлидом.
