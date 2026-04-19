# История изменений — Web

> Веб-версия «Кибер» · GitHub Pages: https://yarnebanan-dotcom.github.io/cyber-game/
>
> Формат: обратный хронологический, сгруппировано по датам. Последние изменения сверху.

---

## 2026-04-19 — Унификация колоды: старая 2p-колода удалена

- До: в `game.js` и `net.js` было ветвление `playerCount === 3 ? CardDatabase.create3() : CardDatabase.create()`. Старый `create()` содержал 2p-колоду с переменными сетками (3×3/4×4/5×5), новая `create3()` — одинаковые 3×3. Режимы 2p и 3p давали **разные** карты (разные id, разные паттерны), что усложняло сопровождение и путалось в документации.
- Решение пользователя: старая колода больше не используется, остаётся только одна — та, что была `create3()`. Возвращаться к теме больше не будем.
- Фикс: в `CardDatabase` оставлен единственный `create()` с актуальным набором (ранее — тело `create3()`). Удалены старая реализация `create()` и функция `create3()`. Удалены все ветвления `playerCount === 3 ? create3() : create()` в [game.js:88](Web/game.js:88), [net.js:317](Web/net.js:317), [ui.js:1040](Web/ui.js:1040) — везде теперь просто `CardDatabase.create()`. `buildCardsById(playerCount)` оставлен для совместимости сигнатуры, но параметр игнорирует.
- Документация: `CLAUDE.md` обновлён — убраны упоминания двух колод, обновлена таблица карт (все 3×3, без колонки GRID), добавлен фиксирующий блок «Важно про колоду: в проекте одна колода на все режимы».
- Регрессия: fuzz 1000 матчей 2p — 0 крашей, 49 уникальных карт в игре (совпадает с размером колоды). Scenarios 11/11. `_test-online-steal` ✓ (blind+revealed). `_test-visual-online` 7/7.

---

## 2026-04-19 — Онлайн: сетевая кража карт (chooseStealSource)

- До фикса: `chooseStealSource` в `input`-прокси [ui.js:341](Web/ui.js:341) для не-локального actor'а (когда actor=гость) автоматически выбирал первую доступную цель — без интерактивного выбора у жертвы. Карты УЯЗВИМОСТЬ / ИНЪЕКЦИЯ КОДА / РЕКУРСИЯ / РЕФАКТОРИНГ в онлайне работали «криво» когда их играл гость.
- Фикс: добавил RPC-ветку по паттерну `chooseCards`/`chooseNodes`. Host сериализует `ctx` в payload (`revealedPool` → массив `{cardId, ownerPI}`, `opponents` → `{pi, handCount}`) и через `net.request('chooseStealSource', ...)` запрашивает guest'а. Guest в `_guestHandleInputReq` восстанавливает `ctx.revealedPool` через `cardsById`, показывает `_showStealPick`, ответ отправляет обратно через `respondToRequest`. Host резолвит и передаёт реальный объект карты.
- Fallback: если guest не нашёл карту (карта ушла из пула между request и response) или вернул невалидный ответ — host выбирает первую доступную цель, чтобы игра не зависла.
- Тест `_test-online-steal.js` проверяет оба пути (blind + revealed) через прямой вызов `input.chooseStealSource` на host'е с моком ctx. Оба PASS: blind-btns=1 → `{type:blind, ownerPI:0}`, rev-items=1 → `{type:revealed, cardId:8, cardName:УЯЗВИМОСТЬ, ownerPI:0}`.

---

## 2026-04-19 — Стартовая раздача карт всем игрокам

- До фикса: в `ui.startGame()` вызывался `tm.replenish()`, который добирает карты **только у current player**. У игрока 2 до его первого хода была пустая рука — в онлайне он физически ничего не мог тапнуть и прочитать описания карт пока ходит соперник. В hot-seat это было скрыто handoff-экраном, но фикс одинаково правильный для обоих режимов.
- Фикс: перед `tm.replenish()` проходим по всем `state.players` и добираем каждому до `supply` (3). Первый replenish становится no-op у current player (рука уже полная), остальные игроки получают старт с 3 картами.
- Тап/long-press по карте у неактивного игрока уже работали (описание + поворот паттерна) — блокировался только розыгрыш через `_onCardTap` (корректно). Теперь у игрока 2 есть **что** тапать с самого первого хода соперника.
- Синхронизация: раздача происходит до `_hostSendState()` (первый снапшот после replenish), гость получает state с уже розданными руками, через `serializeGameState(st, maskHandForPI=0)` маскируется только рука хоста.
- `_test-visual-online.js` / `_test-visual-phones.js`: 7/7 OK в обоих, руки видны на `05-host-connected` (3 карты хоста) и `06-guest-connected` (3 карты гостя — другие).

---

## 2026-04-19 — Онлайн: visual-тест + фикс tooltip'а «Ход соперника»

- `_test-visual-online.js` — Playwright с **двумя контекстами параллельно** (host+guest): по очереди на 7 viewport'ах поднимает хост, ловит 4-значный код, поднимает гостя, вводит код, дожидается синхронизации через WebRTC, ставит 2 фишки — 8 скриншотов на устройство (меню обеих сторон, код ожидания, ввод кода, оба подключённых экрана, оба после хода).
- Фикс перекрытия: `#net-turn-indicator` (плашка «⏳ Ход соперника · …») был `bottom: 6px` и наезжал на `#action-bar` (height 38px, grid-row 9) — на Galaxy-Fold и iPhone-5 кнопка «ЗАВЕРШИТЬ ХОД» перекрывалась плашкой. Поднял до `bottom: 52px` (+ `@media (max-width:360px)` → 50px, font 10px, padding 4×10), добавил `white-space: nowrap; max-width: calc(100vw - 16px)`.
- Локализация фазы: в `_updateNetTurnIndicator()` словарь `phaseNames` не знал `Phase.Turn` (унификация Action/Task → Turn была сделана раньше, словарь остался старый) → плашка показывала «Ход соперника · Turn». Добавил `Turn: 'ход'`.
- Итог: **7/7 viewport'ов без перекрытий и без горизонтального скролла.**

---

## 2026-04-19 — Фикс сетки паттерна на карте — 0.5px → 1px

- `.card-pattern-grid { gap: 0.5px; padding: 0.5px; }` → `1px`. На экранах с `devicePixelRatio=3` (Galaxy-Fold, большинство Android) 0.5px CSS = 1.5 физических пикселей и округлялся неравномерно: по одной оси 1px, по другой 2px, поэтому сетка выглядела как «вертикальные столбцы без горизонтальных линий» вместо квадратных ячеек. 1px рендерится стабильно на любых DPR.
- Повторный `_test-visual-phones.js`: сетка 3×3 / 4×4 / 5×5 теперь одинаково видна на всех viewport'ах.

---

## 2026-04-19 — Адаптация вёрстки для узких экранов (≤360px)

- `@media (max-width: 360px)` + двойной лейбл на `#btn-utilize` (`<span class="lbl-full">Утилизировать</span><span class="lbl-short">Утил.</span>`): на широких экранах полное слово, на узких — короткое. До фикса на iPhone-5 / Galaxy-Fold «УТИЛИЗИРОВАТЬ» обрезалось в «УТИЛИЗИРО…».
- В модале паузы: `.pause-snap-row .ps-k` min-width 92→68px, font-size 10→9px на узких экранах. До фикса на Galaxy-Fold 280px почти все строки PHASE/TURN/ACTIVE/ELAPSED/DECK/HAND заворачивались в 2 строки — теперь 5 из 6 в одну строку (остался только PHASE из-за 3 индикаторов).
- Проверено повторным прогоном `_test-visual-phones.js` — 7/7 viewport'ов OK.

---

## 2026-04-19 — Visual-тест на 7 мобильных viewport'ах

- `_test-visual-phones.js` — Playwright-скрипт: по очереди ставит iPhone-SE / iPhone-14 / iPhone-14 Pro Max / Pixel-5 / Galaxy-S20 / Galaxy-Fold (280px!) / iPhone-5 (320px), проходит все ключевые экраны (меню, правила, онлайн, 3p+hard, доска в игре, после размещения фишек, зум карты через long-press, in-game пауза) и делает 8 скриншотов на устройство. Проверяет отсутствие горизонтального скролла и элементов за правой границей.
- Обход анимации радара: вместо `page.click(selector)` используем `page.evaluate(s => document.querySelector(s).click())` — Playwright stable-check заваливается на бесконечной CSS-анимации фона.
- Итог: **7/7 viewport'ов без переполнений.** Минорная косметика на экранах ≤320px — обрезание длинных названий (например, «УТИЛИЗИРОВАТЬ» → «УТИЛИЗИРО…») через ellipsis; на Galaxy-Fold 280px метки PHASE/TURN в паузе оборачиваются в 2 строки. Функциональность не ломается.
- `screenshots/` в `.gitignore` — артефакты регенерируются, 13MB в репо не нужны.

---

## 2026-04-19 — Targeted-сценарии (reshuffle / synth / hard-mode)

- `_test-scenarios.js` — 11 hand-crafted тестов через vm-контекст `game.js`, без браузера, ~150ms на прогон. Покрывают узкие места, которые fuzz случайно не добивает:
    - **Reshuffle** (3 теста): выкачиваем колоду в сброс → draw(1) провоцирует reshuffle, сумма карт = 54; draw при пустой колоде+сброс возвращает меньше; 10 циклов reshuffle подряд не теряют карты.
    - **Синтез** (3 теста, hard mode): hand-crafted БАЙТ+БИТ с общей фишкой в (1,1) — оба cost в score, обе карты в сбросе, фишка снята один раз; synthesis без общей фишки → `invalidAction`; synthesis в easy mode → `invalidAction`.
    - **Hard-mode drawThree** (5 тестов): `drawThree` в easy → `invalidAction`; в hard добавляет 3 карты, обнуляет `chipsAllowed`, блокирует placeChip и повторный drawThree; endTurn без фишек без drawThree → `bonusChipsNextTurn=1` → на следующий ход `chipsAllowed=3`; endTurn с drawThree или с фишкой бонуса НЕ даёт.
- Итог: **11 pass, 0 fail** с первого прогона.

---

## 2026-04-19 — E2E full-game тест host+guest через Playwright

- `_test-e2e-full.js` — полный e2e-матч через настоящий UI двух браузерных контекстов (host + guest на http://localhost:8765). Агент ставит фишки, ищет playable карты, кликает паттерн, обрабатывает все RPC-модалы: card-pick, steal-pick, node-pick (PlaceChipsEffect), synth-order, handoff. Параллельный `otherDrainer` закрывает чужие модалы (когда эффект требует ввода у противника через input-req). Fallback: если розыгрыш не удался — попытка утилизации через `#btn-utilize`; в hard-mode `drawThree` вместо размещения когда ход не содержит никаких действий.
- `waitQuiescent(host, guest, 1500)` + `stateEqRetry(6×120ms)` — вместо моментальной сверки ждём «тишины» (нет открытых модалов и pending-очереди у обоих), потом до 6 попыток сравнить `currentPI/phase/deck/discard/scores/supply/chipsOnBoard/revealed`. Покрывает задержку доставки WebRTC-снапшотов после хода.
- **Bugfix теста, не движка**: `drainModals` искал `.card` в `#card-pick-list`, хотя в реальной разметке `_showCardPick` кладёт `.pick-item`. Из-за этого card-pick-модал на HOST никогда не закрывался — `playCard` висел в ожидании `chooseCards` callback, на HOST мутировал `pl.score += cost` (строка 490 `game.js`), снапшот гостю НЕ отправлялся (нет `_notify`). Тест ошибочно интерпретировал это как рассинхрон движка. Также исправлено `#synth-order-modal` → `#synth-order-panel` (реальный id в `index.html`).
- Финальный прогон: **37 ходов до game-over, 2p, winner=0, scores=[15,0], 0 desync, 0 crash, gameOverOverlay=true** (321с). Полный живой матч host+guest через WebRTC, от коннекта до победного экрана, без единой рассинхронизации.

---

## 2026-04-19 — Fuzz-тест + фикс дубликата карты при Discard(Opp)

- `_test-fuzz.js` — headless fuzz без браузера: загружает `game.js` через `vm`, сидированный Mulberry32 RNG, случайный валидный агент, инварианты после каждого хода (supply∈[2,6], chipsOnBoard сверка с доской, уникальность карт по ссылке, размер колоды). Прогоняет 1000 матчей за ~1.5с (646 игр/сек 2p). Режимы: 2p / 2ph / 3p / 3ph. Резолвит `pendingActions` перед replenish как это делает UI.
- **Bugfix `game.js` `DiscardCardsEffect`** — source-card исключалась из пула только при `target===Self`. Когда игрок разыгрывал **чужую raskrytую карту** с эффектом `сбросить ВСЕ/N (противник)` (ЧЕРВЬ СЕТИ, ТЕРНАРНЫЙ ОПЕРАТОР), source лежал в `tp.revealed` противника → эффект сбрасывал саму карту → затем `playCard` делал ещё один `st.discard.push(card)` → одна и та же карта оказывалась в сбросе дважды. Фикс: фильтровать source из пула всегда, независимо от target.
- Проверено: 4×1000 партий (2p/2ph/3p/3ph) без крашей. До фикса fuzz находил ~5-6 дублей на 1000 игр в каждом режиме с воспроизводимым seed.

---

## 2026-04-19 — Онлайн: убрана автоподсветка пустых узлов + фикс остаточных highlight

- `ui.js` `_renderBoard` — удалена ветка авто-`highlighted` для пустых узлов (`canPlaceChips && occ===0`). Игрок и так видит, что узлы пустые; дополнительная подсветка только путала и ломалась на ходе соперника. Подсветка остаётся только для `allowedSet` (выбор узлов эффектом).
- `ui.js` `_onPhaseChanged` — упрощён: теперь просто `_clearHighlights() + _updatePhaseHint()`, без авто-хайлайта.
- `ui.js` `_onNodeTap` — убраны вызовы `_highlightEmptyNodes()` после undo/place фишки.
- `ui.js` `_guestApplyState` — убран блок `if (myTurn && canPlaceChips) _highlightEmptyNodes()`, остался `_clearHighlights()`.
- `ui.js` `_handleNodePick` — **bugfix**: при завершении node-pick обнулялся только `nodePickDone`, но `nodePickAllowed` и `nodePickResult` оставались — из-за чего следующий `_renderBoard` снова подсвечивал старые разрешённые клетки. Теперь обе массивы чистятся.
- Тестирование: Playwright e2e, 2 контекста (host+guest), карта БИТ инъецирована в руку гостя и разыграна по сети (score 0→1, hand 4→3, discard=1, снапшоты синхронны). 4 раунда цикла без ошибок, `highlighted=0` на обоих клиентах во всех состояниях.

---

## 2026-04-19 — Онлайн: фикс мигания доски у гостя + документация протокола

- `ui.js` `_renderBoard` — подсветка пустых узлов перенесена внутрь единого ре-рендера: `canPlaceChips = phase===Turn && isMyTurn && !nodePickDone && chipsPlaced<chipsAllowed && reserve>0`. Теперь `.highlighted` живёт только ту фазу, когда игрок реально может ставить фишки, и `_render()` больше не стирает её побочно — пульсация не «мигает» на чужом ходу.
- `ui.js` `_onPhaseChanged` — добавлен guard `isOppTurnNet = netMode && currentPI !== localPI`: в онлайне на ходу соперника `_highlightEmptyNodes()` не вызывается.
- `net.js` — поправлен комментарий протокола: `{ type: 'action', action, ...args }` → `{ type: 'action', name, args }` (реальный формат из `_createGuestTM`).
- Онлайн протестирован end-to-end (host/guest в одном контексте через `new Peer()`): connect, snapshot, `replenish`/`placeChip`/`endTurn` actions, keepalive ping, disconnect detection — всё работает.

---

## 2026-04-19 — Долгое нажатие на карту — анимированный поворот паттерна

- `ui.js` `_renderHandCard` — `pointerdown` запускает таймер 350ms, затем `setInterval(rotate, 450)`; `pointerup/leave/cancel` останавливают. `pointermove` с threshold 8px отменяет (чтобы не конфликтовать со скроллом руки).
- Первый `rotate` срабатывает сразу при переходе в long-press, далее каждые 450ms. Использует существующую `rotate()` (обновляет `_cardRotations`, `card-pattern-grid` transform и `.card-corner` label).
- Флаг `didHoldRotate` подавляет следующий `click`, чтобы hold не триггерил выбор карты в Turn-фазе. Быстрый тап (<350ms) работает как раньше.

---

## 2026-04-19 — Меню: HARD MODE переименован, правила на русском, вкладка ХАРД

- `index.html` — кнопка `#btn-hard-mode`: убран чекбокс `[ ]/[x]`, остались только «HARD MODE» + subtitle «РАСШИРЕННЫЕ ПРАВИЛА» (центрированный текст). CSS: `.menu-hard { text-align: center }`, убран `.hm-check`.
- `ui.js` — убрана логика переключения `[ ]`↔`[x]`, остался только toggle `.active`.
- `index.html` — футер меню: «▤ RULES» → «▤ ПРАВИЛА».
- `index.html` — кнопки режимов: «2 ИГРОКА · 4×4» / «3 ИГРОКА · 5×5» → «2 ИГРОКА» / «3 ИГРОКА» (размер поля убран, он следует из режима).
- `index.html` — правила: удалена отдельная вкладка `СИНТЕЗ`, добавлена вкладка `ХАРД` (`data-pane="5"`) с 4 блоками: описание Хард мода, Альт.1 Пропуск (+1 фишка), Альт.2 +3 Добор, Синтез (с карточками LOOP+SYNC и full description). Вкладка `СИНТЕЗ` больше не нужна — весь её контент в ХАРД.

---

## 2026-04-19 — Fix: раскрытая/разыгранная карта не попадает в свой же reveal/discard-пул

Баг: при розыгрыше/утилизации карты с эффектом «раскрыть N (себе)» или «сбросить N (себе)» сама эта карта присутствовала в модалке выбора, и её можно было выбрать. Это некорректно — карта уже обрабатывается движком и в конце пойдёт в сброс / останется на стороне игрока.

- `game.js` `RevealCardsEffect.execute` — при `target === Self` фильтрует `inp.sourceCard` из пула перед `chooseCards`.
- `game.js` `DiscardCardsEffect.execute` — то же самое для `hand` и `revealed`.
- Для `Target.Opp` поведение не меняется (источник у противника физически отсутствует).

---

## 2026-04-19 — После розыгрыша карты комбинация визуально гаснет + конкретный hint

Раньше при розыгрыше карты с эффектом «поставить фишки» (напр., МИГРАЦИЯ, БРАНДМАУЭР, ПЕРЕЗАГРУЗКА, ИТЕРАЦИЯ и т.п.) фишки разыгранной комбинации оставались на доске до конца эффекта (per rules), а hint показывал безликое «Выбери N узлов». Игрок не понимал, что комбинация уже сработала и теперь надо ставить новые фишки.

Теперь (UI-only, state не меняется — правила сохранены):

- `ui.js` `_consumedPattern: Set<"r,c">` — хранит позиции только что разыгранной комбинации на время `playCard`; сбрасывается в callback.
- `_renderBoard` добавляет `.consumed` на эти узлы.
- `index.html` CSS — `.node.consumed::before { opacity: 0; animation: none; transition: opacity 0.3s }` — фишки плавно гаснут.
- `_updatePhaseHint` — при `nodePickDone && _consumedPattern` текст = «Поставь N фишк(у/и/ек) на доске» (вместо «Выбери N узлов»).
- Попутно починил: `_renderBoard` теперь сохраняет классы `.highlighted` (разрешённые узлы) и `.selected-node` — раньше `cell.className =` затирал подсветку сразу после `_highlightNodes`, из-за чего игрок не видел куда можно ставить.

---

## 2026-04-19 — Кнопка «Завершить ход» не пропадает во время sub-действий

Раньше во время node-pick (ставь фишку) или синтеза кнопка `btn-skip` скрывалась (`display: none`), и пользователь мог решить, что она пропала навсегда. Теперь:

- `ui.js` `_render` — кнопка видна всю фазу хода (`display = inTurn ? '' : 'none'`), независимо от `inSynth`/`inNodePick`.
- `ui.js` `_onEndTurn` — при `nodePickDone` показывает «Сначала заверши текущее действие», при `synth` — «Сначала заверши синтез». Ход не завершается.

---

## 2026-04-19 — Fix: карта в раскрытых не обрезается сверху/снизу

В `.rev-lane` было `padding: 6px 8px`, из-за чего при `--card-zone-height: 88px` внутренняя высота строки опускалась до 72px и карта 76px обрезалась. Поменял на `padding: 0 8px` — теперь row = 83px, карта влезает полностью, как в руке.

---

## 2026-04-19 — Убраны подсказки о наличии розыгрышей

Игроку больше не даются подсказки о том, есть ли у него валидные розыгрыши — это стратегическая информация, которую он должен считать сам.

- **Стрелка `▶` на раскрытых картах** (`index.html`) — удалено правило `#revealed-wrap .rev-lane .card.playable::after`. Раньше появлялась рядом с названием карты в общей зоне раскрытых, если её можно разыграть на текущей доске.
- **Кнопка «Завершить ход»** (`ui.js` `_render`) — всегда `btn-primary` (оранжевая), всегда текст `⏭ Завершить ход`. Убраны суффиксы `(нет ходов)` / `(нет розыгрышей)` и переключение в `btn-ghost`.

---

## 2026-04-19 — UI-09e · Все 4 слота фиксированной высоты, доска не дёргается

По запросу пользователя: раскрытые, доска, описание карты и рука одновременно видимы на экране всегда, с **фиксированными** размерами. При выборе/снятии выбора карты или появлении раскрытой — ничего не сдвигается. Верхний слот описания (top) больше не используется, всё идёт в нижний.

**Зафиксированные высоты (`Web/index.html`):**
- `#phase-hint` — `height: 28px` (раньше 27↔30 скакал из-за переноса текста).
- `.revealed-wrap` — `height: 72px` (раньше 50↔88 скакал при появлении карт).
- `.card-desc` — `height: 72px` (раньше 0↔92 скакал при выборе карты).
- `#hand-wrap` — `height: 110px` (раньше +2px при `translateY` selected-карты).
- `.rev-lane .card` — `58×52` (было 66×58) — компактная карта в lane.
- `.card` (рука) — `82×88` (было 88×96, а до того 108×112) — сжата ещё раз ради бюджета.
- `#app gap: 5px → 3px` — экономия 16px по вертикали на 9 строках.

**Изменено в `Web/ui.js`:**
- `_renderCardDesc` — верхний слот всегда `.empty` (display:none). Нижний всегда заполнен: описание выбранной карты или плейсхолдер.

**Замеры при переключении состояний (size check):**

| Сценарий | Viewport | Без выбора | С выбранной | С раскрытой картой |
|---|---|---|---|---|
| 2p | 375×667 | board 232 / desc 72 / rev 72 / hand 110 | **идентично** | **идентично** |
| 3p HARD | 360×640 | board 205 / desc 72 / rev 72 / hand 110 | **идентично** | **идентично** |

Доска на 360×640 5×5: 41px/клетка. На 375×667 4×4: 58px/клетка.
Console errors: 0.

---

## 2026-04-19 — UI-09d · Нижний слот описания всегда видим + уменьшены карты в руке

По запросу пользователя `#card-desc-bot` (между доской и рукой) теперь виден всегда — при отсутствии выбранной карты показывает плейсхолдер «— выбери карту · описание эффекта —» в dashed-рамке. Чтобы освободить место под постоянный слот описания, карты в руке уменьшены со 108×112 до 88×96.

**Изменено в `Web/index.html`:**
- `.card-desc.placeholder` — новый класс: dashed border, mono 9px, uppercase, opacity 0.55, padding 8×10. Виден когда нет выбора.
- `.card` — `108×112 → 88×96`, `padding 6px → 5px`.
- `.card-cost` — `18×18 → 16×16`, font `10px → 9px`.
- `.card-name` — font `9px → 8px`, letter-spacing `0.12em → 0.1em`, padding `2px → 1px`, line-height `1.2 → 1.15`.

**Изменено в `Web/ui.js`:**
- `_renderCardDesc` — если `_descCard = null`: нижний слот получает плейсхолдер (`placeholder` класс, текст-подсказка), верхний чистится в `.empty`. Если выбрана карта из руки — bot заполняется описанием; если раскрытая — top заполняется, bot возвращается в placeholder.

**Замеры (375×667, 2p):**
- Без выбора: доска 257×257 (64px/клетка 4×4), плейсхолдер 31px, карта руки 88×96.
- С выбранной: доска 241×241, описание 49px.

**Замеры (360×640, 3p HARD):**
- Без выбора: доска 230×230 (46px/клетка 5×5), плейсхолдер 31px.
- С выбранной: доска 171×171 (34px/клетка), описание 92px — в худшем сценарии всё читаемо.

Console errors: 0.

---

## 2026-04-19 — UI-09c · Зона раскрытых карт всегда видима

По запросу пользователя: даже при отсутствии раскрытых карт слот `#revealed-wrap` остаётся видимым с плейсхолдером «— пусто —» и счётчиком «0 КАРТ». Это даёт визуальную стабильность: игрок сразу знает где появятся раскрытые карты и не путается при первом их появлении (раньше layout прыгал при первом reveal).

**Изменено в `Web/ui.js`:**
- `_renderRevealed` — больше не ставит класс `.collapsed` при пустой зоне, всегда рендерит `.rev-lane`.
- `_makeRevealedLane` — если `entries.length === 0`, добавляет класс `.empty` и placeholder-row вместо карт.

**Изменено в `Web/index.html`:**
- `.rev-lane.empty` — `padding`, `opacity: 0.55`, центрованный placeholder row `min-height: 28px`.
- `.rev-lane-placeholder` — mono 9px, uppercase, цвет `--text-ghost`.

**Замеры (375×667, 2p):**
- Пустая зона: `#revealed-wrap` 50px, доска 272×272.
- Зона с 1 картой: 88px, доска 234×234.

Console errors: 0.

---

## 2026-04-19 — UI-09b · Два in-flow слота описания карт (вместо overlay)

По запросу пользователя overlay-подход заменён на два выделенных слота в grid-раскладке: описание раскрытой карты появляется **сразу под зоной раскрытых**, описание карты в руке — **между доской и рукой**. Теперь при выборе карты виден её эффект, но доска немного уменьшается (~92px). Tradeoff принят сознательно — overlay перекрывал руку и путал читаемость.

**Изменено в `Web/index.html`:**
- `#app` — grid расширен с 7 до 9 rows: `auto auto auto auto 1fr auto auto auto auto`. Добавлены `#card-desc-top` (row 4, после `#revealed-wrap`) и `#card-desc-bot` (row 6, между board и hand).
- `.card-desc` — `position: absolute` overlay → `position: static` in-flow. Убраны `left/right/bottom/z-index/box-shadow` (больше не нужны). `max-height: 104px → 92px`, `padding: 6px 8px → 5px 8px`.
- `.card-desc.empty { display: none }` — пустой слот полностью сворачивается, track не отбирает у доски.
- HTML — `<div id="card-desc">` один заменён на `<div id="card-desc-top">` (после revealed-wrap) и `<div id="card-desc-bot">` (после board-wrap, перед hand-wrap).

**Изменено в `Web/ui.js`:**
- `_bindElements` — `this.cardDescEl` → `this.cardDescTopEl` + `this.cardDescBotEl`.
- `_renderCardDesc` — определяет источник выбранной карты: если находится в `players[*].revealed` → рендерит в верхний слот, иначе (рука / прочее) → в нижний. Второй слот всегда чистится/прячется.
- `_initLayoutObserver` и его вызов из конструктора **удалены** — overlay больше нет, `--action-h` не нужен.

**Проверено в preview:**

| Сценарий | Viewport | Слот с описанием | Доска |
|---|---|---|---|
| 2p без выбора | 375×667 | оба пустые | 363×363 |
| 2p · тап карты в руке | 375×667 | `#card-desc-bot` 77px | 247×247 |
| 2p · тап раскрытой карты | 375×667 | `#card-desc-top` 77px | 159×159 |
| 3p HARD · тап карты в руке | 360×640 | `#card-desc-bot` 92px | 205×205 (41px/cell) |
| 3p HARD без выбора | 360×640 | оба пустые | 295×295 (59px/cell) |

Console errors: 0.

---

## 2026-04-19 — UI-09 · Viewport-aware layout system (P0-1 + P0-3 + P0-4)

Радикальная переделка корневой раскладки после глобального аудита ([DESIGN-AUDIT.md](DESIGN-AUDIT.md)). Точечные фиксы UI-05…UI-08 меняли размеры карт, но не решали настоящую причину оверлапа: flex-shrink-chain в `#app` + `aspect-ratio` на доске + рост `#card-desc` внутри `#hand-wrap`. Этот коммит устраняет все три P0 разом.

**Изменено в `Web/index.html`:**
- `#app` — `display: flex; flex-direction: column` → `display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto 1fr auto auto auto`. Слоты: hud / phase-hint / revealed / board / hand / synth / action-bar. Явные `grid-row` на каждом child — при `display:none` track сохраняется, `1fr` всегда достаётся доске.
- `#board-wrap` — `flex:1 + flex-center` → `display:grid; place-items:center; container-type: size`. Contained layout делает board sizing предсказуемым.
- `#board` — `width: min(100%, calc(100dvh*0.38)); max-height:100%` → `width: min(100cqi, 100cqb); height: min(100cqi, 100cqb); aspect-ratio:1`. Container queries гарантируют квадрат, fits в меньшую сторону контейнера. Добавлен `grid-template-rows: repeat(N, 1fr)`.
- `#board.size-5` — override для 5×5 режима.
- `.card-desc` — `position: static` внутри `#hand-wrap` → `position: absolute` overlay над action-bar. Привязка `bottom: calc(var(--action-h, 52px) + safe-area + 10px)`. `max-height: 110px → 104px`. Добавлены `z-index: 5` и `box-shadow` для читаемости поверх руки.
- `#hand-wrap` — убран `flex: 0 0 auto` (атавизм flex-раскладки), добавлен `min-width: 0`.
- `#action-bar` — добавлены `max-height: 48px` (предотвращает 2-строчный wrap в hard mode) и `white-space: nowrap; text-overflow: ellipsis` на `.btn`.
- HTML: `#card-desc` вынесен из `#hand-wrap` в прямого child `#app` (position:absolute, не занимает grid-cell).

**Изменено в `Web/ui.js`:**
- `_buildBoard` — добавлен `gridTemplateRows: repeat(N, 1fr)` и класс `.size-5` на `#board`.
- `constructor` → `_initLayoutObserver` — `ResizeObserver` на `#action-bar` прокидывает `--action-h` в `#app`. Это якорь для `.card-desc` overlay. Слушает также `resize` и `orientationchange`.

**Проверено в preview (живые замеры):**

| Сценарий | Viewport | До UI-09 | После UI-09 |
|---|---|---|---|
| 2p 4×4 clean | 375×667 | board 181.6px, оверлап | **board 332×332, nodes 75px**, no overlap |
| 2p 4×4 + card selected + 2 revealed/сторону | 375×667 | board 152px, 10 нодов скрыто | **board 246×246, nodes 54px**, все видно, overlay card-desc 104px |
| 3p 5×5 HARD + card selected + 3 revealed/сторону | 360×640 | board 142×22 (сломана!), buttons wrap | **board 219×219, nodes 39px, 25/25 видно**, buttons single-row 112px |
| HARD action-bar (3 кнопки) | 360×640 | 68px 2 строки | 39px 1 строка, ellipsis на длинных |

**Что НЕ делалось (скоуп):**
- P1/P2 issues остаются (revealed redesign → UI-10, touch targets → UI-11, landscape → UI-12)
- Карты размера 112/66 из UI-05…UI-08 не тронуты — они функционируют корректно внутри новой grid-раскладки

**Побочные баги найдены и поправлены:**
- Без `minmax(0, 1fr)` на grid-column action-bar с `nowrap` кнопками раздвигал сетку до 480px при viewport 360.
- Без явных `grid-row` на children, `display:none` элементы (`.hidden`, `.collapsed`) скипали track у auto-placement, смещая `1fr` c доски на руку (доска получала 0px!).

---

## 2026-04-19 — UI-08 · Компактная карта в руке + центровка узора на всех картах

У карт в руке (108×128) имя заканчивалось на ~105px, снизу оставалось ~18px пустоты. Высота подогнана; паттерн теперь растягивается на всю свободную высоту между header и name, удерживая узор ровно по центру и горизонтально, и вертикально.

**Изменено в `Web/index.html`:**
- `.card` — `height: 128px → 112px`
- `.card-pattern` — `flex: 0 0 auto → flex: 1 1 auto`, добавлен `min-height: 0` (узор теперь абсорбирует свободное место, grid остаётся центрированным за счёт `align-items:center; justify-content:center`)

**Проверено в preview (2p, 375×667):**
- Hand card: 108×112, header 7..25, pattern 25..88 (63px), name 88..105. Grid 58×58 центрирован: left=25, right=25, вертикально 2/2px относительно padding паттерна.
- Rev card: 58×66, pattern пересчитался под flex:1 (17..52), name 53..62. Визуально — узор ровно посередине между кост-плашкой и именем.

---

## 2026-04-19 — UI-07 · Срезана пустота снизу у карт «Раскрыто»

У компактных карт после UI-06 имя заканчивалось на ~60px при высоте 82px — снизу было ~22px пустого места. Высота подогнана под реальный контент.

**Изменено в `Web/index.html`:**
- `.rev-lane .card` — `height: 82px → 66px`

**Проверено в preview (2p, 375×667):**
- Карта 58×66px, контент занимает всю высоту (имя заканчивается на 60px + 3px padding).
- Зона `#revealed-wrap`: 104px → 88px.
- Доска: 217px → 233px.

---

## 2026-04-19 — UI-06 · Компактные карты в «Раскрыто» — доска больше не зажимается

После UI-05 наезд руки исчез, но зона `#revealed-wrap` сверху всё ещё занимала 168px — доска сжималась до ~152px. Карты в ряду «Раскрыто» уменьшены: `96×146 → 58×82` (-40% по ширине, -44% по высоте). Шрифты и паттерн-сетка перерасчитаны под новый размер.

**Изменено в `Web/index.html`:**
- `.rev-lane .card` — `width: 96px → 58px`, `height: 146px → 82px`, `padding: 4px → 3px`, `border-radius: 4px → 3px`
- `.rev-lane .card-name` — `font-size: 7.5px → 6px`, `letter-spacing: 0.08em → 0.04em`, `padding: 1px 0 → 0`, добавлен `line-height: 1.1`
- `.rev-lane .card-cost` — `14px → 11px`, `font-size: 9px → 7px`
- `.rev-lane .card-pattern-grid` — `width: 58% → 70%` (пропорционально меньшей карте)

**Проверено в preview (2p, 375×667, по 2 раскрытые на обоих игроках):**
- Зона `#revealed-wrap`: 168px → 104px.
- Доска: 152.5px → 217px (+42%).
- overlapRevBoard = false, overlapBoardHand = false.
- Карта ⅕ по высоте экрана, узнаваема: видны cost, паттерн, имя.

---

## 2026-04-19 — UI-05 · Убраны эффекты с карт + уменьшена высота

Карты в руке больше не показывают блок описания эффектов — эта информация дублировала `#card-desc` внизу экрана, который появляется при тапе по карте. Карты стали ниже (168→128px), доска получила больше места, наезда руки на поле больше нет даже на коротких экранах (375×667).

**Удалено:**
- `ui.js::_makeCardEl` — строка `<div class="card-fx-compact">${this._describeEffectsCompact(card)}</div>` из шаблона карты
- `ui.js::_describeEffectsCompact` и `ui.js::_fxCompact` — мёртвые методы
- `index.html` — CSS-блок `.card-fx-compact` и всех вложенных `.fx-row/.fx-kind/.fx-act/.fx-opp` (~50 строк); также `.rev-lane .card-fx-compact`

**Изменено:**
- `index.html::.card` — `height: 168px → 128px`

**Проверено в preview (2p, 375×667):**
- Карта показывает только `[cost]`, паттерн и имя — как в настольной версии.
- `#card-desc` внизу по-прежнему открывает полное описание при тапе.
- board bottom 419, hand top 462 — чистый зазор 43px, наезда нет.
- Консоль чистая.

---

## 2026-04-19 — FIX-26 · Финальная чистка placement-panel

Снесён мёртвый DOM и методы `placement-panel`, которые были оставлены скрытыми после перехода на V3 focus-mode. Поведение UI не меняется — только удаление кода, который уже не вызывался.

**Удалено из `Web/index.html`:**
- DOM-блок `<div id="placement-panel">` со всеми дочерними элементами (`#btn-synth-cancel`, `#pp-card-preview`, `#pp-hint`, `#pp-rotnav`, `#btn-prev`, `#placement-count`, `#btn-next`, `#btn-confirm`, `#btn-synth`)
- CSS-секция `#placement-panel`, `.pp-head`, `.pp-lbl`, `.pp-close`, `.pp-body`, `.pp-card-wrap`, `.pp-card-top`, `.pp-card-cost`, `.pp-card-rot`, `.pp-card-pattern`, `.pp-card-name`, `.pp-info`, `.pp-hint`, `.pp-rotnav`, `.pp-arr`, `#placement-count`, `.pp-actions`, `.pp-btn`, `#btn-confirm.pp-btn-hot`, `#btn-synth.pp-btn-ghost`
- Media-query `@media (max-height: 700px)` с правилами для `#placement-panel`

**Удалено из `Web/ui.js`:**
- Поле `this.placementIndex` в конструкторе
- Биндинги `this.placementPanel`, `this.placementCount` и хендлеры `btn-prev/btn-next/btn-confirm/btn-synth/btn-synth-cancel` в `_bindElements`
- Методы `_showCardSelectedPanel`, `_prevPlacement`, `_nextPlacement`, `_updatePlacementHighlight`, `_confirmPlacement`
- Все вызовы `this.placementPanel.classList.add('hidden')` (в `_cancelPendingCard`, `_onCardTap`, `_onSynthNext`, `_cancelSynth`, `_onEndTurn`, `_onPatternNodeTap`)

**Что осталось:**
- `this.currentPlacements` — используется в синтезе (`placementsA`) и `_hasSynthPartner`
- `_hasSynthPartner` — нужен для показа `#fi-synth` в focus-info
- Фокус-мод (`_syncFocusMode`, `_fillFocusInfo`, `_updateFocusCount`) — весь flow выбора карты / совпадения паттерна идёт через него

**Проверено в preview (2p, без hardMode):**
- Перезагрузка страницы: `#placement-panel`, `#btn-prev/next/confirm/synth/synth-cancel` не существуют в DOM, `window.ui` инициализирован.
- Стартовая партия → фаза Turn: поставил 2 фишки через `tm.placeChip(0,0)/(0,1)` → `chipsPlaced=2`, `board.nodes[0][0]=1`.
- Тап по карте БАЙТ (MC:W) → focus-mode активирован (`#hand-cards.focus-mode`), `.focus-info` содержит имя, эффект `▶ раскопай 1 карту (+2 в сброс)`, счётчик `0/1`. `pendingCard='БАЙТ'`, `currentPlacements=2`.
- Тап по узлу (0,0) → открылся `#card-pick-modal` с двумя вариантами раскопки.
- Выбор ИНКАПСУЛЯЦИЯ → ПОДТВЕРДИТЬ → modal закрыт, `tasksThisTurn=1`, `discardLen=2` (2 сброшенных), `handSize=4` (1 добрана), `chip[0][0]=0` (фишка снята), `focusModeActive=false`.
- Консоль: никаких ошибок на всём прогоне.

**Зачем:** `placement-panel` функционально был заменён V3 focus-mode ещё в предыдущих фиксах, но DOM+CSS+5 методов оставались в коде как «на всякий случай». Теперь удалены — ~220 строк CSS, ~80 строк JS, 22 строки HTML.

---

## 2026-04-19 — HARD-01 · Альтернативы размещения фишек в Hard mode

Закрыт TODO из REF-01: реализованы две альтернативы действию «поставить 2 фишки» в Hard mode. Правила обычного режима не затронуты.

**Альтернатива 1 — «Пропуск → +1 фишка на следующий ход».** Если в Hard mode игрок завершает ход, не поставив ни одной фишки и не использовав добор — на его следующий ход `chipsAllowed = 3` (одноразово, бонус сгорает в начале хода). Карты разыгрывать/утилизировать в пропускаемый ход можно.

**Альтернатива 2 — «＋3 Добор».** Кнопка в action-bar (cyan border, рядом с «✦ Утилизировать»). Видна только в Hard mode и только когда `chipsPlaced === 0 && !drewThreeThisTurn && deck+discard > 0`. При клике — 3 карты из колоды в руку, `chipsAllowed = 0`, `drewThreeThisTurn = true`. Кнопка пропадает, хинт фазы: «Добор использован · разыгрывай карты / завершай ход». Бонус +1 за пропуск после добора **не** выдаётся.

**Код:**
- `game.js::PlayerState` — поле `bonusChipsNextTurn` (0/1)
- `game.js::GameState` — поле `drewThreeThisTurn`
- `game.js::TurnManager.endTurn` — при hardMode && chipsPlaced===0 && !drewThreeThisTurn → `cp.bonusChipsNextTurn = 1`
- `game.js::TurnManager.drawThree()` — новый метод с гейтами (hardMode, Phase.Turn, !drewThreeThisTurn, chipsPlaced===0)
- `game.js::TurnManager._toTurn` — применяет и обнуляет `bonusChipsNextTurn`, сбрасывает `drewThreeThisTurn`
- `net.js` — сериализация `bonusChipsNextTurn`, `drewThreeThisTurn`, `hardMode`; `applySnapshotTo` восстанавливает их
- `ui.js` — `_onDrawThree`, action-router `case 'drawThree'`, guest TM proxy `drawThree`, гейт видимости в `_render`, новые ветки в `_updatePhaseHint` для drewThree и bonusChip
- `index.html` — кнопка `#btn-draw-three` и её стиль `.btn-draw-three`

**Проверено в preview (hardMode=true, 2p):**
- Старт: chipsAllowed=2, кнопка видна, хинт «Ставь фишки».
- Клик «＋3 Добор» → handSize 3→6, deck 50→47, chipsAllowed=0, drewThree=true, кнопка скрыта, хинт «Добор использован · завершай ход». `drawThreeResult==='ok'`.
- endTurn после добора → p1.bonusChipsNextTurn=0 (бонуса нет).
- p2 endTurn без размещения и без добора → p2.bonusChipsNextTurn=1.
- Возврат хода к p2 → chipsAllowed=3 (бонус применился), p2.bonusChipsNextTurn=0 (сгорел), хинт «Ставь фишки · бонус +1 за пропуск ●3/3».
- После `placeChip(0,0)` → chipsPlaced=1, кнопка добора скрыта, `drawThree()` возвращает `'invalidAction'`.
- Консоль чистая.

---

## 2026-04-19 — FIX-27 · Онлайн: у игрока 2 не появлялись карты

**Баг:** `GameState` всегда создавал колоду через `CardDatabase.create3()` (ID 1001+), независимо от `playerCount`. При этом `buildCardsById(2)` (net.js) строил карту `id→card` из `CardDatabase.create()` (ID 1..53). Результат: в 2p-онлайне хост клал в руки ID 1001+, гость применял snapshot → `cardsById.get(id)` возвращал `undefined` → после `.filter(Boolean)` рука становилась пустой. Отображалось: «у игрока 2 нет карт».

**Фикс:** [Web/game.js:80](Web/game.js:80) — выбираем колоду по `playerCount`: 2p → `create()` (53 карты, ID 1..53), 3p → `create3()` (54 карты, ID 1001+). Теперь ID совпадают с тем, что гость восстанавливает через `buildCardsById(playerCount)`.

Побочно пофиксилось: в hot-seat 2p отсутствовала карта 53 (УСИЛЕНИЕ ЯДРА из 3p-колоды) и слегка отличались паттерны ЗАМЫКАНИЯ / АСИНХРОННОСТИ / РЕЗЕРВА — теперь 2p играется по 2p-колоде, как и задумано.

---

## 2026-04-18 — UI-14 · Панель описания выделенной карты под рукой

Под рядом карт руки добавлена панель `#card-desc` с развёрнутым описанием выбранной карты. Текст берётся из `_fxLongText` (уже использовался в peek-окне) — полные человекочитаемые фразы: «Ты берёшь 1 карту из колоды в руку», «Противник сбрасывает ВСЮ свою руку».

**Логика:**
- Тап по карте в любой фазе → `_setDescCard(card)` раскрывает описание.
- Повторный тап по той же карте → toggle, панель скрывается.
- Смена игрока (в `_render` по изменению `_lastRenderCurrentPI`) → `_descCard` сбрасывается.
- В фазе «Ход» поведение тапа прежнее (выбор/отмена `pendingCard`), в других фазах — поворот паттерна + обновление описания.

**Стиль:** мелкий моно-шрифт 10px на фоне `--bg-1`, border `--line-dim`, clip-path со скошенными углами. Секции Розыгрыш/Утилизация/Синтез окрашены как и в компактной карточке (зелёный / оранжевый / фиолетовый).

**Код:** `ui.js` — новые `_setDescCard`, `_renderCardDesc`, хук в `_makeCardEl` click, вызов в конце `_render`; `index.html` — div `#card-desc` внутри `#hand-wrap`, CSS `.card-desc` рядом с `#hand-cards`.

---

## 2026-04-18 — UI-13 · Крупные карты с подписанными эффектами, удалён long-press popup

Итерация после UI-12: отказались от иконок и long-press popup в пользу крупных карт с читаемым текстом эффектов прямо на карте — в руке и в общей открытой зоне.

**Размеры:**
- Карта в руке: `80×116` → `108×152`
- Карта в рев-зоне: `50×54` → `92×132`

**Текстовые метки вместо иконок:** `взять N`, `раскоп N`, `поставь N`, `раскр N`, `сброс N`, `украсть N`, `запас ±N`, `запас=N`, `запас=опп`, `сброс стола`, `ВСЁ` для ∞. Действия на противника — красным цветом с суффиксом «опп» (добавляется через `::after`, не жрёт место в числе). Каждое действие на своей строке для максимальной читаемости при 3+ действиях (ИНТЕРФЕЙС, ПРОКСИ).

**Удалён long-press popup.** Раз всё видно — отдельное детальное окно стало избыточным. Убраны handlers `startPress/endPress/pressTimer`, метод `_showCardPopup`, CSS `#card-popup` / `.card-popup-name` / `.zone-hint`, хинт «зажать = детали» в заголовке руки. Клик на карту по-прежнему: в фазе «Ход» — выбор карты, иначе — поворот паттерна.

**Код:**
- `ui.js::_fxCompact` — текстовые метки вместо Unicode-иконок; направленность через `.fx-opp` + CSS `::after` добавляет «опп» визуально.
- `ui.js::_makeCardEl` — имя карты перемещено над блоком эффектов (чтобы эффекты не отрывались от низа карты).
- `ui.js::_effectBadges` — удалён (не нужен, в рев-зоне тоже полный текст).
- `index.html` — переписан `.card-fx-compact`: `flex-direction: column`, каждое `.fx-act` — отдельная строка; `.rev-lane .card` увеличена и показывает тот же текстовый блок что и рука, но мельче (7px).

Примеры итогового вида (в руке):
- **ПРОКСИ**: `▶ поставь 1 / раскр 1 / сброс 1 опп`
- **ИНТЕРФЕЙС**: `▶ раскр 2 / поставь 4 / сброс 1 опп`
- **РЕЗЕРВ**: `▶ сброс 1 опп` и `✦ сброс 2 / взять 2`
- **ЧЕРВЬ СЕТИ**: `▶ сброс ВСЁ опп` и `✦ сброс ВСЁ`

---

## 2026-04-18 — UI-12 · Видимые эффекты на картах в руке и рев-зоне

Карты в руке и в общей раскрытой зоне раньше показывали только паттерн и название — чтобы узнать эффекты надо было зажимать карту для попапа. Теперь эффекты видны сразу.

**Рука (80×116px):** под паттерном — компактная полоса иконок с цветовым кодированием типов (▶ зелёный Розыгрыш, ✦ оранжевый Утилизация, ⊕ фиолетовый Синтез). Действия на противника выделены красным (`#ff5577` + лёгкий glow) вместо прежнего суффикса `!`. Примеры: РЕЗЕРВ — `▶×1` + `✦×2 +2c`; ИНТЕРФЕЙС (4 действия) — `▶◉2 ●4 ×1` в одну строку.

**Рев-зона (50×54px):** текст не уместить, поэтому под паттерном — строка цветных бейджей `▶ ✦ ⊕`, которые показывают какие типы эффектов есть у карты. Детали по-прежнему через долгое нажатие.

**Иконки атомарных действий:** `●N` фишки, `+Nc` карты, `⛏N` раскопать, `◉N` раскрыть (было цветное эмодзи `👁` — заменено на моно-совместимое), `✕N` сбросить, `⇆N` украсть, `⚡±N`/`⚡=N` запас, `↻стол` сбросить стол, `∞` для «всей руки».

**Код:**
- `ui.js::_fxCompact` — возвращает HTML-спаны; направленность на противника → класс `.fx-opp` вместо текстового `!`.
- `ui.js::_describeEffectsCompact` — каждый тип эффекта в отдельной строке с префиксом ▶/✦/⊕.
- `ui.js::_effectBadges` — новая функция: 3 цветные точки-индикатора для компактных карт.
- `ui.js::_makeCardEl` — в шаблон карты добавлены `.card-fx-compact` и `.card-badges`.
- `index.html` — стили `.card-fx-compact` (моно 7.5px, 2 строки, border-top), `.card-badges` (по умолчанию `display:none`, включается на `.rev-lane`), уменьшен `.card-pattern-grid` до 58% чтобы освободить место.

Проверено в preview для карт: КЭШИРОВАНИЕ, ТУННЕЛИРОВАНИЕ, ЭНТРОПИЯ, ИНТЕРФЕЙС (4 действия в строке), РЕЗЕРВ (2 типа эффектов), ЧЕРВЬ СЕТИ (×∞), КЛЮЧ БЕЗОПАСНОСТИ (▶+⊕, cost −1), ПЕРЕХВАТ ПОТОКА в рев-зоне (бейджи ▶✦).

---

## 2026-04-18 — REF-04 · Раскопай N = N итераций «тяни 2 → оставь 1 → сбрось 1»

Проверка правил выявила расхождение: эффект `раскопай N` работал как «разом тянем N+2, выбираем N, остальные в сброс». Правильная механика настольной версии — **N независимых итераций**, на каждой тянется 2 карты, одна в руку, другая в сброс. Результат по числам для N≥2 тот же (+N в руку, +N в сброс), но для N=1 сброс на 1 карту меньше, и в любом случае каждый следующий выбор делается с учётом уже оставленных карт.

**Код:**
- `game.js::DigCardsEffect.execute` — переписан в виде рекурсивного `digOne(remaining)`. На каждом шаге `st.deck.draw(2)` → если 0 карт досрочный done, если 1 то сразу в руку, если 2 то `inp.chooseCards(ap, drawn, 1, ...)` — одна в руку, другая в `st.discard`. Добавлен `inp.digStep = { current, total }` для UI.
- `ui.js::_buildChoiceContext` (ветка `kind === 'dig'`) — текст модала переписан: «выбрать 1 из 2» + суффикс «· шаг X/N» если N>1.

**Влияние на карты:**
- «Раскопай 1» (БАЙТ ×2, ИНКАПСУЛЯЦИЯ, ФРАГМЕНТАЦИЯ) — раньше показывалось 3 карты, 2 в сброс. Теперь 2 карты, 1 в сброс.
- «Раскопай 2» (СОРТИРОВКА) — раньше 4 карты разом и выбор 2, теперь два шага по «выбрать 1 из 2».

Проверено в preview:
- БАЙТ (раскопай 1): 1 модал «1 из 2», deck −2, discard +1, hand +1.
- СОРТИРОВКА (раскопай 2): 2 модала «шаг 1/2» и «шаг 2/2», deck −4, discard +2, hand +2.

---

## 2026-04-18 — REF-03 · Steal с выбором источника (раскрытая или вслепую)

Эффект «украсть N» был слеп и однозначен: N случайных карт из руки следующего противника. Пользователь уточнил правило: каждая из N карт выбирается независимо, вор может взять либо конкретную карту из общей зоны раскрытых (включая свои — чтобы противник не мог её разыграть), либо вслепую из руки любого противника (в 3p выбирается цель).

**Правила:**
- Пул раскрытых = ВСЕ раскрытые карты (свои тоже, чтобы их можно было вернуть в руку).
- Вслепую можно красть из руки любого противника (не только `(ap+1)%n`).
- N шагов независимы: каждый шаг = отдельный выбор источника (mixed-pick разрешён).

**Код:**
- `game.js::StealCardsEffect.execute` — переписан в виде рекурсивного `stealOne(remaining)`. На каждом шаге собирается актуальный пул (`revealedPool` всех игроков + `opponents` с непустой рукой) и вызывается `inp.chooseStealSource(actorPI, ctx, sel)`. По выбору: `revealed` — карта вынимается из `player.revealed` конкретного владельца; `blind` — случайная из `player.hand` выбранного противника. Если оба источника пусты — досрочный done.
- `ui.js` — добавлен `input.chooseStealSource` (hot-seat показывает модал, online не-локальному actor: пока простая заглушка без сетевого запроса — TODO) + `_showStealPick(actorPI, ctx, done)` + `_finishStealPick(sel)`. Рефы `stealPickModal/Title/Revealed/Blind` в конструкторе.
- `index.html`:
  - `#steal-pick-modal` → `.modal-box` с title (`КРАЖА K/N · ВЫБЕРИ ИСТОЧНИК`) и двумя секциями: `#steal-pick-revealed` (карточки с паттерном/именем/владельцем) и `#steal-pick-blind` (кнопки «РУКА ИГРОКА X · 🎲 N карт»).
  - CSS `.sp-*` классов (hover выделяет цветом владельца p1/p2/p3).

Проверено в preview:
- Steal(1) через раскрытую (РЕФАКТОРИНГ P2): карта перенеслась в руку P1, `p2.revealed` уменьшился на 1.
- Steal(2) вслепую через 2 клика blind: каждый шаг рука P1 +1, P2 −1; после последнего модал закрылся, done вызван. Счётчик `N/M` в заголовке обновляется между шагами.
- Консоль чистая.

**Известные ограничения:**
- Сетевой режим для не-локального actor временно выбирает первый доступный источник автоматически (revealed[0], потом opponents[0]). Полноценный P2P `request('chooseStealSource', …)` — отдельной итерацией, когда сеть нужна по-настоящему.

---

## 2026-04-18 — REF-02 · общая зона раскрытых карт + утилизация только из руки

Раскрытые карты переведены из двух отдельных рядов (свои/чужие) в единую общую зону. Модель данных не менялась — `player.revealed[]` остаётся на каждом игроке, но UI показывает карты всех игроков одним рядом с разделением только по цвету бордера (cyan P1, orange P2, violet P3). Утилизировать теперь можно только карты из своей руки — раскрытые утилизации не подлежат.

**Правила:**
- Раскрытые — общий пул. Любой игрок в свой ход может разыграть любую раскрытую карту как свою (было уже; не менялось).
- Утилизировать — **только** из своей руки. Раньше можно было утилизировать и свою раскрытую — это была ошибка в CLAUDE.md/коде, корректное правило уточнено пользователем.

**Код:**
- `game.js::utilizeCard` — условие `!pl.hand.includes(card) && !pl.revealed.includes(card)` → `!pl.hand.includes(card)`. Карты из `revealed` больше не проходят проверку.
- `index.html` — `#opp-revealed-wrap` и `#own-revealed-wrap` объединены в один `#revealed-wrap` над доской. CSS-селекторы `#opp-revealed-wrap .rev-lane`, `#own-revealed-wrap .rev-lane`, `#opp-revealed-wrap .rev-lane .card.playable::after` заменены на общие `#revealed-wrap`. Индикатор `▶` теперь показывается на ЛЮБОЙ playable раскрытой карте (раньше — только у противников).
- `ui.js` — `this.ownRevealedWrap`/`this.oppRevealedWrap` → `this.revealedWrap`. `_renderRevealed` собирает `allRevealed = players.flatMap((p, i) => p.revealed.map(c => ({card, ownerPI: i})))` и рисует один `.rev-lane` через упрощённый `_makeRevealedLane(entries, playable)`. Лейбл ряда `РАСКРЫТО · ОБЩАЯ ЗОНА`, счётчик `N КАРТ(а/ы)`. `_syncFocusMode` обновлён: `focus-hidden` навешивается/снимается на единый `revealedWrap`.
- Подсказка `ЗАЖАТЬ · ✦ УТИЛ` на своей лейне удалена — утилизация раскрытых больше не поддерживается.

Проверено в preview: 2 раскрытых карты (P1 cyan + P2 orange) отрисованы в одном ряду `РАСКРЫТО · ОБЩАЯ ЗОНА · 2 КАРТЫ`, бордеры окрашены по владельцам. `utilizeCard(revealedCard)` возвращает `invalidAction`, `utilizeCard(handCard)` проходит. Консоль чистая.

---

## 2026-04-18 — REF-01 · объединение фаз Action+Task и переключатель Hard mode

Было жёсткое ограничение порядка: сначала поставь 2 фишки, затем разыгрывай карты. По правилам настолки действия должны идти в любом порядке. Заодно разделил игру на два режима сложности: обычный (без синтеза и альтернатив размещения) и Hard mode (включает механику синтеза; альтернативы «пропустить размещение ради +1 фишки» и «взять 3 карты вместо размещения» будут позже).

**Игровая механика:**
- Фазы `Action` и `Task` слиты в единую `Phase.Turn`. За один ход игрок может в любом порядке: поставить до 2 фишек (`chipsPlaced/chipsAllowed`), разыграть до 2 карт (`tasksThisTurn`), утилизировать до 2 карт (`utilizesThisTurn`). Счётчики независимы.
- `Phase.Action` и `Phase.Task` оставлены как алиасы на `Phase.Turn` для обратной совместимости snapshot/network-слоя.
- Синтез доступен только в Hard mode: `GameState.synthesis()` отбивает `invalidAction`, если `state.hardMode === false`.
- Карточный эффект `Place(N)` по-прежнему не тратит ручной лимит 2-х фишек (это отдельное действие игрока).
- `Reset()` очищает доску, но НЕ восстанавливает `chipsPlaced` — лимит размещения тратится безвозвратно в пределах хода.

**Удалено (dead code / ошибочная механика):**
- Правило «вернуть свою фишку как альтернатива постановке» (`returnPiece`) — это была моя выдумка при первой реализации, в настолке такого нет. Удалён `GameState.returnPiece()` и все вызовы в ui.js, сетевых хэндлерах, guest TM proxy.
- `GameState.endAction()` и кнопка `btn-end-action` — в новой модели фаза заканчивается только через `endTurn`.
- `_toAction()`, `_toTask()` заменены на единственный `_toTurn()` с полным сбросом счётчиков хода.

**UI:**
- Phase stepper сокращён с 4 до 3 ячеек: `01·ВОСПОЛН` → `02·ХОД` → `03·КОНЕЦ`.
- HUD показывает единую строку `● X/2 · ▶ Y/2 · ✦ Z/2` (размещения · розыгрыши · утилизации).
- Подсказка фазы переписана под 4 состояния: нет руки без возможности ставить, только размещения, размещения+розыгрыш, только розыгрыш.
- `_onNodeTap` переписан: если активна `pendingCard`/synth — тап идёт в паттерн; иначе — размещение фишки; своя фишка, поставленная в этом же ходе, снимается через `undoChip`.
- В меню добавлен переключатель `[ ] HARD MODE · СИНТЕЗ + АЛЬТЕРНАТИВЫ` (toggle `.active` + `[ ]`↔`[x]`). Применяется к обоим режимам 2p/3p, передаётся в `GameState` 4-м параметром.

**Код:**
- `game.js` — `Phase` с алиасами, `GameState(boardSize, winScore, playerCount, hardMode)`, `placedThisTurn = []`, все мутации проверяют `Phase.Turn`.
- `ui.js` — `_startGame(playerCount, netOpts, hardMode)`, `_menuHard`, все фазовые ветки сведены к `Phase.Turn`, `canSynth` гейтится `state.hardMode`.
- `index.html` — убрана кнопка `btn-end-action`, обновлён stepper, добавлен блок `.menu-hard` с CSS.

Проверено в preview: `phase: "Turn"`, `hardMode: true`, `chipsPlaced: 0/2 · tasks: 0/2 · utilizes: 0/2`, stepper `02·ХОД`, HUD `● 0/2 · ▶ 0/2 · ✦ 0/2`, `btn-end-action` отсутствует в DOM.

---

## 2026-04-18 — FIX-26 · V3 Focus-Card layout (доска всегда видна)

Во время выбора карты рука+раскрытые занимали ~45% экрана и перекрывали доску — игрок не мог одновременно видеть паттерн и искать его на поле. Переход на V3-дизайн: выбор карты активирует focus-mode, в котором видна только эта карта + info-блок с эффектом и счётчиком тапов, а ряды раскрытых и лейбл руки коллапсируются.

**UI/UX:**
- Выбрал карту → остальные карты в руке и оба ряда раскрытых плавно исчезают; рядом с выбранной карточкой появляется `.focus-info` (имя orange/Orbitron, текст эффекта моно, счётчик `N/M`, кнопки `⊕ СИНТ` и `✕`).
- Счётчик `N/M` синхронно обновляется при каждом тапе по фишке; когда становится полным — скачок scale + цвет accent.
- На тапнутых фишках паттерна — крест accent-цвета (`.node.tapped::after` с двойным linear-gradient + outline + мягкий drop-shadow) вместо старой dashed-рамки `.highlighted`. Хорошо виден поверх ярких голубых фишек.
- `#placement-panel` больше не показывается в новом flow — он оставлен в DOM скрытым для минимального diff, будет удалён в следующем коммите.
- Хинт фазы переписан: вместо `Нажми на все фишки паттерна · или ✦ Утилизировать` → `Найди паттерн на поле · тапай фишки` (имя карты и счётчик теперь в focus-info, не дублируются).

**Код:**
- `index.html` — блоки CSS для `.node.tapped`, `#hand-cards.focus-mode`, `.card.hiding`, `.focus-info`/`.fi-name`/`.fi-eff`/`.fi-bottom`/`.fi-cnt`/`.fi-actions`/`.fi-btn`/`.fi-cancel`, `.focus-hidden` (для `#hand-label` и `#opp-revealed-wrap`/`#own-revealed-wrap`).
- `ui.js::_renderBoard` — теперь сохраняет `.tapped` из `pendingNodes` при перерисовке доски.
- `ui.js::_syncFocusMode`, `_fillFocusInfo`, `_cancelPendingCard`, `_applyTapped`, `_clearTapped`, `_updateFocusCount` — новые методы, `_renderHand` вызывает `_syncFocusMode` в конце. Focus-mode активен только если у карты есть valid placements (или synth placeB) и фаза Task.
- `ui.js::_onPatternNodeTap` — `_highlightNodes` заменён на `_applyTapped`, счётчик обновляется через `_updateFocusCount`. Перед `tm.playCard`/`_showSynthOrderPanel` вызывается `_syncFocusMode`, чтобы focus-info не оставался при модальных эффектах (например, `раскопать`).
- `ui.js::_onCardTap` — при смене/деселекте карты добавлен `_clearTapped`.
- `ui.js::_showCardSelectedPanel` — сведён до вызова `_render()` (ставит `.hidden` на placement-panel, остальное рендерится через focus-mode).

Всё работает в обоих режимах 2p/3p. Проверено в preview: выбор → focus-mode + скрытие остальных + focus-info; тап → крест-accent на узле + счётчик 1/N; auto-play → focus-mode закрывается; `✕` отменяет выбор и очищает состояние. Консоль чистая.

---

## 2026-04-18 — FIX-25 · попап карты и подсказка зажатия в киберстиле

Косметика: попап долгого нажатия больше не торчит жёлтым на фоне cyan-HUD, и добавлен стиль для уже существующей подсказки «зажать = детали».

- `index.html::#card-popup` — `background: linear-gradient(155deg,#1a2650,#0d1432)` + жёлтый border/свечение заменены на `var(--bg-1)` + `var(--line)` + скошенный `clip-path` + cyan box-shadow. Теперь в одном стиле с `.card` и `.hud-frame`.
- `index.html::.card-popup-name` — переведён на `var(--display)` / `var(--text)` с uppercase и разделителем снизу, вместо сиреневого `#ccd8ff`.
- `index.html::.zone-hint` — добавлен CSS-класс (моно, `var(--line)`, 9px). Подсказка «зажать = детали» в метке руки теперь видна в cyan-акценте вместо дефолтного цвета текста.

---

## 2026-04-18 — FIX-24 · убраны подсказки размещения

Игровой дизайн: при выборе карты доска больше не подсвечивает валидные позиции, панель не показывает счётчик вариантов и не имеет стрелок для перелистывания. Игрок сам ищет паттерн на поле.

- `ui.js::_onCardTap` — убран вызов `_highlightNodes` объединением `chipPositions` всех валидных размещений.
- `ui.js::_showCardSelectedPanel` — `pp-count-header` пустой, `pp-rotnav` всегда скрыт, `btn-confirm` (`▶ РАЗЫГРАТЬ`) скрыт. Панель теперь показывает только превью карты, хинт эффекта и кнопки «⊕ СИНТ» / «× ОТМЕНА».
- `index.html` — в `.pp-lbl` убран разделитель «· N/N», `#pp-count-header` получил `display:none` на случай забытого апдейта.
- Механика размещения не изменилась: `_onNodeTap` по-прежнему накапливает `pendingNodes`, и при совпадении с любым валидным `chipPositions` карта автоматически разыгрывается.

Методы `_prevPlacement` / `_nextPlacement` / `_updatePlacementHighlight` оставлены в коде, но кнопок-триггеров больше нет.

---

## 2026-04-18 — FIX-23 · отложенные выборы противника («долги»)

Критический bug-fix + изменение game-flow. **Статус: ЭКСПЕРИМЕНТАЛЬНО, требует игровых тестов на баланс** (отметка `EXPERIMENTAL` в коде).

### Bug: бесконечный розыгрыш КЭШИРОВАНИЕ
- **Причина:** `#handoff-summary` отсутствовал в DOM → `_showHandoffForChoice` выбрасывал TypeError на `summaryEl.dataset.player` → колбэк-чейн эффектов обрывался между `Draw(3)` и `Discard(1,Opp)` → `_removeCardFromOwner` и `tasksThisTurn++` никогда не выполнялись → карта оставалась в руке, розыгрыш можно было повторять.
- **Fix немедленный:** добавлен `#handoff-summary` в `index.html`, CSS-правила `.hidden` на `#handoff-*-panel/stats/summary`, взаимное скрытие двух режимов handoff в `_showHandoff` (end-turn) и `_showHandoffForChoice` (choice).

### Game-flow change: отложенные выборы противника (вместо handoff туда-сюда)
- Было: когда актёр играет карту с эффектом `Discard(Opp)`/`Reveal(Opp)` и у противника есть выбор — устройство передаётся противнику, он выбирает, передаётся обратно.
- Стало: эффекты откладываются в `PlayerState.pendingActions = []` противника и разрешаются **в начале его хода до Восполнения**. Устройство не мигрирует во время хода актёра.
- `game.js::DiscardCardsEffect` и `RevealCardsEffect` при `target===Opp` и `toDo < all.length` пушат `{kind, count, sourceCardName, actorPI}` в `pendingActions` и сразу завершают callback. Если выбора нет (всё сбрасывается/раскрывается) — работает синхронно как раньше.
- `ui.js::_resolvePendingActions()` — последовательно разрешает все pending-действия текущего игрока через обычный `_showCardPick` (без handoff, он уже на своём устройстве). Вызывается из `_onHandoffOk` до `tm.replenish()`.
- HUD: у противника в `#opp-scores` появляется бейдж `✕N` (где N — суммарный долг карт), tooltip «Долг: решить в свой ход».

### Затронутые файлы
- `game.js` — `PlayerState.pendingActions`, изменены `DiscardCardsEffect`/`RevealCardsEffect`
- `ui.js` — `_resolvePendingActions`, `_applyPendingChoice`, интеграция в `_onHandoffOk`, бейдж в `_render`
- `index.html` — `#handoff-summary` + CSS, `.opp-debt` стиль

### Что может сломаться (требует тестов)
- Синтез с opp-эффектами — несколько долгов накапливаются, порядок резолва может влиять на баланс
- Раскрытие (`Reveal(Opp)`) во время своего хода — раньше было «сразу видно, можно играть»; теперь актёр не видит до следующего хода противника. Меняет стратегию.
- Утилизации / onliner с opp-эффектом — логика та же, но флоу изменился
- Онлайн-режим (host/guest) не проверялся — pending-поле сериализуется в state, но резолвер завязан на UI

---

## 2026-04-18 — FIX-PACK v1 · доп. 20/21 (финал)

Закрыты последние два стилевых фикса из v1-пакета (placement-panel + revealed zones). Механика не меняется.

- **FIX-20** `style(placement-panel)`: плашка выбора позиции перевёрстана в HUD-язык
  - Клип-корнеры (10px), 1px cyan line-border, оранжевый accent-tick (40×1px) сверху-слева
  - Заголовок `ВЫБРАТЬ ПОЗИЦИЮ · N/M` + inline-кнопка `✕ ОТМЕНА`
  - Card preview (72px): cost-chip, 0°-метка, 3×3 паттерн в цвете владельца
  - Rotnav `‹ ВАРИАНТ N / M ›` со стрелками, скрыт когда M ≤ 1
  - Кнопки: `▶ РАЗЫГРАТЬ` (accent hot) + `⊕ СИНТ` (ghost); cancel-текст меняется при синтезе
  - Плотный layout при height≤700px: скрыты header/rotnav, карта 56px
  - Добавлен отсутствующий `_updatePlacementHighlight()` (silent-bug: был вызываем `_prev/_nextPlacement`, но не определён)

- **FIX-21** `feat(revealed-zones)`: раскрытые карты — постоянные полосы над/под доской
  - Одна `.rev-lane` на владельца с revealed>0 (скрыта если пусто, без пустой полоски)
  - В 3p: сверху две полосы (P2 + P3), каждая в своём цвете
  - Фон — tint-градиент 6% в цвет владельца + `--bg-1`; разделитель dashed
  - Лейбл `ИГРОК N · РАСКРЫТО` mono 9px в цвете игрока
  - Счётчик карт с правильной плюрализацией (`1 КАРТА` / `2 КАРТЫ` / `5 КАРТ`)
  - На своей полосе — подсказка `ЗАЖАТЬ · ✦ УТИЛ`
  - Компактная карта 50×54px с SVG-паттерном 36px, без corner-метки поворота
  - `▶` индикатор на чужой карте, играбельной в мою TASK-фазу
  - Тап по чужой в TASK → `pendingCard` + placement-panel (через существующий flow)
  - Удалены мёртвые CSS/JS для фикс. `#own/opp-revealed-label/-zone` (labels/zones теперь динамика)

---

## 2026-04-18 — FIX-PACK v1: 18 из 19 фиксов UX/UI

Трогается только визуал и информационная архитектура, механика не меняется. TaskMode-селектор (FIX-20) не вводится — ломает flow «тап карту → кнопка разыграть». FIX-13 пропущен (W/G — обучающая метка). Все токены цветов игроков через CSS-переменные `--p1/p2/p3/--enemy-neutral`.

- **FIX-01** токены игроков `--p1/p2/p3`, `--enemy-neutral`
- **FIX-02** индикатор активного игрока через `data-player` на HUD
- **FIX-03** z-index токены `--z-overlay/rules/pause/card-pick/card-detail/net/toast`
- **FIX-04** tier-2 HUD: `ИГРОК N` / `T01 · ФАЗА ДЕЙСТВ N/2` / `КОЛОДА / СБРОС` — плотная строка без перекрытий
- **FIX-05** обновление счётчика колоды/сброса на каждом `_render`
- **FIX-06** highlight всех узлов паттерна при клике по карте (union позиций чипов), не только последних
- **FIX-07** при неудачном тапе в pattern-mode: rollback одного узла + красный flash + shake + error-toast (вместо полного reset)
- **FIX-08** card-pick и card-detail модалки — portal to body, в layer z-card-pick/z-card-detail
- **FIX-09** заголовки и счёт подсвечиваются цветом активного игрока через cascading `data-player` на всех оверлеях
- **FIX-10** pause-snapshot: PHASE · TURN · ACTIVE · ELAPSED · DECK · HAND
- **FIX-11** handoff-stats: расширены до chips, hand (+delta), supply (+delta), deck/discard — полный отчёт по предыдущему ходу
- **FIX-12** активный режим меню: gradient tint + 4px светящаяся левая полоса акцента
- **FIX-14** ellipsis на длинные имена карт в `.revealed-zone` (в руке уже было)
- **FIX-15** task-panel счётчики разделены: `▶ N/2 · ✦ N/2` (розыгрыш + утил отдельно)
- **FIX-16** handoff-glitch 0.65s → 0.4s + тап по экрану пропускает анимацию
- **FIX-17** унификация символа утилизации: везде `✦` (кнопка, подсказки, иконки карт)
- **FIX-18** колода/сброс живут в HUD tier-2 (сделано в FIX-04)
- **FIX-19** T01 turn-number de-emphasize (text-dim, weight 500) — фаза читается как главная

FIX-13 пропущен по решению пользователя: буквы `W/G` в паттерне карты — обучающий элемент.

---

## 2026-04-18 — HUD Kit: меню пересобрано под канон MenuV2Hi

- **`HEAD`** Fix: по `SOURCES.md` канон меню — `MenuV2Hi` из `screens-v2.jsx`. Предыдущая версия была скопирована из `MainMenuV1` (IGNORE-список). Переделано целиком:
  - Header-strip: `SECT 001 / ◆ ◆ ◆ / MEM 72%` (mono 8px text-ghost, letter-spacing 0.2em)
  - Радар SVG 280×280 (3 концентрических круга: r=130 solid, r=100 dashed, r=70 accent) + 24 tick-mark, каждый 6-й толстый
  - Hero: `◦ BOOT.COMPLETE ◦` accent mono → `КИБЕР` 72px Orbitron (textShadow 30px cyan glow) → `DIGITAL ◆ CARD ◆ GAME` mono-dim с line-ромбиками
  - Режимы — toggle 2×1 (`2 ИГРОКА · 4×4` / `3 ИГРОКА · 5×5`), активный: `bg-3` + accent border + accent text, с настоящими chip-ромбиками (p1 orange, p2 cyan, p3 purple)
  - Большая кнопка `▶ INITIATE` (hot full, accent background, cyan glow 24px)
  - Онлайн → небольшая ghost-ссылка `◉ ОНЛАЙН · ДУЭЛЬ · P2P` (dashed border, не ломает иерархию канона)
  - Footer: `▤ RULES` / `⚙ CFG` (ghost sm, space-between)
  - Удалены `.menu-signal`, `.menu-sys-tag`, `.menu-segbar`, `.menu-select-tag` и стили карточных `.btn-mode-2p/3p/online` (не из канона)
  - Новая логика: toggle только выбирает режим, старт игры → по кнопке INITIATE (был instant-start с `.btn-mode`)

---

## 2026-04-18 — HUD Kit: меню в стиле MainMenuV1 (удалено)

- ~~Главное меню переведено на HUD Kit (`screens-menu.jsx` V1)~~ — **откачено**: `MainMenuV1` в IGNORE-списке по `SOURCES.md`, замещено каноном `MenuV2Hi`.

---

## 2026-04-18 — HUD Kit: аудит + CardPick title fix

- **`HEAD`** Fix: заголовок `#card-pick-title` переведён в HUD Kit палитру
  - Источник действия: `ИГРОК N` accent цветом, mode `var(--text-dim)`, имя карты Orbitron display
  - Instruction: `var(--display)` 15px с цветом target игрока
  - Consequence: mono 9px `var(--text-dim)` uppercase (вместо зелёного/оранжевого)
  - Fallback (ctx=null): `&gt; ВЫБОР КАРТ` mono accent + display title `ИГРОК N · ВЫБЕРИ К`
- Визуальный аудит: Menu / Game / Handoff / Rules (4 таба) / Pause / Victory / CardPick / Synth / Revealed — все экраны в kit палитре

---

## 2026-04-17 — HUD Kit: этап 5 — synth-order + revealed zones

- **`HEAD`** Feat: завершающий рестайл оставшихся UI-поверхностей под HUD Kit
  - **Synth-order panel** (`#synth-order-panel`) — удалён фиолетовый legacy-стиль
    - Фон `var(--bg-1)`, border `accent`, clip-path polygon beveled углы
    - Заголовок `> SYNTHESIS.ORDER` — mono 9px accent uppercase
    - Кнопки на `bg-2` с HUD clip-path, hover → accent tint + outline
    - Имена карт — Orbitron display, стрелка `→` accent
  - **Tone-synth** (`#phase-hint.tone-synth`) — фиолет `#cc99ff` → `var(--accent)`
  - **Revealed zones** (`.revealed-zone`) — HUD Kit
    - Оппонент: dashed `var(--line-dim)` border, background `bg-1`
    - Свои: solid `var(--accent)` border + `inset 0 0 10px rgba(255,106,43,0.06)` glow
    - Label `◦ РАСКРЫТО · P-02` (dim) / `◦ РАСКРЫТО · P-01 (ВЫ)` (accent)
  - Больше нигде в main-gameplay нет не-kit палитры

---

## 2026-04-17 — HUD Kit: этап 4 — модалы (Rules / Pause / Victory / CardPick)

- **`HEAD`** Feat: все in-game модалы переведены на стиль `Дизайн/_/modals-v2.jsx`
  - **Rules** (`#rules-screen`) — 4 таба `ЦЕЛЬ / ХОД / КАРТЫ / СИНТЕЗ`
    - Табы с `.rules-tab.active` (accent fill), clip-path polygon
    - `.rules-frame.bracket` с угловыми скобками accent · `.rules-frame-label` mono
    - Pane ХОД — 4 step-row (`01–04`) с Orbitron номером и display/mono текстом
    - Pane КАРТЫ — легенда W/G тегами, tag-play/tag-util для эффектов, tag-synth ⊕
    - Pane СИНТЕЗ — placeholder-карточки `LOOP + SYNC`
  - **Pause** (`#ingame-menu`) — HUD Kit `PauseModalV2`
    - `SYS.HALT` + `T{NN}` теги сверху · Orbitron 40px `ПАУЗА` + `◦ GAME.SUSPENDED ◦`
    - `STATE`-панель с HudRing (SVG) для каждого игрока, активный accent
    - 3 кнопки: `▶ ПРОДОЛЖИТЬ` (accent fill), `↺ ЗАНОВО`, `↩ В МЕНЮ` (ghost)
  - **Victory** (`#gameover-screen`) — HUD Kit `VictoryModalV2`
    - `◦ MATCH.COMPLETE ◦` лейбл, большой SVG-круг с 36 тиками (accent)
    - Orbitron 40px `ПОБЕДА` цветом победителя + sub `P-0N · score/win PTS`
    - `MATCH.LOG` панель с dotted rows (TURNS, SCORE, per-player scores)
    - Accent-filled `↺ ИГРАТЬ СНОВА` + ghost `↩ В МЕНЮ`
  - **CardPick** (`#card-pick-modal`) — HUD Kit
    - `.modal-box` с clip-path polygon, accent `> ВЫБОР КАРТ` заголовок
    - `.pick-item` на `bg-2` с `.selected` → accent border + orange tint
    - Cost tag в accent обводке `[N]`
    - Accent-filled `ПОДТВЕРДИТЬ →` кнопка, счётчик `N / M` mono
- **Изменено:** `Web/index.html` (CSS и HTML для rules/pause/gameover/card-pick), `Web/ui.js` (`_onGameOver` с ring ticks + MATCH.LOG rows, `_showIngameMenu` с HudRings, обработчик rules-табов, текст CardPick-счётчика)

## 2026-04-17 — HUD Kit: этап 3.2a — END summary на handoff экране

- **`HEAD`** Feat: переработан экран передачи устройства под стиль HUD Kit `proto.jsx` §END
  - `#handoff-player` — mono-лейбл `ИГРОК N · ХОД ЗАВЕРШЁН` с цветом игрока
  - `#handoff-end-panel` — панель `bg-1` с accent бордером и свечением `0 0 12px rgba(255,106,43,0.2)`:
    - `.end-gain` — Orbitron 26px orange `+{gain}` с text-shadow; при нулевом приросте `—` приглушённым цветом
    - `.end-delta` — mono `{prev} → {score} / {winScore}`
  - `#handoff-stats` — блок со строками `РАЗЫГРАНО` и `УТИЛИЗИРОВАНО` (mono 9px, dotted row через `.hsr-sep`)
    - класс `.zero` приглушает строки без активности
  - `#handoff-next` — dashed border-блок с `> ПЕРЕДАТЬ УСТРОЙСТВО` + `ИГРОК N` (Orbitron 18px цветом следующего игрока)
    - glitch-анимация переноса на заголовок `.hn-player`
  - `#btn-handoff-ok` — accent-filled HUD кнопка `ПЕРЕДАТЬ →` (mono, beveled clip-path)
- **Данные:** `_showHandoff` читает `s.prevScore` (снимок очков на старте хода в `_render` через `_turnStartScores`), считает gain = `max(0, score - prevScore)`
- **Изменено:** `Web/index.html` (CSS `#handoff-*`, HTML `#handoff-screen`), `Web/ui.js` (`_showHandoff` полностью переписан, сохранение `_turnStartScores` при смене `currentPI`)

## 2026-04-17 — HUD Kit: этап 3.1 — compact header + phase stepper + hint-bar

- **`HEAD`** Feat: замена верхнего HUD на компактную шапку из `Дизайн/_/proto.jsx`
  - **Compact header** (`.hud-compact`): `[T{NN}] [P-0N] [P2:X P3:Y] ──── [score]/max [≡]`
    - `.hud-turn-tag` — orange filled box с номером хода `T01` (Orbitron mono, letter-spacing 0.2em)
    - `.hud-player-tag` — mono accent-tag активного игрока, цвет по игроку (p1 синий, p2 красный, p3 зелёный)
    - `.hud-opp-scores` — компактные чипы соперников `P2:X` цветом игрока (адаптация для 2p/3p hot-seat)
    - `.hud-score` — Orbitron 16px orange, `/max` справа приглушённым моно
    - `.hud-menu-btn` — HUD-кнопка `≡` с beveled clip-path
  - **Phase stepper** (`.phase-stepper`): 4 ячейки `01·ВОСПОЛН / 02·ДЕЙСТВ / 03·ЗАДАЧА / 04·КОНЕЦ`
    - `.current` — orange fill (`var(--accent)`) с тёмным текстом
    - `.past` — приглушённый orange `rgba(255,106,43,0.15)` с accent текстом
    - Future — transparent с `var(--line-dim)` рамкой
    - Фаза `End` резервирована для этапа 3.2 (END summary panel)
  - **Hint bar** (`#phase-hint`) — полная замена SVG-прогресс-бара на dashed accent border:
    - `> {text}` mono 10px · опционально счётчик `N/M` в рамке справа
    - Тонирование через CSS-классы: `.tone-replenish/action/task/synth/ok` (вместо hue-rotate)
  - **Meta row** (`.hud-meta`): `КОЛОДА N  СБРОС M` моноширинно снизу HUD
  - **Удалено**: `.player-panel` с бордюрами/glow/score-bar, `.hud-top`, `.hud-center`, `#hud-info-3p`, `.info-phase/info-turn`, `#app.mode-3p` панели — старый 3-panel layout заменён единым header'ом
  - **`ui.js`**: обновлены `_bindElements` (новые ID `turn-tag/player-tag/opp-scores/cur-score/phase-stepper`), `_render` (populate compact header + stepper), `_updatePhaseHint` (новая разметка + tone-классы), `_animateCounter` получил флаг `noSuffix`; добавлен `this._turnNumber` + автоинкремент при смене `currentPI`
  - Баланс/механика/фазы — нетронуты

---

## 2026-04-17 — HUD Kit: этап 2 — карты, доска, рука + «1 клик = поворот»

- **`HEAD`** Feat: визуальная интеграция HUD Kit (строго по `Дизайн/_/chips-cards.jsx`) + фикс взаимодействия по UX_SPEC §2.7
  - **Карта** (`.card`) — точная копия компоновки из кита `GameCard`:
    - Размер 80×116 (w × w*1.45), flex-column, beveled clip-path
    - Header-row: `.card-cost` (квадрат с clip-path, Orbitron) + `.card-corner` (`◇◇◇` мелким моно, или `↻N°` при повороте)
    - `.card-pattern` — inline 3×3 CSS-grid 80% ширины, gap 1px; без SVG
      - `.w` = `var(--accent)` (оранжевая), `.g` = `var(--line)` (cyan), `.empty` = прозрачная с dashed `--line-ghost`
    - `.card-name` — внизу, Orbitron uppercase 9px, `border-top: 1px solid var(--line-ghost)` как разделитель
    - `.card.selected`: `var(--accent)` рамка + orange glow + подъём -8px, cost инвертируется в оранжевый с тёмным текстом
    - **Без fx-текста** — эффекты теперь только в поп-апе по long-press (кит компактную карту оставляет чистой)
  - **Доска** (`#board`): чистый `var(--bg-1)` фон, HUD-beveled рамка `var(--line-dim)` без скруглений
    - Вместо scan-grid теперь SVG-оверлей `#board-lines` с **dashed соединительными линиями** между центрами узлов (`stroke-dasharray="2 3"`, `vector-effect="non-scaling-stroke"`) — «схема платы» как в ките `ChipBoard`
  - **Узлы** (`.node`): ромбы через `::before` + `clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%)`
    - Пустой: 20% контурный ромб dashed `var(--line-ghost)`
    - p1/p2/p3: цветной ромб 60% с glow + пульс
    - Highlighted: dashed outline `var(--accent)` + оранжевая заливка
  - **Метка руки**: `◦ РУКА · Игрок N ··· n/5  зажать = детали` моноширинно
  - **Взаимодействие с картой** (UX_SPEC §2.7, было double-tap=поворот):
    - 1 клик = поворот паттерна на 90° CW (ACTIONS и др. фазы)
    - В фазе TASK клик = выбор карты (для розыгрыша/синтеза/утилизации)
    - REFILL/END — клик игнорируется
    - Long-press 350ms (было 400ms) → поп-ап; работает для мыши и тача
    - Угловой индикатор `↻90°/180°/270°` сменяет декоративное `◇◇◇` при повороте
  - Новая функция `_patternGridHTML(pattern)` в ui.js — рендер 3×3 grid HTML вместо SVG
  - Баланс/механика/фазы — нетронуты, только CSS, разметка карты и обработчики кликов

---

## 2026-04-17 — HUD Kit: этап 1 — токены + шрифты + кнопки

- **`HEAD`** Feat: интеграция дизайн-системы «HUD Kit» (из `Дизайн/_/hud.css`) — этап 1 из 4
  - Добавлены дизайн-токены в `:root` (палитра `--bg-0..3`, `--line*`, `--accent`, `--text*`, `--danger`, `--ok`; шрифты `--mono/sans/display`)
  - Подключены Google Fonts: Orbitron, Rajdhani, JetBrains Mono, Share Tech Mono
  - Утилитарные классы: `.hud-btn`, `.hud-frame`, `.seg-bar`, `.corner-brackets`, `.chip-tag`, `.mono`, `.display`, `.label`, `.scan-grid` (задел для этапов 2–4)
  - Переопределены все кнопки под HUD-стиль: beveled `clip-path` углы, monospace uppercase текст, cyan/orange палитра
    - `.btn` / `.btn-action/utilize/skip/primary/ghost` — экшн-бар во время хода
    - `.btn-nav`, `#btn-confirm`, `#btn-synth`, `#btn-synth-cancel` — placement/synth панели
    - `.btn-rotate`, `#card-detail-close` — detail-оверлей
    - `.btn-mode` (2p/3p/online), `.online-back`, `.online-primary`, `.btn-rules-link` — меню и онлайн-экраны
  - Body: новый фон с cyan/orange радиальными градиентами + Rajdhani по умолчанию
  - Механика/баланс/логика — нетронуто, изменения только в CSS `index.html`
  - Следующие этапы: карты и доска (этап 2), модалки (этап 3), экраны синтеза/утилизации (этап 4)

---

## 2026-04-17 — Онлайн 2p через WebRTC (PeerJS)

- **`HEAD`** Feat: онлайн-режим 2 игроков с двух устройств через P2P-соединение
  - Новая кнопка «📡 Онлайн 2 игрока» в стартовом меню
  - Host создаёт игру → получает 4-символьный код (буквы/цифры без I/O/0/1)
  - Guest вводит код → подключение через сигнальный сервер PeerJS
  - Архитектура: host авторитативен (держит GameState + TurnManager), guest — тонкий клиент (shadow state + рендер)
  - Протокол сообщений: `state` (snapshot), `action` (guest → host), `input-req/input-res` (RPC для раскрытий/сбросов/раскопок), `game-over`, `ping/pong` (keepalive)
  - Рука хоста маскируется (`id: -1`) в снапшоте, отправляемом гостю
  - Handoff-экран отключён в онлайне; вместо него — индикатор «⏳ Ход соперника · фаза» внизу
  - Авто-восполнение после endTurn — без ручного перехода
  - Блокировка действий (тапы по доске/картам/кнопкам) когда ход соперника
  - Reconnect-оверлей при обрыве связи + exit в главное меню
  - Метка руки в онлайне всегда «Моя рука (Игрок N)» из локальной перспективы
  - Новые файлы: [Web/net.js](Web/net.js) (сетевой слой + сериализация снапшотов и матчей)
  - Ограничение: только 2 игрока; 3p остаётся hot-seat-ом

---

## 2026-04-17 — UX-полировка и компактные карты

- **`HEAD`** UX: защита от случайного клика «Конец действий» с непоставленными фишками
  - Первый тап показывает оранжевое предупреждение «⚠ Не поставил N фишек · тапни ещё раз» + хаптика
  - Второй тап в течение 3 сек подтверждает и переходит в фазу «Задача»
  - Через 3 сек таймер сбрасывает предупреждение

- **`6021443`** UX: модал выбора карт показывает последствие выбора
  - Для `reveal`: «⚠ Эта карта будет видна противнику · любой игрок сможет её разыграть в свой ход» (оранжевым)
  - Для `discard`: «⚠ Эта карта уйдёт в сброс и пропадёт из твоей руки» (оранжевым)
  - Для `dig`: «✓ Выбранные карты попадут в руку · остальные уйдут в сброс» (зелёным)
  - Грамматика подстраивается под единственное/множественное число

- **`c53cca7`** UX: контекст для модала выбора карт — игрок понимает что и почему происходит
  - Handoff-экран при передаче противнику теперь показывает: «Игрок 1 разыграл «КЛЮЧ БЕЗОПАСНОСТИ» / Игроку 2 нужно раскрыть 1 карту»
  - Модал выбора карт показывает источник (кто, какая карта) и понятную инструкцию вместо «Игрок 2: выберите 1 карту»
  - Возвратный handoff после выбора противника: «Выбор сделан / Передайте устройство обратно»
  - Работает для всех трёх случаев: `RevealCards` (раскрыть), `DiscardCards` (сбросить), `DigCards` (раскопать)
  - Источник пробрасывается через `input.sourceCard / sourceMode` (play / utilize / synth) и `input.actionKind`

- **`ad5ba12`** UX: раскрытые карты — компактные миниатюры, доска больше не заслоняется
  - `.revealed-zone .card` теперь 62px шириной, без текста эффектов (паттерн + название + стоимость)
  - Лейблы зон стали читаемыми (color #5c7099 вместо тёмно-синего #2e3a4e)
  - Подсветка пустых узлов в Action-фазе стала тоньше (inset shadow без scale 1.1) и **автоматически пропадает** когда все фишки расставлены
  - Кнопка `⊕ Синтез` скрыта, если в руке/раскрытых нет подходящей карты-партнёра
  - Кнопка отмены выбора карты теперь подписана «✕ Отменить выбор» (было просто «✕»)

- **`443f91f`** UX: динамические подсказки фазы Задач, primary/ghost стили кнопок, акцент активного игрока
  - Подсказка в фазе Задач теперь контекстная: «нет карт», «нет розыгрышей», «выбери карту»
  - `⏭ Завершить ход` меняет текст и зелёный/ghost стиль в зависимости от наличия розыгрышей
  - `▶ Закончить действия` становится primary-зелёной когда все фишки расставлены
  - Неактивный игрок приглушён (opacity 0.62 + saturate 0.6), активный с glow
  - Стоимость 0 тёмнее для контраста со стоимостью 1-2, бейдж 17×17 (было 20×20)
  - Эффекты карт 9.5px + min-height для выравнивания
  - «В главное меню» на экране победы — transparent outline вместо фиолетовой заливки

- **`e14268d`** Fix: предотвращён выбор текста при long-press на карту (мобильные)
- **`ad81ace`** UX: компактные карты с long-press попапом, показывающим полные эффекты
- **`837605d`** Fixes: компактные карты, PlaceChips больше не блокирует завершение хода, корректный handoff для Reveal/Discard у оппонента

---

## 2026-04-16 — Интерактивность руки и tap-to-play

- **`7070aa2`** Feat: двойной тап по карте в руке вращает паттерн (без оверлея)
- **`8132f10`** Feat: единая колода из 54 карт для обоих режимов (2p и 3p)
- **`9bd6622`** Refactor: тап по своей фишке отменяет установку, кнопка «Undo» убрана
- **`497067a`** Feat: прокрутка руки, undo фишки, игровое меню, экран правил
- **`2700f49`** Refactor: по очереди тапаем все фишки паттерна для розыгрыша карты
- **`ca8b276`** Refactor: сначала выбираем карту, потом тапаем узел на доске
- **`d755952`** Remove: убрана подсветка playable/unplayable карт (слишком шумно)
- **`16c12b9`** Feat: вращение паттерна в детальном просмотре карты (↺ ↻)

---

## 2026-04-15 — Старт-меню и режим на 3 игрока

- **`ad67302`** Fix: выравнивание текста во всех 3 панелях игроков в режиме 3p
- **`02927ce`** Refactor: HUD для 3p — три панели в одну строку, дизайн как у 2p
- **`48ea90f`** Feat: стартовое меню + режим на 3 игроков (поле 5×5, та же колода 54)
- **`b3f30e3`** Feat: фазовый хинт заменён на SVG-дизайн в киберпанк-стиле

---

## 2026-04-14 — Базовый прототип и визуал

**Визуальный редизайн:**
- **`fc13ad9`** Visual overhaul: глассморфизм, градиентный фон, mono-шрифт, глубина карт, градиентные кнопки, цветные тинты фаз, SVG-паттерны
- **`7dcfdd2`** Design polish: неоновые glow, pulse фишек, float карт, spring-анимации панелей, хаптика, Web Audio, счётчик очков

**Мелкие фиксы карт и оверлеев:**
- **`5078a12`** Fix: фон оверлея #000, card-name 11px, удалено `window._dbg`
- **`4279cca`** Fix: opacity 0.97 на handoff/gameover — скрывает просвечивающий glow фишек
- **`4fe184e`** Fix: ширина карты 120px + overflow-wrap для длинных названий
- **`c5d5b09`** Fix: overflow-wrap для длинных русских слов в названии
- **`c61fb45` / `feb143a` / `6c387d0`** UX improvements: шрифты, фазовый хинт, полоски очков, сворачиваемые зоны, итог хода

**Ядро правил:**
- **`08134fa`** Fix playCard order: сначала очки+эффект, потом убираем фишки (по правилам)
- **`dfccf05`** Add: UI Синтеза — карта A → ⊕ Синтез → карта B → выбор порядка → исполнение
- **`eae07f6`** Fix rules: W = своя фишка, 4 вращения, supply=3, chips=8, бюджет 2+2, returnPiece, механика Синтеза
- **`e9b258a`** Card pick modal: показ паттерна + русские описания эффектов

**Начало проекта:**
- **`dc518b5`** Первый веб-прототип «Кибер»

---

## Формат коммитов

- `feat:` — новая функциональность
- `fix:` — исправление бага
- `refactor:` — перестройка без смены поведения
- `ux:` — полировка интерфейса
- `remove:` — удаление функциональности

Без префикса — ранние коммиты до введения конвенции.
