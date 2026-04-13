# Settings и Providers

`Settings` в Vellium - это не просто экран с общими переключателями. Это центр маршрутизации моделей, UI-поведения, контекста, security-политик, plugins и MCP.

## Категории настроек

Vellium делит настройки на крупные категории:

| Категория | Что внутри |
| --- | --- |
| `Connection` | Провайдеры, активная модель, translation/compress/TTS модели |
| `Backends` | Managed backends |
| `Interface` | Общие UI-настройки и workspace mode |
| `Generation` | Output behaviour, sampler defaults, API param forwarding |
| `Context` | Context window, chat behaviour, scene fields, RAG |
| `Prompts` | Prompt templates, prompt stack, default system prompts |
| `Tools & MCP` | Tool calling, security, plugins, MCP servers/functions, reset |

## Connection: провайдеры и модели

### Быстрые пресеты

Из `Settings` и `Welcome` можно быстро поднять provider profile из пресета:

- `OpenAI`
- `LM Studio`
- `Ollama`
- `KoboldCpp`
- `OpenRouter`
- `Custom`

### Manual provider

Если готовый пресет не подходит, можно настроить провайдера вручную. Обычно редактируются:

- provider ID
- display name
- base URL
- API key
- provider type
- local-only flag
- manual fallback models

### Типы провайдеров

Vellium различает:

- `OpenAI-compatible`
- `KoboldCpp`
- `Custom adapter`

Это важно, потому что не все функции доступны для всех типов одинаково.

### Active model routing

В Settings задается не только provider profile, но и активная рабочая модель, которую использует `Chat` прямо сейчас.

Если она не назначена, основные workflow будут неполными.

## Раздельные модели под разные задачи

Vellium умеет держать отдельные модели/провайдеры для:

- перевода
- компрессии контекста
- TTS
- embedding/RAG
- reranker

Это одно из главных преимуществ Vellium как workbench-инструмента: вам не нужно заставлять один и тот же endpoint делать все.

## Runtime mode и local-only политика

Через `runtime mode` и local-only ограничения можно контролировать, разрешены ли:

- только локальные endpoint'ы
- private LAN endpoint'ы
- внешние удаленные endpoint'ы

Это особенно полезно в приватных, локальных или self-hosted инсталляциях.

## Backends

Раздел `Backends` нужен, если вы хотите управлять локально запускаемыми backend-процессами рядом с Vellium.

По коду видно, что экран рассчитан на:

- managed backends
- import CLI command
- runtime state / logs

Используйте его, если у вас сложный self-hosted стек и вы хотите централизовать запуск рядом с приложением.

## Interface

В `Interface` обычно настраивают:

- язык интерфейса
- response language
- theme
- plugin theme
- simple mode / workspace mode

Если Vellium используется несколькими людьми на одной машине, имеет смысл зафиксировать эти настройки сразу.

## Generation

Здесь сосредоточены параметры, влияющие на стиль и форму генерации:

- output behaviour
- sampler defaults
- API parameter forwarding

Особенно важен блок `API param forwarding`, потому что он определяет, какие generation-параметры реально передаются backend'у.

## Context

В `Context` лежат настройки, которые сильнее всего влияют на длинные диалоги и RP:

- context window
- conversation behaviour
- scene field visibility
- RAG model
- reranker
- retrieval tuning

Если чат становится нестабильным на длинной истории, сюда стоит смотреть одним из первых.

## Prompts

Этот раздел отвечает за системный слой генерации:

- prompt templates
- prompt stack
- default system prompts

Prompt stack в Vellium состоит из блоков вроде:

- `system`
- `jailbreak`
- `character`
- `author_note`
- `lore`
- `scene`
- `history`

Это ключевой раздел для тех, кто тонко настраивает RP или хочет жестко контролировать структуру промпта.

## Tools & MCP

### Tool calling

В `Tools & MCP` можно:

- включить `Enable Tool Calling`
- выбрать политику: `Conservative`, `Balanced`, `Aggressive`
- задать лимит вызовов за ход
- включить `Auto-attach MCP tools`

Важно:

- для `KoboldCpp` tool calling отключен
- для OpenAI-compatible providers он может быть активен

### Security

В security-блоке управляются как минимум такие переключатели:

- sanitize markdown HTML
- allow external links
- allow remote images
- allow unsafe uploads

Это напрямую влияет на то, как Vellium будет рендерить модельный markdown и обращаться с внешними ресурсами.

### Plugins

Из `Settings -> Plugins` можно:

- установить plugin из `Pluginfile`
- экспортировать plugin обратно в `Pluginfile`
- перезагрузить каталог
- скопировать путь к plugins directory
- открыть plugin settings
- управлять permissions
- включать и выключать plugins

### MCP Functions

В этом блоке Vellium:

- загружает доступные функции с MCP servers
- показывает их группами по серверу
- позволяет точечно отключать вызов конкретных функций

### MCP Servers

Для каждого MCP server можно задать:

- `Server ID`
- `Display Name`
- `Command`
- `Arguments`
- `Environment`
- `Enabled`
- `Timeout`

Также сервер можно:

- импортировать из URL или JSON
- протестировать
- сохранить
- удалить

## Danger Zone

В `Danger Zone` находится полный сброс настроек к значениям по умолчанию.

Используйте этот раздел только если:

- конфигурация явно зашла в тупик
- вы хотите начать настройку заново
- нужно быстро очистить экспериментальный state

## Рекомендуемые профили настройки

### Локальный RP-стек

- provider: `LM Studio`, `Ollama` или `KoboldCpp`
- local-only: включен
- simple mode: на ваше усмотрение
- RAG: только при наличии collections
- tool calling: если нужен и если provider совместим

### Универсальный удаленный стек

- provider: `OpenAI` или `OpenRouter`
- local-only: выключен
- translation/compress/TTS: можно развести на разные модели
- tool calling: включать только после настройки MCP

### Писательский стек

- отдельная writer-friendly модель
- отдельная compress model
- отдельная embedding model
- Book Bible + Knowledge collections + summary lenses

## Практические советы

- Не пытайтесь сразу настроить все разделы. Сначала `Connection`, потом `Context`, потом `Prompts`.
- Если меняете backend, всегда перепроверяйте активную модель.
- Если что-то перестало работать после экспериментов с prompt stack, откатите default prompts раньше, чем будете менять provider.
- Plugins и MCP лучше включать после того, как базовый chat flow уже стабилен.
