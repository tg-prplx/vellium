# Troubleshooting

Этот раздел помогает быстро диагностировать типовые проблемы при работе с Vellium.

## Быстрый принцип поиска проблемы

Сначала проверьте:

1. Есть ли сохраненный provider profile
2. Назначена ли активная модель
3. Не мешает ли `local-only mode`
4. Не включен ли неподдерживаемый для функции provider type
5. Есть ли нужные collections/plugins/MCP servers

## Частые проблемы

| Симптом | Частая причина | Что сделать |
| --- | --- | --- |
| Чат пишет, что нет активной модели | Не выбран `active provider/model` | Откройте `Settings`, загрузите модели и назначьте active model |
| Provider не сохраняется или не работает | Некорректный URL, local-only блокирует внешний endpoint, не тот provider type | Проверьте `base URL`, `provider type`, local-only ограничения |
| Список моделей пустой | Endpoint не отдает `/models`, либо backend несовместим | Добавьте `manual fallback models` или проверьте совместимость API |
| Tool calling не включается | Активен `KoboldCpp` | Используйте OpenAI-compatible provider для tool calling |
| MCP сервер не отвечает | Неверная команда, args, env или timeout | Проверьте `Command`, `Arguments`, `Environment`, затем нажмите `Test MCP Server` |
| Плагин не активируется | Не выданы permissions или plugin требует первичной конфигурации | Откройте `Settings -> Plugins -> Permissions`, выдайте минимально нужные права и сохраните |
| Плагин установлен, но не видно изменений | Каталог не перезагружен, plugin disabled, нет поддерживаемых extension points | Нажмите `Reload`, проверьте toggle и тип расширения |
| RAG ничего не возвращает | Нет collection, не включен RAG, неподходящий scope, пустой ingestion | Создайте collection, добавьте документы, включите RAG и перепроверьте scope |
| LoreBook не влияет на сцену | Не подключен lorebook, ключи не триггерятся, entry выключена | Проверьте selection lorebook в Chat, `Keys`, `Enabled`, `Constant`, `Position` |
| TTS не воспроизводится | Не настроен TTS provider/model/voice | Откройте TTS блок в Settings и задайте endpoint, model и voice |

## Если Vellium не стартует из репозитория

Проверьте:

- выполнен ли `npm install`
- совпадает ли версия Node с тем, под что собирался `better-sqlite3`
- не сломался ли native module

Если подозрение на native ABI:

```bash
npm run rebuild:native
```

Для Electron-сценария:

```bash
npx electron-rebuild -f -w better-sqlite3 -v 40.4.1
```

## Если desktop-shell ведет себя не так, как web-dev режим

Различайте два сценария:

- `npm run dev` - frontend + API без Electron shell
- `npm run dev:electron` - реальный desktop-shell

Если вы тестируете:

- title bar
- `file://` поведение
- desktop-specific file save/open
- plugin iframe и shell-интеграции

то проверять нужно именно через `npm run dev:electron`.

## Если пропал или испортился prompt behaviour

Проверьте:

- `Chat Mode`
- `Prompt Stack`
- `Default system prompt`
- custom prompt templates
- не включен ли `Pure Chat`

Если причина неясна, самый безопасный путь:

1. Вернуть default prompt stack
2. Проверить default system prompt
3. Протестировать на простом чате без персонажа и без RAG

## Если retrieval слишком шумный

Не начинайте сразу крутить все численные параметры.

Сначала:

- проверьте качество самих документов
- уменьшите шум коллекции
- разделите слишком широкие collection'ы
- убедитесь, что scope соответствует сценарию

Потом уже меняйте:

- top-k
- similarity threshold
- candidate pool
- reranker

## Если RP разваливается на длинной истории

Проверьте:

- context window
- compress model и компрессию
- не слишком ли раздут multi-character контекст
- не перегружен ли prompt stack
- не стоит ли вынести часть мира в LoreBook или Knowledge

## Если нужно все сбросить

В `Settings -> Danger Zone` есть полный сброс настроек.

Используйте его только если:

- вы готовы потерять текущую конфигурацию настроек
- проблема не локализуется точечно
- нужно вернуть приложение к чистому baseline

Перед этим желательно:

- экспортировать важные plugin'ы
- экспортировать character cards
- сохранить важные knowledge texts и notes

## Рекомендуемый fallback-план

Если Vellium ведет себя непредсказуемо:

1. Отключите plugins.
2. Отключите tool calling.
3. Проверьте чат без персонажа, без RAG и без LoreBook.
4. Потом добавляйте по одному слою: персонаж -> lorebook -> RAG -> plugins -> MCP.

Так вы быстрее поймете, где именно находится проблема.
