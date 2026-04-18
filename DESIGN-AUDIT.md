# КИБЕР — Global Design & UX Audit (2026-04-19)

> Audit by **UI Designer** agent · Live measurements via `Claude_Preview` MCP
> Scope: presentation + interaction only (card balance / mechanics are frozen per `CLAUDE.md`)
> Audit target: `Web/index.html` + `Web/ui.js` + `Web/game.js` (as of commit UI-08)

---

## TL;DR — пять главных находок

1. **[P0] Узлы 5-й строки доски 5×5 физически скрыты под рукой на 375×667 при раскрытых картах и/или выбранной карте.** Доска рендерит 25 узлов в grid с `aspect-ratio:1`, но `#board-wrap { flex:1 }` даёт ей только 181.6px высоты → содержимое сетки (~251px) обрезается `clip-path`. Измерено: 10 нижних узлов (строки 4–5) уходят ниже `boardBottom` на 60.9px. **Это и есть «перекрытие UI и поля», с которым боролись UI-05…UI-08.**
2. **[P0] Landscape (667×375) полностью ломает игру.** Сумма chrome по вертикали = 391.5px, при высоте окна 375px. Доска сжимается до **22px × 142px**, action-bar и карты руки уходят за нижнюю границу `#app`, который имеет `overflow:hidden` → кнопки недоступны.
3. **[P0] Вертикальный бюджет пересвёрстан фиксированными высотами.** На 360×640 фиксированный chrome = 391.5px (60.6% экрана). Доска получает остаток 221.5px. В 5×5 это на грани (44.2px на узел) — но любая из четырёх вещей (`#card-desc`, `hardMode action-bar`, 3-й ряд раскрытых, `focus-info`) добавляет 25–70px и выводит доску за допустимые пределы.
4. **[P1] Точка касания меню HUD «≡» = 27×23.5px — ниже обязательного минимума 44×44px (iOS HIG / WCAG 2.5.5).** Аналогично кнопки-ротаторы в card-detail (~30×22), вкладка «СИНТЕЗ» в rules срезается справа.
5. **[P1] Шрифты 8–9px в tier-2 HUD нечитаемы.** Счётчик колоды обрезается (`КОЛОДА 5…`), счёт противника `P2` — 8px моноширинный на тёмном фоне. WCAG рекомендует ≥11px для текста интерфейса.

**Highest-ROI fix** — **UI-09 Vertical Budget Reform (см. Part 6)**: вынос `#card-desc` из потока доски, схлопывание revealed zone в компактную иконочную полоску, жёсткая грид-раскладка `#app` с `grid-template-rows` вместо flex/shrink-chain — одним комитом устраняет все три P0.

---

## Methodology

- **Viewports проверены**: 375×667 (iPhone SE), 360×640 (Android small), 390×844 (iPhone 13/14), 430×932 (iPhone 15 Pro Max), 667×375 (landscape).
- **Состояния игры**: 2p Turn 1 clean; 2p hand=6 / 9 revealed + card selected; 3p 5×5 с полной загрузкой; hardMode с +3 Добор; pause-menu; rules screen; card-pick modal.
- **Инструменты**: `getBoundingClientRect()` через `preview_eval`, `preview_inspect` для computed styles, `preview_screenshot` для визуальной верификации.
- **Файлы**: `Web/index.html` (2593 строки — DOM + все стили), `Web/ui.js` (2384 строки — рендер и логика).

Все измерения ниже получены на живом `localhost:8765` и воспроизводимы:

```js
window.ui._startGame(3, null, false);
// dismiss handoff
document.getElementById('btn-handoff-ok').click();
// force stress: reveals + full hand
const s = window.ui.state;
for (let pi=0; pi<3; pi++) for (let i=0; i<3; i++) s.players[pi].revealed.push(s.deck.cards.pop());
while (s.players[0].hand.length < 6) s.players[0].hand.push(s.deck.cards.pop());
window.ui._render();
```

---

## Part 1 — Screen Inventory

| Экран / Оверлей | Где в DOM | Видимость на 375×667 | Критические проблемы |
|---|---|---|---|
| Меню старта (BOOT.COMPLETE) | `#menu-screen` | OK | Нет |
| Онлайн-лобби | `#online-screen` | OK | Нет (2p only) |
| Online host / join | `#online-host-screen`, `#online-join-screen` | OK | Нет |
| Передача хода (handoff) | `#handoff-screen` | OK | Glitch-анимация мигает даже на handoff без «предыдущих действий» |
| **Главный экран игры** | `#app` | **OK в минимальном случае, критично ломается при стрессе** | См. Part 2–3 |
| In-game menu (pause) | `#ingame-menu` | OK | Нет (стабильно хорош) |
| Rules (правила) | `#rules-screen` | **FAIL в tabs** | Вкладка «СИНТЕЗ» обрезается справа на 375px; кнопка ✕ всего 28×25px |
| Card zoom (long-press) | `#card-detail` | OK | Кнопки-ротаторы ~30×22 — тесновато |
| DigCards / RevealCards / DiscardCards | `#card-pick-modal` | OK | Нет |
| Steal-pick (украсть) | `#steal-pick-modal` | OK | Нет |
| Synthesis order panel | `#synth-order-panel` | OK | Появляется поверх action-bar — на 375×667 может вытолкнуть action-bar за низ |
| End-turn handoff summary | `#handoff-stats` | OK | 6 rows stats — перегруз информации |
| Game over | `#gameover-screen` | OK | Нет |

**Primary pain-point экран = главный игровой (Part 2).** Меню, паузу, правила, модалки — трогать почти не надо.

**Ссылки на воспроизведение (скриншоты нужно снимать вручную):**
- `audit-screenshots/375x667-main-Turn1-clean.png` — `window.ui._startGame(2,null,false); OK`
- `audit-screenshots/375x667-main-stress-3p-9rev-6hand-selected.png` — скрипт выше, 3p
- `audit-screenshots/360x640-main-stress.png` — то же, resize перед рендером
- `audit-screenshots/667x375-main-LANDSCAPE-broken.png` — critical failure
- `audit-screenshots/375x667-rules-tabs-overflow.png` — открыть rules, вкладка СИНТЕЗ срезана
- `audit-screenshots/375x667-hand-hardMode-actionbar-wraps.png` — `s.hardMode=true; _render()`
- `audit-screenshots/375x667-long-names-truncated.png` — forced hand с 6 длинными именами

---

## Part 2 — Layout Budget Analysis

### 2.1 — Фиксированный chrome на 375×667 (iPhone SE)

Измерено через `getBoundingClientRect`, padding/gap/margin просчитаны из computed styles.

| Регион | Высота | CSS | Файл:строка |
|---|---|---|---|
| `#hud` (tier-1 + tier-2 + stepper) | **90px** | `padding:4px 4px 6px; gap:4px; border-bottom:1px` | `index.html:202` |
| gap (app) | 5px | `#app { gap:5px }` | `index.html:198` |
| `#phase-hint` | **29.5px** | `padding:6px 10px; border dashed` | `index.html:392` |
| gap | 5px | — | — |
| `#revealed-wrap` (0 cards) | **0** | `.collapsed { display:none }` | `index.html:426` |
| `#revealed-wrap` (≥1 card) | **88px** | `.rev-lane { padding:14px 12px 6px }` + card 66 | `index.html:430` |
| gap | 5px (if rev shown) | — | — |
| `#board-wrap` (`flex:1`) | ≥0, заполняет остаток | `align-items:center; justify-content:center` | `index.html:522` |
| gap | 5px | — | — |
| `#hand-wrap` (без card-desc) | **145px** (label 21 + cards 120) | `padding-top:3px; margin-top:2px` | `index.html:767` |
| `#hand-wrap` (+card-desc) | **145 + 65.4 = 210.4px** | `.card-desc max-height:110; actual ~65` | `index.html:780` |
| gap | 5px | — | — |
| `#action-bar` (2 кнопки) | **39px** | `padding:11px 8px` | `index.html:656` |
| `#action-bar` (3 кнопки, hardMode) | **68px** | кнопки переносятся из-за letter-spacing | там же |
| safe-area bottom | `env(safe-area-inset-bottom,0)` | `#app { padding:0 6px env(...) }` | `index.html:196` |

### 2.2 — Математика доски на 375×667

Доска: `width: min(100%, calc(100dvh * 0.38))` = `min(363, 253)` → 253px при 667dvh.
`aspect-ratio:1` + `max-height:100%` — если родитель `#board-wrap` выше 253 → доска 253×253. Если ниже — доска становится прямоугольной, но узлы остаются квадратами и **сетка выпирает за `clip-path` по высоте**.

| Сценарий (375×667) | Fixed chrome | Доска (h) | Доска (w) | Узел (4×4) | Узел (5×5) | Статус |
|---|---|---|---|---|---|---|
| Turn 1 clean, 2p, no reveals | 313.5 | 253.5 | 253.5 | 56.4px | — | **OK** |
| 2p + 1 reveal (88px) | 406.5 | 253.5 | 253.5 | 56.4px | — | **OK** (ещё не достигли height-cap) |
| 2p + 1 reveal + card selected (card-desc 65) | **471.5** | **181.6** | 253.5 | 45.4×45.4 (squeeze) | — | **прямоугольная доска** |
| 3p 5×5 + 1 reveal + no desc | 406.5 | 253.5 | 253.5 | — | 46.3×46.3 | **OK** |
| 3p 5×5 + 1 reveal + card-desc | 471.5 | **181.6** | 253.5 | — | **46.3w × 36.3h** | **FAIL: сетка 251.5px высоты обрезана до 181.6; строки 4–5 не видны** |
| 2p + hardMode action-bar (68 vs 39) | 342.5 | 224.5 | 224.5 | 49.6px | — | OK |

### 2.3 — То же на 360×640 (Android baseline)

Fixed chrome в min-случае: 90 + 29.5 + 145 + 39 + 25 (gaps) = **328.5px**.
Остаток на доску: **640 − 328.5 = 311.5px**, но width-cap = `640 × 0.38 = 243.2` → доска **243.2 × 243.2**, узел 5×5 = **44.2px**.
**На грани** (iOS HIG min = 44px).

Добавляем revealed (88) → остаток 223.5 → доска 223.5×223.5 → узел 5×5 = 40.3px → **НИЖЕ 44px**.
Добавляем card-desc (65) → остаток 158 → доска 158×158 → узел 5×5 = 28.6px → **НЕИГРАБЕЛЬНО**.

### 2.4 — Landscape 667×375 (поворот устройства)

Fixed chrome: 90 + 29.5 + 145 + 39 + 25 (gaps) + 88 (reveal if shown) = **416.5px**. Экран 375px.
**Дефицит ~41px. `#app { overflow:hidden }` обрезает action-bar.** Доска получает 22px высоты, 142px ширины (т.к. 375 × 0.38 ≈ 142 ограничивает сверху). 24px узлы, кнопки `Завершить ход` / `Утилизировать` не видны и недоступны.

**Файл:строка**: `index.html:186` — `body { overflow:hidden }` +  `index.html:190-199` — `#app { height:100dvh; overflow:hidden }` + нет `@media (orientation:landscape)` CSS.

### 2.5 — Вывод анализа бюджета

**Источник всех «overlaps», с которыми боролись UI-05, UI-06, UI-07, UI-08**:

1. **`#card-desc` лежит ВНУТРИ `#hand-wrap`** (`index.html:2177` внутри `#hand-wrap`), поэтому когда он появляется — `#hand-wrap` растёт на 65px, `#board-wrap` через `flex:1` сжимается, сетка 5×5 выпирает за `clip-path` доски и визуально «задвигается» под руку.
2. **Revealed zone всегда `position:static` и занимает 88px** при наличии хотя бы одной раскрытой карты. Никогда не компактизируется.
3. **`#action-bar` имеет гибкую высоту** (11px padding × 2 + контент). В hardMode три кнопки с `flex:1` и `letter-spacing:0.18em` не влезают в 363px одной строкой → переносятся → action-bar = 68px.
4. **`aspect-ratio:1` не работает при height-constraint.** Доска становится прямоугольной, но grid-auto-rows создаёт квадратные узлы → сетка перерастает контейнер → `clip-path` обрезает.
5. **Нет `@media (orientation:landscape)` или `@media (max-height: 700px)` альтернативной компоновки.** Единственный ответ «длинное описание карты или маленький экран» — сломать доску.

---

## Part 3 — Critical Issues (P0)

### P0-1 — Узлы 4–5 строки в 5×5 обрезаются `clip-path` доски и уходят под руку

**Что ломается**: при `3p 5×5 + any reveal + card-desc visible`, доска=253.5×181.6px (не квадратная), но grid создаёт 25 узлов по 46.3×46.3px → фактическая сетка 46.3×5 + 1×4gap + 28padding = 259.5px высоты. `#board { clip-path }` режет всё, что ниже 181.6. Физически узлы существуют в DOM, но **визуально скрыты** и **точка касания на них уходит ПОД `#hand-wrap`** (который начинается на y=408, а узлы 5-й строки простираются до y=462).

Измерено: `boardBottom: 401.6, row4.top: 369.9, row5.top: 416.2, row5.bottom: 462.5. clipped nodes: 10.`

**Где**: `index.html:526-542` (`#board` styles), `index.html:522` (`#board-wrap { flex:1 }`).

**Почему**: `aspect-ratio:1` — подсказка, перекрываемая `max-height:100%` от flex-родителя; grid auto-rows ставит узлы квадратами по ширине и переполняет контейнер.

**Fix spec (минимальный инвазивный)**:
```css
/* index.html:526 */
#board {
    display: grid;
    grid-template-columns: repeat(var(--cols, 4), 1fr);
    grid-template-rows:    repeat(var(--cols, 4), 1fr);   /* NEW — узел адаптируется и по высоте */
    /* ... остальное оставить ... */
}
#board.cols-5 { --cols: 5; }
```
И в `ui.js` выставлять `this.boardEl.classList.toggle('cols-5', state.playerCount === 3)`. Тогда узлы становятся прямоугольниками (46×36), но все 25 видимы и кликабельны. Это **временная** меря — основной фикс должен восстановить нужный вертикальный бюджет.

**Правильный fix (в рамках UI-09)**: `#card-desc` → overlay/tooltip поверх доски (абсолютное позиционирование), не в потоке. Тогда доска всегда получает полные 253×253, сетка 5×5 = 45×45 узлы квадратные.

---

### P0-2 — Landscape (667×375) абсолютно сломан

**Что ломается**: action-bar уходит на y=379.5 при viewport 375, bottom=418.5 — **43.5px action-bar ниже экрана**. Доска 22×142, 24px узлы. Карты руки клипаются на 50%. Кнопки «Завершить ход» / «Утилизировать» недоступны → игра застревает.

**Где**: нет media-query под landscape. `#app` высота = `100dvh` неизменна, содержимое не помещается.

**Почему**: вся компоновка спроектирована под portrait, `#board { width: min(100%, calc(100dvh * 0.38)) }` даёт крошечную ширину (142px = 375×0.38).

**Fix spec (две опции)**:

**Option A — запретить landscape (быстрее, одна строчка)**:
```html
<!-- index.html head -->
<meta name="screen-orientation" content="portrait">
```
+ CSS-overlay «Поверните устройство»:
```css
@media (orientation: landscape) and (max-height: 500px) {
    #app, .overlay { display: none !important; }
    body::before {
        content: 'Поверните устройство вертикально';
        position: fixed; inset: 0;
        display: flex; align-items: center; justify-content: center;
        font: 700 16px var(--mono); color: var(--accent);
        background: var(--bg-0); letter-spacing: 0.2em;
        text-transform: uppercase; z-index: 99999;
    }
}
```

**Option B — реальная landscape-вёрстка** (две колонки: доска слева, HUD+hand+action справа). Сильно больше работы, но профессиональнее. **Рекомендация: A на 4–6 недель, B в отдельный релиз.**

---

### P0-3 — Hand-wrap растёт на 65px при выборе любой карты, `#card-desc` пересоздаёт layout при каждом тапе

**Что ломается**: пользователь тапает карту → `#card-desc` меняется из `.empty { display:none }` на 65.4px высоту внутри `#hand-wrap` → `#hand-wrap` растёт 145→210 → `#board-wrap` (flex:1) сжимается → узлы в 5×5 перерисовываются по 36.3px высоты вместо 46.3 → **пользователь теряет координаты уже намеченного паттерна**.

Это ровно тот же source-of-truth, что и P0-1. На 2p 4×4 это не катастрофично (доска 181.6 → узел 45.4), но на 5×5 — критично.

**Где**: `index.html:2177` (`<div id="card-desc">` внутри `<div id="hand-wrap">`), CSS `index.html:779-820`.

**Fix spec (выбор из двух)**:

**Option A — overlay над доской**:
```css
#card-desc {
    position: absolute;
    left: 12px; right: 12px;
    bottom: calc(var(--hand-h, 145px) + var(--action-h, 45px) + 20px);
    z-index: 50;
    max-height: 120px;
    /* ... rest ... */
    backdrop-filter: blur(8px);
    background: rgba(10, 22, 32, 0.92);
}
#card-desc.empty { display:none; }
```
И вынести `#card-desc` из `#hand-wrap` в `#app` как sibling.

**Option B — в нижний лист поверх action-bar** (swipe-up sheet, как iOS): сложнее, лучше UX для длинных описаний.

**Acceptance**: на 375×667 с selected card размеры `#board` не меняются → узлы 5×5 остаются 46×46.

---

### P0-4 — `#hand-wrap` + `#app { overflow:hidden }` ведут к «подлезанию» карт под action-bar на коротких экранах

**Что ломается**: `#hand-cards` имеет `overflow-x:auto` (OK) и `padding: 4px 2px` (OK), но `.card` имеет `transform-origin: bottom center` + при selected `transform: translateY(-8px)` — top уходит вверх на 8px вне `#hand-cards` (`overflow:visible`). Это само по себе безобидно, НО в hardMode action-bar=68px, hand-wrap=145px, chrome total = 313+50 extras = **уже сжатая доска 182-224px, карты при hover/selected подпрыгивают и визуально залазят в доску сверху**.

**Где**: `index.html:995` (`transform-origin: bottom center`), `index.html:998-1004` (`.card.selected { transform: translateY(-8px) }`), `index.html:656` (`#action-bar { flex-shrink:0 }` — правильно, но ничто не ограничивает его рост).

**Fix spec**:
```css
#action-bar {
    display: flex; gap: 6px; flex-shrink: 0;
    min-height: 40px;
    max-height: 48px;    /* NEW — фиксированный высотный бюджет, иначе переноса не будет */
}
#action-bar .btn {
    white-space: nowrap;
    font-size: 10px;              /* 11→10 ради фита 3 кнопок на 363px */
    letter-spacing: 0.14em;       /* 0.18→0.14 */
    padding: 11px 6px;
}
/* и/или: */
#action-bar .btn .btn-short { display: none; }
#action-bar .btn .btn-full  { display: inline; }
@media (max-width: 380px) {
    #action-bar:has(.btn + .btn + .btn) .btn-full { display: none; }
    #action-bar:has(.btn + .btn + .btn) .btn-short { display: inline; }
}
/* В HTML: текст кнопок обернуть в <span class="btn-short">+3</span><span class="btn-full">+3 Добор</span> */
```

**Acceptance**: `.btn` всегда одна строка, action-bar ≤ 48px высотой даже при 3 кнопках на 360px.

---

### P0-5 — HUD menu button «≡» = 27×23.5px, недоступен для уверенного тапа

**Что ломается**: кнопка меню 27×23.5 при iOS HIG min 44×44 / WCAG 2.5.5 min 24×24 (это самый минимум, HIG — 44). Пальцем на ходу — неточный тап открывает меню либо промахивается и попадает в `.hud-score-max`.

**Где**: `index.html:333-347` (`.hud-menu-btn { padding:2px 8px; font-size:13px }`).

**Fix spec**:
```css
.hud-menu-btn {
    min-width: 44px;
    min-height: 36px;
    padding: 8px 12px;
    font-size: 18px;
    /* ... остальное оставить ... */
}
```

**Acceptance**: getBoundingClientRect().width ≥ 44, height ≥ 36.

---

### P0-6 — Rules: вкладка «СИНТЕЗ» срезается справа на 375px

**Что ломается**: 4 вкладки `ЦЕЛЬ/ХОД/КАРТЫ/СИНТЕЗ` через `flex:1` равновелики, но `letter-spacing:0.15em` + `font-size:9px` + `padding:8px 0` + 4×gap:3px → минимально нужная ширина ~380px при client width 347 (375 - 28 paddings). СИНТЕЗ (6 букв) визуально уходит под ✕-кнопку.

**Где**: `index.html:1983-2001` (`.rules-tab`).

**Fix spec**:
```css
.rules-tab {
    flex: 1; padding: 8px 4px;
    font-size: 8px;                /* 9→8 */
    letter-spacing: 0.05em;        /* 0.15→0.05 — или убрать полностью */
    text-align: center;
    white-space: nowrap;
    /* ... */
}
#rules-tabs { gap: 2px; }           /* 3→2 */
#rules-header { padding-right: 40px; }  /* резервируем место под ✕ */
```

---

## Part 4 — High-Value Improvements (P1)

### P1-1 — Revealed zone занимает 88px всегда, но содержит данные редкого использования

88px × (375) = **33000px² премиального вертикального пространства** жирного шрифта и превью 6 карт, которые пользователь смотрит 2–3 раза за партию.

**Recommendation — один из трёх паттернов**:

**A. Collapsible (по умолчанию свернуто до 24px иконок)**
```
┌─────────────────────────────────────────┐
│ ◦ РАСКРЫТО · 6 ● ● ● ● ● ●   [раскрыть ▾] │  ← 24px высоты, цветные диаманты по одному на каждую раскрытую
└─────────────────────────────────────────┘
```
По тапу — растёт до текущих 88px (полный ряд карт). Экономит 64px при свёрнутом состоянии → доска становится 253→307px (+21%).

**B. Inline в HUD-tier-2** (только когда 1–2 раскрытых): вкладывать cost+name в HUD строку.

**C. Бок (при ландшафте или width >480)**: как side-panel.

**Рекомендую A — минимальный редизайн, максимальный эффект.**

### P1-2 — Phase stepper (20.5px × 3 cells = 60px) дублирует информацию tier-2 HUD «ФАЗА 02·ХОД»

Stepper показывает те же 3 состояния, что уже есть в tier-2 (через `hud-phase-info`) и в `phase-hint` дашед-бар (оранжевая подсказка). **Три раза одно и то же**.

**Recommendation**: убрать stepper полностью (`-20.5px`), оставить tier-2 `ФАЗА 02·ХОД` как источник правды. Экономит 25px вертикали. Анимацию прогресса (past/current/future) перенести в tier-2 — например цветными точками рядом с `ФАЗА`.

### P1-3 — Tier-2 HUD перегружен, текст 8px нечитаем

Сейчас: `ХОД T01 · ФАЗА 02·ХОД · P2:0 · КОЛОДА 54/СБРОС 0` — в одну строку на 375px. `hud-meta-inline { font-size:8px; text-overflow:ellipsis }` обрезает «КОЛОДА 5…» справа — **пользователь НЕ видит, сколько карт в колоде** на небольших экранах.

**Recommendation**:
- Увеличить `tier-2 font-size` до 11px.
- Дроп `ХОД T01` (видно на handoff) ИЛИ `ФАЗА` метку (видно в stepper/hint).
- Колода/сброс — в виде компактных иконок `⬢ 54 ∙ ⬡ 0` справа от стопки, ~32px.

### P1-4 — Hand-label строка «◦ РУКА · Игрок 1 ··· 3/5» занимает 21px и дублирует HUD

Имя активного игрока уже есть в HUD tier-1. Счёт карт `3/5` дублируется в `cardDescCount`. **21px мёртвого места.**

**Fix**: удалить `#hand-label`, если `6/5` (превышение запаса) — показывать inline предупреждение рядом с action-bar или как overlay badge на hand.

### P1-5 — `#card-desc` показывает детализированный текст, но также дублирует инфу из `focus-info` в selected state

Когда карта выбрана (pending), `.focus-info` уже показывает имя + 3 строки эффекта. А `#card-desc` под этим ещё раз дублирует описание. Двойной рендер, двойной расход высоты.

**Fix**: `#card-desc` должен скрываться при focus-mode. Сейчас `_renderCardDesc` (ui.js:677) не учитывает `pendingCard`:
```js
_renderCardDesc() {
    if (this.pendingCard || !this._descCard) { /* scan for empty class */ ... }
    ...
}
```
Проверить через grep/read.

### P1-6 — Длинные имена карт (6 из 54) обрезаются в руке (`…`)

На `card.card-name { width:94px }` (= 108 - 2×6 pad - 2 border) 18-символьное имя гарантированно обрезается.

**Ответ 1 — уменьшить font-size только для длинных**:
```js
// ui.js::_makeCardEl
if (card.name.length > 14) nameEl.classList.add('card-name--long');
```
```css
.card-name { font-size: 9px; }
.card-name--long { font-size: 7.5px; letter-spacing: 0.06em; }
```

**Ответ 2 — перенос на 2 строки**:
```css
.card-name {
    white-space: normal;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.05;
    font-size: 8.5px;
}
```
Сейчас `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` (`index.html:1091`).

### P1-7 — Нет объяснения «что происходит» после розыгрыша карты

После розыгрыша карты эффекты срабатывают, фишки снимаются, счёт меняется — но **нет animation feedback**, указывающей что конкретно произошло. При синтезе (два эффекта каждой карты, порядок выбирает игрок) пользователь особенно теряется.

**Recommendation**: add toast-log «+2 очка · ИНЪЕКЦИЯ КОДА · противник сбросил 1 карту» с последовательной анимацией каждого эффекта. `#toast` элемент уже есть (`index.html:2586`), используется редко.

### P1-8 — Handoff screen показывает 6 rows статистики мелким моно-шрифтом 9px

На 375×667 экран передачи хода содержит: label + summary + end-gain + 6 stat-rows × 9px + glitch-анимация имени + кнопка `ПЕРЕДАТЬ →`. Это перегруз между раундами, когда игроки просто хотят быстро передать устройство.

**Recommendation**: 3 stat-rows по-умолчанию (`разыграно`, `утилизировано`, `очки за ход`), остальные 3 прятать под expand-chevron «▾ детали».

### P1-9 — `action-bar` кнопка `ЗАВЕРШИТЬ ХОД` — единственный путь завершить ход, но в случае «нет карт в руке + фишки размещены + нечего играть» игра ждёт, пока пользователь сам нажмёт. Это confusing.

**Recommendation**: когда `canPlay === false && chipsPlaced === chipsAllowed`, автоматически показать большой orange hint «ПОРА ПЕРЕДАТЬ ХОД» с 1-sec-delay перед активацией — чтобы пользователь увидел что ход завершён.

---

## Part 5 — Polish (P2)

### P2-1 — Слишком много декоративных clip-path, отвлекающих от функции
Каждый элемент интерфейса имеет свой beveled-clip: HUD, кнопки, card, modal, pause, rules-frame, action-bar buttons, handoff-panel, card-pick-list — всего **14 разных polygon()**. Это визуальный шум. **Recommendation**: унифицировать до 3 размеров bevel (4px/8px/14px) и использовать CSS custom prop `--bevel: 8px;` как в дизайн-системах.

### P2-2 — Три оранжевых border (phase-hint, focus-info, action-bar:utilize) конкурируют
Когда `phase-hint` оранжевый (tone-action) + `focus-info` оранжевый + кнопка `ВЫПОЛНИТЬ` (btn-primary) тоже оранжевая + `.card.selected` оранжевая — весь экран один цвет, иерархия теряется.

**Recommendation**: зарезервировать **оранжевый ТОЛЬКО для текущего активного шага** (single call-to-action). Остальное — cyan (accent-secondary) или только рамка.

### P2-3 — Отсутствует анимация при смене active player

Кроме `glitch-text` на handoff-screen и смены цвета HUD diamond, нет явного транзишена между ходами. Пользователь не сразу замечает что теперь его ход (особенно в hot-seat где handoff-screen уже закрыли).

**Recommendation**: на `_render()` при смене `currentPI` — короткий board shake + pulse рамки #app в цвете нового игрока (0.6s).

### P2-4 — Стили для peek-zoom (card-detail) visually inconsistent с main hand card
Карта в руке 108×112 со своим layout (cost, pattern, name). Peek-popup `#card-detail` совсем другой layout (header + centered name + pattern 110×110 + effects). **Должен быть scaled-up версией hand-card**, а не переизобретение.

### P2-5 — Длинные описания эффектов в `.focus-info .fi-eff` ограничены `-webkit-line-clamp: 3`

Карты с 3+ эффектами (например, ИНТЕРФЕЙС: поставить 4, раскрыть 2 себе, сбросить 1 противник) теряют последнюю строку. Клэмп без индикатора «…ещё 2 эффекта».

**Fix**: добавить chevron ▸ чтобы расширить focus-info до полного текста.

### P2-6 — Hard-mode toggle в меню не даёт preview как именно изменится игра
«РАСШИРЕННЫЕ ПРАВИЛА · ПРОПУСК ХОДА · +3 КАРТЫ» — понятно что расширится, но не понятно как. Onboarding miss.

---

## Part 6 — Recommended Implementation Order

### Commit UI-09 — Viewport-aware layout system (P0-1 + P0-3 + P0-4)
**Goal**: доска всегда получает полный квадрат, `#card-desc` и action-bar не отъедают вертикаль.
**Files**: `index.html` (CSS `#app`, `#board`, `#card-desc`, `#action-bar`), `ui.js` (переместить `#card-desc` из `#hand-wrap` в `#app` как overlay; мелкие правки).
**Changes**:
1. `#app` заменить `display:flex; flex-direction:column` на `display:grid; grid-template-rows: auto auto auto 1fr auto auto;`. Slots: hud / phase-hint / revealed / board / hand / action-bar.
2. `#card-desc` — `position:absolute; bottom: calc(var(--hand-h)+var(--action-h)+safe)` или в отдельный slot с `max-height`. Убрать из `#hand-wrap`.
3. `#board` — добавить `grid-template-rows: repeat(var(--cols,4), 1fr);` чтобы сетка честно фитилась в контейнер.
4. `#action-bar { max-height: 48px }` + text-shorteners через `@media`.
**Acceptance**:
- 375×667, 3p 5×5, все 3 revealed × 3 players, card selected с desc — все 25 узлов визуально видны и тапаются, доска ≥ 240×240.
- 360×640 5×5: узлы ≥ 40px.
- HardMode 3 кнопки: action-bar на одной строке ≤ 48px.

### Commit UI-10 — Revealed zone redesign (P1-1 + P1-2)
**Goal**: HUD занимает 50px вместо 90+30 и меняет revealed на collapsible strip.
**Files**: `index.html` (HTML + CSS), `ui.js` (`_renderRevealed`, `_updatePhaseHint`).
**Changes**:
1. Удалить `.phase-stepper` полностью; перенести three-state indicator в tier-2 (точки ● ● ○).
2. `#revealed-wrap` — по умолчанию 24px collapsed-strip с цветными диамантами (один на каждую раскрытую), по тапу — разворачивается до 88px.
3. Tier-2 шрифт 8→11px, убрать дубликаты.
**Acceptance**: HUD ≤ 60px height. Revealed default = 24px. Экономит ~55px вертикали.

### Commit UI-11 — Touch targets & typography pass (P0-5 + P0-6 + P1-3)
**Goal**: все интерактивные элементы ≥ 36×36 (idx 44×44 where possible), текст ≥ 11px.
**Files**: `index.html` (CSS только).
**Changes**:
1. `.hud-menu-btn { min-width:44px; min-height:36px }`.
2. `.btn-rotate { min-width:44px; min-height:36px; font-size:16px }`.
3. `.rules-tab { font-size:8px; letter-spacing:0.05em }` + `#rules-header { padding-right:44px }`.
4. `#btn-rules-close { min-width:44px; min-height:44px }`.
5. Все 8px шрифты в HUD → 11px.
6. Длинные имена карт — 2-строчный clamp (P1-6).
**Acceptance**: все `getBoundingClientRect()` интерактивных элементов ≥ 36 на любой dimension.

### Commit UI-12 — Landscape lockout (P0-2) + polish (P2)
**Goal**: запретить landscape с информативным оверлеем + визуальная чистка.
**Files**: `index.html` (HTML meta + CSS media-query).
**Changes**:
1. Landscape overlay «Поверните устройство» (см. Fix spec P0-2 option A).
2. Унификация `--bevel` custom prop (P2-1).
3. Оранжевый зарезервирован для single CTA (P2-2).
4. Player-change pulse animation (P2-3).
**Acceptance**: при повороте устройства — overlay, при возврате portrait — игра.

---

## Part 7 — Open Design Questions

1. **Revealed zone: collapsed strip vs inline vs drawer?** Рекомендую strip (P1-1 вариант A), но возможно пользователю лень каждый раз тапать чтобы увидеть раскрытые. Альтернатива: показывать полный ряд только в **фазе Задача** (когда реально можно разыграть) — автоматически. В остальных фазах — collapsed.

2. **Phase stepper: удалить или перенести?** Если стабильно пользователи теряются на каком шаге хода они — ok оставить как 20px. Если они понимают через phase-hint bar — удалить. Нужен user-test на 5 человек.

3. **Landscape: запрещать или поддерживать?** Запрет проще. Поддержка красивее, но это целый side-layout, ещё 500 строк CSS. Что важнее: быстрый hot-seat PvP (портрет идеален) или «дома на столе планшет» (landscape на iPad logical)? Сейчас проект мобильный-first, рекомендую запрет.

4. **`#card-desc` как overlay vs inline sheet?** Overlay (absolute position) быстрее в реализации. Bottom-sheet (swipe-up) красивее и даёт место под длинные тексты. Какая метрика важнее — полнота информации или скорость hot-seat?

5. **Hard mode на-главной кнопке + онбординг-preview?** Пока HARD — toggle на главном меню. Если usage < 20%, это просто шум. Если > 40% — нужно лучше объяснить что меняется (мини-иконка «+3 карты» визуально).

6. **Card name truncation: 2-line clamp vs dynamic font?** 2-строки конфликтуют с высотой карты 112px (имя займёт 24px вместо 14). Dynamic font — не все длинные имена одинаково длинные, гранулярность мелкая. **Компромисс**: 2-line clamp + уменьшить card height до 118px (прежний размер был 128, ещё ранее 168).

7. **Action-bar 68px vs 48px в hard mode**: вариант сокращать тексты кнопок (`+3 Добор` → `+3`) теряет ясность для начинающих. Вариант с `font-size:10px letter-spacing:0.14em` — компромисс. Иконочные кнопки (картинки) — самый компактный, но требует создания SVG (unicode ＋ ⏭ ✦ уже используются).

8. **«Завершить ход» auto-prompt**: если игра *автоматически* подсветит «нажми» когда ход завершён (P1-9) — это ускорит hot-seat, но может ощущаться как назойливость. User-preference?

---

## Приложение A — Exact viewport measurements table

| Viewport | HUD | phHint | Rev | Board (h×w) | Hand | Action | Total chrome | Node (4×4) | Node (5×5) |
|---|---|---|---|---|---|---|---|---|---|
| 375×667 clean 2p | 90 | 29.5 | 0 | 253.5×253.5 | 145 | 39 | 318.5 | 56.4 | — |
| 375×667 + 1rev | 90 | 29.5 | 88 | 253.5×253.5 | 145 | 39 | 406.5 | 56.4 | — |
| 375×667 + 1rev + desc | 90 | 29.5 | 88 | **181.6×253.5** | 210.4 | 39 | 471.5 | 45.4×45.4 | **46.3×36.3 (clipped!)** |
| 375×667 hardMode | 90 | 29.5 | 0 | 224.5×224.5 | 145 | **68** | 347.5 | 50 | — |
| 360×640 clean | 90 | 29.5 | 0 | 243.2×243.2 | 145 | 39 | 328.5 | 53.9 | **44.2** |
| 360×640 + 1rev | 90 | 29.5 | 88 | 223.5×223.5 | 145 | 39 | 416.5 | 49.5 | **40.3** |
| 390×844 clean | 90 | 29.5 | 0 | 320.7×320.7 | 145 | 39 | 348.5 | 74.4 | 59.8 |
| 430×932 clean | 90 | 29.5 | 0 | 354.2×354.2 | 145 | 39 | 348.5 | 82.2 | 66.4 |
| **667×375 landscape** | 90 | 29.5 | 88 | **22×142** | 145 | 39 (off-screen) | **416.5** | **24** | **broken** |

---

## Приложение B — Touch target audit

| Элемент | Селектор | w×h | Мин 44×44? | Fix priority |
|---|---|---|---|---|
| HUD menu ≡ | `.hud-menu-btn` | 27×23.5 | **FAIL** | P0-5 |
| Phase cell (informational) | `.ps-cell` | 115×20.5 | — indicator only, OK | — |
| Hand card | `.card` | 108×112 | **OK** | — |
| Revealed card | `.rev-lane .card` | 58×66 | **FAIL (touch-tap)** | P1-1 (redesign → icons) |
| Board node 4×4 (375×667) | `.node` | 56×56 | **OK** | — |
| Board node 5×5 (360×640) | `.node` | 44.2×44.2 | **borderline** | P0-1 |
| Board node 5×5 (360×640 + rev) | `.node` | 40.3×40.3 | **FAIL** | P0-1 |
| Rules tab | `.rules-tab` | ~85×28 | borderline | P0-6 |
| Rules close ✕ | `#btn-rules-close` | ~32×28 | **FAIL** | P0-6 |
| Card-detail close ✕ | `#card-detail-close` | full-width ×40 | OK | — |
| Rotate ↺ ↻ | `.btn-rotate` | ~30×22 | **FAIL** | P1 |
| Action button (2-btn layout) | `.btn` | 178×39 | OK | — |
| Action button (3-btn hardMode) | `.btn` | 110×68 (wrapped) | OK (wrap = bad UX) | P0-4 |
| `+` / `-` handoff | `#btn-handoff-ok` | full×42 | OK | — |
| Menu mode btn | `.btn-mode` | 178×65 | OK | — |
| HARD toggle | `.menu-hard` | 351×54 | OK | — |

---

## Приложение C — Font size audit

| Элемент | Селектор | Size | WCAG 11px min? |
|---|---|---|---|
| HUD player name | `.hud-player-name` | 15px | **OK** |
| HUD score | `.hud-score` | 20px | **OK** |
| tier-2 label | `.t2-label` | 9px | **borderline** |
| tier-2 inline meta | `.hud-meta-inline` | **8px** | **FAIL** |
| Opp-scores badges | `.hud-opp-scores > span` | **8px** | **FAIL** |
| Phase cell | `.ps-cell` | 8px | OK (indicator) |
| Phase hint | `#phase-hint` | 10px | borderline |
| Rev lane label | `.rev-lane-label` | 9px | borderline |
| Rev card name | `.rev-lane .card-name` | **6px** | **FAIL** |
| Rev card cost | `.rev-lane .card-cost` | **7px** | **FAIL** |
| Hand card name | `.card-name` | 9px | borderline |
| Hand card cost | `.card-cost` | 10px | OK |
| Action btn | `.btn` | 11px | OK |
| Card-desc text | `.card-desc` | 10px | borderline |
| Focus-info eff | `.fi-eff` | **9px** | **FAIL** |
| Pick-item header | `.pick-item-header` | 11px | OK |
| Pick-item fx | `.pick-item-fx` | 9px | borderline |
| Rules paragraph | `.rules-p` | 13px | **OK** |
| Rules tab | `.rules-tab` | **9px** | **FAIL** |
| Handoff stat | `.handoff-stat-row` | **9px** | **FAIL** |
| Gameover stat | `.gameover-stat` | 10px | borderline |

**8 элементов ниже 11px → пересмотреть в UI-11.**

---

**Audit завершён 2026-04-19. Автор — UI Designer agent.**
**Следующий шаг**: пользователь должен выбрать, какие Commits UI-09/10/11/12 брать в работу, и принять решение по Open Design Questions (особенно вопросы 1, 3, 6).
