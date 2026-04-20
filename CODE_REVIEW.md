# Code Review — Кибер Web

Независимое ревью от 4 специалистов по 4 блокам кода.

---

## Executive Summary

**Общая оценка:** крепкий пет-проект. Архитектура host-authoritative + shadow state верная, дизайн-токены в CSS, rules-as-data в `CardDatabase`, container-query доска — всё это выше среднего. Основные проблемы — ожидаемые для single-file vanilla JS: god-класс `GameUI`, слабая валидация на сетевой границе, почти нулевая a11y.

**Топ-10 для починки ДО показа на проверку** (в порядке приоритета):

| # | Файл | Проблема | Severity |
|---|------|----------|----------|
| 1 | game.js:90 | `opp` getter ломает 3p — `Target.Opp` всегда бьёт следующего игрока, третий недосягаем. БЭКДОР/ЗАМЫКАНИЕ/СИНХРОНИЗАЦИЯ в 3p работают неправильно | CRITICAL |
| 2 | game.js:657 | `_isPlacementValid` сравнивает фишки по индексам массива — при reorder отваливается | CRITICAL |
| 3 | ui.js:418 | `_resetUiState` неполный — течёт 10+ полей между играми (`_toastTimer`, `_handoffCallback`, `input.sourceCard`, ...) | CRITICAL |
| 4 | ui.js:2380 / net.js:261 | Нулевая валидация action от guest — shape, pi, phase не проверяются; может крашнуть host | CRITICAL |
| 5 | net.js:307 | `request()` без timeout — если guest отвалился во время prompt, host виснет навсегда | CRITICAL |
| 6 | index.html (везде) | A11y: нет `role="dialog"`, `aria-modal`, focus-trap, focus-visible; `:focus { outline: none }` глобально | CRITICAL |
| 7 | ui.js — весь файл | `GameUI` — god-класс 2500 строк, 80 методов. Нужен split на 6-7 модулей (Board, Card, Modal, Handoff, Online, Synth, Audio) | MAJOR |
| 8 | ui.js:1212 | Event-listener leak: `_makeCardEl` вешает 7 listeners на карту, `_renderHand` зовёт `innerHTML=''` на каждый `_render()` → сотни listeners за матч. Нужна delegation | MAJOR |
| 9 | game.js:21 | `Math.random()` без seed — детерминизма нет, host/guest replay невозможен | MAJOR |
| 10 | index.html:5, глобально | Touch-target < 44px (HIG), нет `touch-action: manipulation`, нет `-webkit-tap-highlight-color` | MAJOR |

---

## game.js — правила и состояние

### CRITICAL
- **opp getter — 3p сломан.** `get opp()` возвращает одного игрока, но `Target.Opp` эффектов (RevealCards, DiscardCards, ModifySupply, SetSupply) использует `(ap + 1) % players.length` — всегда следующий, никогда третий. [game.js:90, 170, 204, 278, 287, 295]
- **Placement validation чувствителен к порядку.** `_isPlacementValid` сравнивает `[r,c]` по индексам. `findMatches` возвращает в порядке итерации по rotation. Валидные расстановки могут reject'иться. Нужно сравнение как set. [game.js:657]
- **Детерминизм.** `shuffle` и `StealCardsEffect` используют `Math.random()`. Если guest когда-то дернёт `deck.draw` локально (на shadow state) — расхождение. Инжектить seeded RNG (`mulberry32`) в `GameState`. [game.js:21, 264]

### MAJOR
- `Phase.Action` / `Phase.Task` — три имени одного значения (комментарий "для старых сохранений"). Удалить если не используется. [game.js:9]
- `CardEffect.None` — не frozen, кто-то может мутировать `.effects`. `Object.freeze` или `new CardEffect([])` inline. [game.js:320]
- `pendingActions` — поле state'а, "EXPERIMENTAL / unverified", нигде не читается. Wire in или remove. [game.js:37]
- Callback-based effects vs Promise — синтез-чейнинг страдает. Refactor `execute()` в Promise упростит будущие фичи (undo/replay/AI). [game.js:589]
- `_rotate90` dedup key `row*100+col` — fragile если когда-то будет карта >10 wide. Использовать `${row},${col},${type}` как на 2 строки ниже. [game.js:354]

### MINOR
- `playCard`/`synthesis` дублируют логику (ownership, validation, score, chip removal). Вынести `_consumePattern()` и `_assertOwned()`. [game.js:474, 533]
- `totalChips = 8` → `CHIPS_PER_PLAYER`. [game.js:35]
- `SUPPLY_MIN = 2, SUPPLY_MAX = 6` → `clampSupply()` helper (3 повторения). [game.js:279, 288, 295]

### ✅ Что хорошо
- `PatternMatcher` ротация + dedup — чисто.
- Композиция эффектов через `CardEffect([...effects])` читается как rulebook.
- `CardDatabase.create` — одна из самых читаемых "rules as data" таблиц.
- Чёткая декомпозиция BoardState / PlayerState / Deck / TurnManager.

**Testability:** файл почти pure. Нужен `TestInput` (30 строк) и `module.exports` под `typeof module !== 'undefined'` — и всё тестируется в Node без DOM.

---

## net.js — онлайн

### CRITICAL
- **Нет валидации action от guest.** `conn.on('data')` форвардит всё в `onMessage`. Вредный/баговый guest может: `endTurn` в чужой ход, подделать `placeChip` coords, спамить `input-res` с чужим `reqId`. Валидация должна быть либо в net.js, либо в `_hostHandleAction` — сейчас нигде. [net.js:261-271]
- **`request()` без timeout и без cleanup.** Guest отвалился после `send()` но до reply → resolver в `_pendingRequests` живёт вечно, host висит. `disconnect()` делает `.clear()` не резолвя awaiters. Добавить 30s timeout + resolve-all-with-null на disconnect. [net.js:307-318, 328]
- **Snapshot не включает `deck.cards` order.** Guest видит только `deckCount`. Если где-то на guest дёрнется `deck.peek`/`deck.draw` через shared path → crash на пустом массиве. Либо документировать контракт, либо `draw()` на shadow должен throw. [net.js:382-385]

### MAJOR
- **Нет sequence numbers.** PeerJS reliable сохраняет порядок per-connection, но на reconnect (`_bindConn` меняет `this.conn`) старые `input-res` могут прийти после нового `input-req` с переиспользованным reqId. `_pendingRequests` не чистится в `_bindConn`. Добавить `snapshotSeq` + clear pending при замене conn. [net.js:216, 251, 328]
- **Reconnect без принудительного re-sync.** Guest шлёт `hello { reconnect: true }`, но host не обязан сразу запушить новый snapshot. Guest может рисовать stale UI. Host должен пушить state на каждый `hello`. [net.js:216-223]
- **Watchdog `_lastPingTs` стартует `Date.now()`.** Dead-on-arrival guest не детектится 15с. Стартовать с 0 + grace 20с. [net.js:284-295]
- **Snapshot masking leak.** `maskHandForPI` маскирует одну руку. В 3p over-net каждый guest увидит руку другого guest'а. Переделать в `maskHandsExcept: pi`. [net.js:346-348]
- **`buildCardsById` → `CardDatabase.create()` на каждый вызов.** Создаёт новые объекты карт. Баг, который уже чинили в ui.js. Добавить `// WARNING:` в net.js и кешировать map на host'е. [net.js:423-428]

### MINOR
- Nested `setTimeout` рекурсия в retry → закрытия растут. Переписать в `async` loop. [net.js:96, 121, 163]
- `msg !== 'object'` молча роняет malformed → хотя бы `_log('warn')`. [net.js:262]
- `snap.placedThisTurn` без `|| []` → crash на partial snapshot. [net.js:417]
- `serializeMatch`/`deserializeMatch` идентичны — один из них лишний. [net.js:436-441]

### ✅ Что хорошо
- Keepalive + watchdog — чистое разделение.
- RPC через `_pendingRequests` + reqId — textbook.
- Классификация ошибок по `e.type` (unavailable-id vs network vs fatal) — вдумчиво.
- Peer-id из короткого кода — элегантно.

---

## ui.js — рендер/взаимодействие (2500 строк, god-класс)

### CRITICAL
- **`_resetUiState` неполный.** Течёт между играми: `_consumedPattern`, `_toastTimer`, `_handoffCallback`, `_cardPickDone`, `_stealPickDone`, `_netPendingInputs`, `_totalCardsPlayed`, `_totalSyntheses`, `_detailRotation`, `_netGameOverShown`, `nodePickAllowed/Remaining/Result`, `input.actionKind/sourceCard/digStep`, overlays `cardDetail/stealPickModal` не force-hidden. Нужен `_fullReset()` со списком всех мутируемых полей. [ui.js:418-434]
- **`_hostHandleAction` — валидация рудиментарна.** Allow-list на lines 2385-2391 по факту не срабатывает. Нет sequence/nonce (дубль = double-play). `args[1]` (chipPositions) не валидируется — null = crash. `args[4]` (aFirst) без boolean-cast. [ui.js:2380-2443]
- **Event-listener leak.** `_makeCardEl` вешает 7 listeners (pointerdown/move/up/leave/cancel/click/selectstart/contextmenu) на карту, `_renderHand`/`_renderRevealed` зовут `innerHTML=''` на каждый `_render()`. На 5×5 поле + 7 карт → ~100 pattern searches + ~75 listeners per tap. Использовать event delegation на `handEl`/`revealedWrap`. [ui.js:964, 982, 1212]
- **`getValidPlacements` O(n²·m) per render.** Зовётся в `_renderHand` для каждой карты hand ∪ revealed на каждый `_render()`. Memoize по `(cardId, boardStateHash)`. [ui.js:744-761, 1467]

### MAJOR
- **God-класс.** Split на `BoardRenderer`, `CardRenderer`, `Modals`, `HandoffFlow`, `OnlineAdapter`, `SynthFlow`, `AudioHaptic`. Даже через `Object.assign(prototype, ...Mixin)` без модулей — когнитивная нагрузка в 2 раза ниже.
- **`innerHTML` rewrites на каждый render** (`oppScoresEl`, `phaseHintEl`, `revealedWrap`, `handEl`, `cardDescBotEl`). Ломает фокус, CSS-анимации (счётчик очков рестартит от 0), скроллы. Расширить targeted-updates как в `_renderBoard`. [ui.js: several]
- **`_fxText` ветвится на `fx.constructor.name`.** Любой минификатор сломает описания. Добавить `static kind = 'PlaceChips'` на классах. [ui.js:1113, 1153]
- **`_hostSendState` без debounce.** На один `playCard` onStateChanged стреляет 3-5 раз, каждый = полный serialize + send. `queueMicrotask` collapse. [ui.js:391-394]
- **Handoff callback гонка с restart.** Если юзер жмёт Restart во время `_showHandoffForChoice`, `_handoffCallback` держит dead TurnManager. [ui.js:1685-1696]
- **7× `netMode && currentPI !== localPI`** — extract `_canAct()`. [ui.js:1247, 1288, 1343, 1361, 1382, 1410, 1427]
- **Phase enum mismatch.** `_updateNetTurnIndicator` мапит phase по string keys, но `state.phase` — number. Всегда fall through → "⏳ Ход соперника · 1" вместо "ход". [ui.js:2558]

### MINOR (dead code)
- `_totalCardsPlayed`, `_totalSyntheses` читаются в `_onGameOver` но никогда не пишутся. [ui.js:1892-1893]
- `_highlightNodes`, `_clearHighlights`, `_highlightEmptyNodes` — no-op. [ui.js:683-685, 1233]
- `endActionBtn` — "удалён", но query и `display:none` остались. [ui.js:545-547]
- `cfgBtn.onclick = () => {}` [ui.js:143-144]
- inline `style="…"` в template literals (десятки) → CSS-классы. [ui.js:1923-1937]
- `_initAudio` до user-gesture — `NotAllowedError` молча давится. Вынести в первый `pointerdown`. [ui.js:214-218]

### ✅ Что хорошо
- `_buildBoard` + SVG overlay — чистое разделение.
- `_normalizedPattern` — элегантный variable-size.
- `_createGuestTM` через Proxy — host/guest UI один код.
- Русская плюрализация в `_fxText` — тщательно.
- `_resolvePendingActions` + `PlayerState.pendingActions` — умный decouple cross-turn эффектов.

---

## index.html — разметка/CSS (2800 строк, inline `<style>`)

### CRITICAL
- **A11y — почти ноль.** 1 `aria-label` на 2804 строки. Нет `<main>/<section>/<h1>`. Overlay-модалки (`handoff`, `card-pick`, `card-detail`, `ingame-menu`, `rules`, `gameover`) без `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, без focus-trap и return-focus. Screen reader читает весь DOM каждый раз.
- **Glyph-only buttons.** `↺`/`↻`, `✕`, rules-tabs, mode buttons — без `aria-label`.
- **`:focus { outline: none }` глобально** на 6 селекторах, без `:focus-visible` fallback. Клавиатурный юзер не видит фокус. [index.html:1838, 1867, 1908, 1924, 1935, 1967]

### MAJOR
- **Touch targets < 44px (WCAG 2.5.5, HIG).** `#hud` 40px, `.hud-menu-btn` ~26px, `#action-bar` 38px, `.btn-rotate`, `#btn-handoff-ok`. [index.html:236, 378, 706]
- **Нет `touch-action` / `-webkit-tap-highlight-color`.** 300ms tap delay + синий flash по всему UI. [html/body]
- **`overscroll-behavior` не задан.** При overflow overlay iOS rubber-band дёргает страницу.
- **`user-scalable=no`** — WCAG 1.4.4 violation. Для игры ОК, но хотя бы закомментировать "намеренно". [index.html:5]
- **17× `!important`** в `.focus-hidden`, `.btn-primary`, `.btn-ghost`. Переделать через specificity. [index.html:1055-1061, 759-769]
- **Backdrop-filter на 7 overlay'ах.** Каждый blur 10-24px. На iPhone SE 1/2 стекинг просядет. Overlay'и обычно fullscreen → blur бесполезен, заменить на сплошной `rgba(0.98)`.
- **FOUT risk — 3 font families, 10 weights remote.** Первый paint в system-font, скачок в Orbitron виден. Self-host WOFF2 subset или `preload`.
- **iPhone SE 1 (320×568) может клипаться.** Media `max-height: 640px` отсутствует — не сжимаются revealed/action vertical bands на экранах <568dvh.
- **Legacy markup повсюду.** `#card-desc-top`, `.hud-tier-2`, `#board-lines`, `.rev-lane-label`, `.rev-lane-hint`, `.card.playable {}`, `.card.unplayable {}` — мёртвые ноды/правила. Удалить — когнитивная нагрузка исчезнет. [lines 1332, 2345, 521, 527, 598, 1088-1089]

### MINOR
- **CSS 2300 строк inline** → вынести в `styles.css?v=...`. HTML станет читаемым, CSS кешируется отдельно.
- **Inline `style="display:none"`** (7 мест) → класс `.hidden`.
- **Naming mix:** `hud-tier-1`, `ps-k`, `hsr-label`, `fi-eff`, `dh-cost` — 6 префиксов. Выбрать один.
- **`grid-row: N` на каждом child** → `grid-template-areas` самодокументируется.
- **`transition` на width/height** на `.node::before` → layout recalc. Использовать `transform: scale()`. [index.html:612]
- **`#online-host-log`** — добавить `role="log" aria-live="polite"` для announce connection updates.

### ✅ Что хорошо
- Z-index token ladder (54-62) — чистый контракт.
- `:root` design tokens — дисциплина.
- Grid `#app` с explicit row-slots — правильный подход для fixed-viewport mobile.
- `container-type: size` + `min(100cqi, 100cqb)` на доске — элегантно, без JS.
- Недавний фикс с коллапсом пустых revealed/desc — корректный.

---

## Рекомендованный порядок работ

1. **Correctness blockers** (пока не исправишь — игра местами работает неправильно)
   - game.js: opp getter в 3p, placement set-equality
   - ui.js: `_resetUiState` полный
   - ui.js: phase name mapping в net indicator

2. **Security/Stability** (онлайн-режим)
   - net.js: timeout на `request()`, cleanup `_pendingRequests`
   - net.js: валидация action при получении
   - net.js: snapshot sequence numbers + clear pending на reconnect
   - ui.js: shape-валидация args в `_hostHandleAction`

3. **Perf** (на слабом iPhone будет заметно)
   - ui.js: event delegation для карт
   - ui.js: memoize `getValidPlacements`
   - ui.js: debounce `_hostSendState`
   - index.html: убрать backdrop-filter на fullscreen overlay'ах

4. **A11y** (must-have для публичного проекта, даже пет)
   - `role="dialog"` + focus-trap на модалках
   - `aria-label` на glyph-buttons
   - `:focus-visible` вместо `outline: none`
   - `touch-action` + tap-highlight глобально

5. **Cleanup** (для впечатления ревьюера)
   - Удалить весь legacy (dead code в ui.js: `_totalCardsPlayed`, `_highlightNodes`, `endActionBtn`; dead CSS/DOM в index.html; `pendingActions` в game.js если не используется)
   - Вынести CSS в `styles.css`
   - Extract test scaffolding для game.js (`TestInput` + `module.exports`)

6. **Architecture** (если есть время)
   - Split `GameUI` на 6-7 mixin'ов/файлов
   - Seeded RNG в `GameState`
   - Promise-based effect pipeline

---

## Что уже сделано хорошо и ревьюер это оценит

- Host-authoritative онлайн с shadow state у guest'а
- Rules-as-data таблица в `CardDatabase`
- Дизайн-токены CSS (`:root`) + z-index layer contract
- Container-query square board (нулевой JS для square-fit)
- Phase-based state machine с чёткими переходами
- `CardEffect` композиция
- Keepalive + watchdog в net.js
- PatternMatcher: rotation + dedup
- Подробный CHANGELOG.md

---

**Вердикт ревьюера в одну строчку:** «Крепко сделанный vanilla-JS пет-проект с правильной онлайн-архитектурой; 10 конкретных исправлений поднимут его на уровень junior+/middle».
