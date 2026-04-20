# Кибер — веб-версия

Цифровая мобильная версия настольной карточной игры «Кибер». 1v1 PvP онлайн или 2–3 игрока hot-seat на одном устройстве.

**Live:** https://yarnebanan-dotcom.github.io/cyber-game/
**Стек:** vanilla JS, no build step, GitHub Pages (статика).

---

## Запуск локально

```bash
./serve.sh              # поднимает http://localhost:8765
```

Альтернатива без скрипта: `python3 -m http.server 8765`. Dev-сервер только раздаёт статику — никакой сборки или backend'а нет.

## Архитектура

Четыре файла образуют приложение, намеренно без фреймворков и build-шага:

| Файл | Отвечает за | ~Строк |
|------|-------------|--------|
| [`game.js`](game.js) | Правила, карты, game state, TurnManager, эффекты | 755 |
| [`ui.js`](ui.js) | DOM-рендер, взаимодействие, hot-seat, онлайн-клиент | 2600 |
| [`net.js`](net.js) | WebRTC P2P через PeerJS, сериализация state | 450 |
| [`index.html`](index.html) | Разметка + встроенный CSS (design tokens в `:root`) | 2800 |

### Поток данных (hot-seat)

```
user input → ui.js → TurnManager (game.js) → state mutation → ui._render()
```

`TurnManager` содержит всю игровую логику. UI тонкий — только рендер и перехват событий. Эффекты карт (`DrawCards`, `PlaceChips`, `Reveal`, `Discard`, `Steal`, `ModifySupply`, etc.) реализованы как классы с методом `execute(state, actorPI, input, done)`. Когда эффект требует выбор (например, «раскопать 1 из 3»), он вызывает `input.chooseCards(pi, pool, n, onDone)` — UI показывает модал, игрок выбирает, callback возвращает результат в движок.

### Поток данных (онлайн, host-authoritative)

```
guest input → conn.send({type:'action', name, args})
            → host validates + runs via TurnManager
            → host sends full state snapshot
            → guest applies snapshot to shadow state
            → guest renders
```

Хост — источник истины. Guest держит «shadow state» — восстановленный по снимку `GameState` без полной колоды (только `count`). При действиях эффектов, требующих ввод от гостя, хост шлёт `input-req` → guest показывает модал → `input-res` с выбором.

**Защита гостя:** `applySnapshotTo` в [`net.js`](net.js) валидирует форму снимка — размер доски, количество игроков, значения в ячейках. Битый/враждебный снимок отклоняется с `console.warn` без применения.

**Защита хоста:** `_hostHandleAction` в [`ui.js`](ui.js) принимает только действия из whitelist (`placeChip | undoChip | endTurn | drawThree | replenish | playCard | utilizeCard | synthesis`) и с `currentPI === 1` (роль гостя).

## Файловая структура

```
Web/
├── index.html          — разметка, CSS, загрузка скриптов
├── game.js             — движок (GameState, TurnManager, эффекты, CardDatabase)
├── ui.js               — GameUI, рендер, хост/гост логика
├── net.js              — Net class, сериализация, PeerJS wrapper
├── serve.sh            — локальный dev-сервер
├── CHANGELOG.md        — история изменений, обратный хронологический
├── CODE_REVIEW.md      — внутренний ревью (4 параллельных прохода, prioritized findings)
├── _test-*.js          — Playwright end-to-end сценарии (запускать `node _test-xxx.js`)
└── mockup.html         — визуальные черновики (не подключён в игру)
```

## Ключевые решения

- **Единая колода 49 уникальных карт × копии = 54 карты** — используется во всех режимах (2p и 3p). Паттерны карт — 3×3 сетка с клетками `W` (своя/чужая фишка) и `G` (только фишка противника). Карту можно повернуть на 90° при розыгрыше.
- **Mobile-first portrait.** Базовый viewport 375×800. Минимальный поддерживаемый — iPhone SE (375×553 с URL-баром). Вся разметка — CSS Grid с `100dvh` + `env(safe-area-inset-bottom)`.
- **Host-authoritative онлайн.** Никакого гест-side предсказания. Выбор — простота и консистентность, цена — задержка на roundtrip при действиях гостя. Pings каждые 5с, watchdog 15с на pong.
- **Phase enum сводится к двум значениям.** `Phase.Replenish` и `Phase.Turn`; внутри Turn состояние определяется счётчиками `chipsPlaced`/`tasksThisTurn`/`utilizesThisTurn` — см. [`game.js:9`](game.js:9).

## Тестирование

Playwright-сценарии для ручного прогона — имитируют два браузера (host + guest) или одиночный поток. Требуется Chrome.

```bash
node _test-online-quick.js       # базовый connect + первая игра
node _test-online-reconnect.js   # разрыв + восстановление
node _test-e2e-full.js           # полная игра до победы
node _test-fuzz.js               # рандомные действия, поиск краша
```

Автоматических CI-тестов нет — это pet-проект.

## Деплой

```bash
git push                         # GitHub Pages подхватит изменения
```

Cache-bust через query-параметр `?v=YYYYMMDD<letter>` на тегах `<script>` в [`index.html`](index.html). Бампать при каждом релизе, иначе CDN/Safari держат старые файлы.

## Правила игры

Смотреть экран «ПРАВИЛА» в приложении (кнопка в главном меню) или [`CLAUDE.md`](../CLAUDE.md) в корне репозитория.
