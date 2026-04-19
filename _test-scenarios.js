// ═══════════════════════════════════════════════════════════
//  КИБЕР — Targeted scenarios (headless, no browser)
// ═══════════════════════════════════════════════════════════
//
//  Покрывает узкие места, которые fuzz случайно не добивает:
//    1) Reshuffle при пустой колоде — сохранение суммы карт = 54
//    2) Синтез двух карт — оба эффекта отрабатывают + карты в сброс
//    3) Hard-mode drawThree / бонус +1 фишка на следующий ход
//
//  Запуск:
//    node _test-scenarios.js
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ── Загружаем game.js в изолированный контекст ───────────────
const gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
const wrapped = `
${gameSrc}
;(function() {
  const __exp = { Occ, Phase, CellType, Target, GameState, TurnManager,
                  PatternMatcher, CardDatabase, CardEffect, Deck, BoardState,
                  PlayerState };
  for (const k in __exp) globalThis[k] = __exp[k];
})();
`;
const context = { console, globalThis: null, Math, Array, Set, Map, Object, JSON, Number, String, Infinity, NaN };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(wrapped, context, { filename: 'game.js' });
const {
    Occ, Phase, CellType, Target,
    GameState, TurnManager, PatternMatcher, CardDatabase, CardEffect
} = context;

// ── Утилиты ──────────────────────────────────────────────────
function totalCardsInSystem(st) {
    let n = st.deck.count + st.discard.length;
    for (const p of st.players) n += p.hand.length + p.revealed.length;
    return n;
}

function makeInput() {
    return {
        sourceCard: null, sourceMode: null,
        actionKind: null, actionCount: 0, actionTargetSelf: true, digStep: null,
        chooseCards(pi, pool, n, done) { done(pool.slice(0, n)); },
        chooseNodes(pi, empty, n, done) { done(empty.slice(0, n)); },
        chooseStealSource(ap, ctx, done) {
            const { revealedPool, opponents } = ctx;
            if (opponents.length > 0) done({ type: 'blind', ownerPI: opponents[0].pi });
            else if (revealedPool.length > 0) done({ type: 'revealed', card: revealedPool[0].card, ownerPI: revealedPool[0].ownerPI });
            else done(null);
        },
    };
}

function assert(cond, msg) {
    if (!cond) { console.error('  ✗ FAIL:', msg); process.exitCode = 1; throw new Error(msg); }
}

let passCount = 0;
let failCount = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passCount++;
    } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        failCount++;
    }
}

// ── Сценарий 1: Reshuffle ────────────────────────────────────
// Принудительно выкачиваем всю колоду + вызываем draw, требующий reshuffle
// из сброса. Проверяем: сумма карт = 54, дубликатов нет.
function scenarioReshuffle() {
    console.log('── Сценарий 1: Reshuffle ──');

    test('draw до дна + reshuffle из сброса сохраняет 54 карты', () => {
        const st = new GameState(4, 15, 2, false);
        const total0 = totalCardsInSystem(st);
        assert(total0 === 54, `initial total=${total0}, expected 54`);

        // Выкачиваем всю колоду в сброс
        const initialDeck = st.deck.count;
        const drawn = st.deck.draw(initialDeck);
        assert(st.deck.count === 0, `deck should be empty, got ${st.deck.count}`);
        // Положим в сброс вручную (имитируем розыгрыш всех карт)
        st.discard.push(...drawn);

        // Теперь draw(1) должен спровоцировать reshuffle
        const n1 = st.deck.count;
        const d1 = st.deck.draw(1);
        assert(d1.length === 1, `draw(1) returned ${d1.length}`);
        assert(st.deck.count > 0 || st.discard.length === 0,
            'reshuffle должен был наполнить колоду');

        // Сумма карт сохранилась (берём из системы, не забыв draw)
        // Добавим draw'ные обратно в сброс для чистой сверки
        st.discard.push(...d1);
        const total1 = totalCardsInSystem(st);
        assert(total1 === 54, `after reshuffle total=${total1}, expected 54`);

        // Уникальность по референсу
        const seen = new Set();
        const all = [...st.deck.cards, ...st.discard,
            ...st.players.flatMap(p => [...p.hand, ...p.revealed])];
        for (const c of all) {
            assert(!seen.has(c), `duplicate card ref: ${c.name}#${c.id}`);
            seen.add(c);
        }
        assert(seen.size === 54, `unique cards=${seen.size}, expected 54`);
    });

    test('draw когда и колода и сброс пусты — возвращает меньше', () => {
        const st = new GameState(4, 15, 2, false);
        // Опустошим всё
        const all = [...st.deck.cards];
        st.deck.cards.length = 0;
        st.discard.length = 0;
        // hand'ы не трогаем — они не мешают логике draw
        const out = st.deck.draw(5);
        assert(out.length === 0, `empty-both should return 0, got ${out.length}`);
        // Вернём карты в колоду, чтобы не корёжить другие тесты (не обязательно)
        st.deck.cards.push(...all);
    });

    test('многократный reshuffle подряд не теряет карты', () => {
        const st = new GameState(4, 15, 2, false);
        const total0 = totalCardsInSystem(st);

        // 10 раз: выкачать всё → закинуть в сброс → draw(1) → снова в сброс
        for (let i = 0; i < 10; i++) {
            const drawn = st.deck.draw(st.deck.count);
            st.discard.push(...drawn);
            const d = st.deck.draw(1);
            st.discard.push(...d);
        }
        const total1 = totalCardsInSystem(st);
        assert(total1 === total0, `total ${total0} → ${total1} after 10 reshuffles`);
    });
}

// ── Сценарий 2: Синтез ───────────────────────────────────────
// Hand-crafted: ставим на доску такое, чтобы две карты имели паттерн с общей фишкой.
// Проверяем: оба эффекта отработали, обе карты в сбросе, фишки сняты один раз.
function scenarioSynth() {
    console.log('── Сценарий 2: Синтез (hard mode) ──');

    test('synthesis двух карт — паттерн + общая фишка', () => {
        const st = new GameState(4, 15, 2, true); // hardMode=true
        const tm = new TurnManager(st, makeInput());

        // Ищем две карты в колоде с простыми одно-фишечными паттернами W,
        // чтобы мы могли их наложить с общей фишкой.
        // БАЙТ и БИТ — оба 3×3, один белый узел в (1,1). Идеально: общая фишка.
        const allCards = [...st.deck.cards];
        const bayt = allCards.find(c => c.name === 'БАЙТ');
        const bit  = allCards.find(c => c.name === 'БИТ');
        assert(bayt && bit, 'need БАЙТ и БИТ в колоде');

        // Подкладываем игроку в руку
        const pl = st.players[0];
        // Удаляем эти карты из колоды/сброса (убедимся что не в hand уже)
        [bayt, bit].forEach(c => {
            const di = st.deck.cards.indexOf(c);
            if (di >= 0) st.deck.cards.splice(di, 1);
        });
        pl.hand.push(bayt, bit);

        // Ставим свою фишку в центр доски — это будет общая точка
        st.board.nodes[1][1] = Occ.P1; // P1 = игрок 0 в обозначении Occ
        pl.chipsOnBoard = 1;

        // Переходим в фазу Turn (через нормальный replenish cycle)
        st.phase = Phase.Turn;
        st.chipsPlaced = 0;
        st.chipsAllowed = 2;
        st.tasksThisTurn = 0;
        st.utilizesThisTurn = 0;

        // Находим совпадения
        const matchesA = PatternMatcher.findMatches(bayt, st.board, 0);
        const matchesB = PatternMatcher.findMatches(bit,  st.board, 0);
        assert(matchesA.length > 0, 'БАЙТ должен матчиться (центр)');
        assert(matchesB.length > 0, 'БИТ должен матчиться (центр)');

        // Берём первые — совпадающие, т.к. оба указывают на (1,1)
        const mA = matchesA[0];
        const mB = matchesB[0];
        const posA = mA.chipPositions.map(p => p.join(',')).sort().join(';');
        const posB = mB.chipPositions.map(p => p.join(',')).sort().join(';');
        assert(posA === posB, `паттерны должны быть одинаковы: A=${posA} B=${posB}`);

        const scoreBefore = pl.score;
        const discardBefore = st.discard.length;
        const chipsBefore = pl.chipsOnBoard;

        let result = null;
        tm.synthesis(bayt, bit, mA, mB, true, r => { result = r; });
        assert(result === 'ok' || result === 'gameOver', `synthesis result=${result}`);

        // Проверки
        assert(pl.score === scoreBefore + bayt.cost + bit.cost,
            `score после synth: ${pl.score} != ${scoreBefore}+${bayt.cost}+${bit.cost}`);
        assert(st.discard.includes(bayt) && st.discard.includes(bit),
            'обе карты должны быть в сбросе');
        assert(!pl.hand.includes(bayt) && !pl.hand.includes(bit),
            'карты удалены из руки');
        assert(pl.chipsOnBoard === chipsBefore - 1,
            `фишка снята: ${chipsBefore} → ${pl.chipsOnBoard}`);
        assert(st.board.nodes[1][1] === Occ.Empty,
            'клетка (1,1) пуста после синтеза');
        assert(st.tasksThisTurn === 1, `tasksThisTurn=${st.tasksThisTurn}`);
    });

    test('synthesis отклоняется без общей фишки', () => {
        const st = new GameState(4, 15, 2, true);
        const tm = new TurnManager(st, makeInput());

        const allCards = [...st.deck.cards];
        const bayt = allCards.find(c => c.name === 'БАЙТ');
        const bit  = allCards.find(c => c.name === 'БИТ');
        assert(bayt && bit, 'need cards');

        [bayt, bit].forEach(c => {
            const di = st.deck.cards.indexOf(c);
            if (di >= 0) st.deck.cards.splice(di, 1);
        });
        st.players[0].hand.push(bayt, bit);

        // Две отдельные фишки — паттерны матчатся, но НЕ пересекаются
        st.board.nodes[1][1] = Occ.P1;
        st.board.nodes[2][2] = Occ.P1;
        st.players[0].chipsOnBoard = 2;

        st.phase = Phase.Turn;
        st.chipsPlaced = 0;
        st.chipsAllowed = 2;
        st.tasksThisTurn = 0;
        st.utilizesThisTurn = 0;

        const matchesA = PatternMatcher.findMatches(bayt, st.board, 0);
        const matchesB = PatternMatcher.findMatches(bit,  st.board, 0);
        // Берём разные совпадения (одно в 1,1 второе в 2,2)
        const mA = matchesA.find(m => m.chipPositions.some(([r,c]) => r===1 && c===1));
        const mB = matchesB.find(m => m.chipPositions.some(([r,c]) => r===2 && c===2));
        assert(mA && mB, 'matches на разных клетках');

        let result = null;
        tm.synthesis(bayt, bit, mA, mB, true, r => { result = r; });
        assert(result === 'invalidAction', `без общей фишки должно быть invalidAction, got ${result}`);
    });

    test('synthesis в easy mode отклоняется', () => {
        const st = new GameState(4, 15, 2, false); // hardMode=false
        const tm = new TurnManager(st, makeInput());

        const bayt = st.deck.cards.find(c => c.name === 'БАЙТ');
        const bit  = st.deck.cards.find(c => c.name === 'БИТ');
        [bayt, bit].forEach(c => {
            const di = st.deck.cards.indexOf(c);
            if (di >= 0) st.deck.cards.splice(di, 1);
        });
        st.players[0].hand.push(bayt, bit);
        st.board.nodes[1][1] = Occ.P1;
        st.players[0].chipsOnBoard = 1;
        st.phase = Phase.Turn;
        st.chipsPlaced = 0;
        st.chipsAllowed = 2;
        st.tasksThisTurn = 0;

        const mA = PatternMatcher.findMatches(bayt, st.board, 0)[0];
        const mB = PatternMatcher.findMatches(bit,  st.board, 0)[0];

        let result = null;
        tm.synthesis(bayt, bit, mA, mB, true, r => { result = r; });
        assert(result === 'invalidAction', `easy mode должен отклонить synth, got ${result}`);
    });
}

// ── Сценарий 3: Hard-mode drawThree + bonus chip ─────────────
function scenarioHardMode() {
    console.log('── Сценарий 3: Hard-mode drawThree / bonus chip ──');

    test('drawThree в easy mode отклоняется', () => {
        const st = new GameState(4, 15, 2, false);
        const tm = new TurnManager(st, makeInput());
        tm.replenish();
        const r = tm.drawThree();
        assert(r === 'invalidAction', `easy: drawThree=${r}`);
    });

    test('drawThree добавляет 3 карты и блокирует placeChip', () => {
        const st = new GameState(4, 15, 2, true);
        const tm = new TurnManager(st, makeInput());
        tm.replenish();
        const handBefore = st.cp.hand.length;
        const deckBefore = st.deck.count;

        const r = tm.drawThree();
        assert(r === 'ok', `drawThree=${r}`);
        assert(st.cp.hand.length === handBefore + 3, `hand ${handBefore} → ${st.cp.hand.length}`);
        assert(st.deck.count === deckBefore - 3, `deck ${deckBefore} → ${st.deck.count}`);
        assert(st.chipsAllowed === 0, `chipsAllowed после drawThree = ${st.chipsAllowed}`);

        // Попытка placeChip должна отклониться
        const emptyNode = st.board.emptyNodes()[0];
        const pr = tm.placeChip(emptyNode[0], emptyNode[1]);
        assert(pr === 'limitReached' || pr === 'invalidAction',
            `placeChip после drawThree: ${pr}`);

        // Повторный drawThree в том же ходу — отклонён
        const r2 = tm.drawThree();
        assert(r2 === 'invalidAction', `second drawThree=${r2}`);
    });

    test('endTurn без фишек и без drawThree → бонус +1 на след. ход', () => {
        const st = new GameState(4, 15, 2, true);
        const tm = new TurnManager(st, makeInput());
        tm.replenish();
        // Не ставим фишки, не draw — просто endTurn
        const pi0 = st.currentPI;
        tm.endTurn();
        assert(st.players[pi0].bonusChipsNextTurn === 1,
            `bonusChipsNextTurn=${st.players[pi0].bonusChipsNextTurn} (ожидаем 1)`);

        // Проходим чужой ход
        tm.replenish();
        tm.endTurn();

        // Наш следующий ход — chipsAllowed должен быть 3
        tm.replenish();
        assert(st.currentPI === pi0, `вернулись к pi=${pi0}`);
        assert(st.chipsAllowed === 3, `chipsAllowed на бонус-ходу = ${st.chipsAllowed} (ожидаем 3)`);
        assert(st.players[pi0].bonusChipsNextTurn === 0, 'бонус погашен');
    });

    test('endTurn с drawThree НЕ даёт бонус', () => {
        const st = new GameState(4, 15, 2, true);
        const tm = new TurnManager(st, makeInput());
        tm.replenish();
        tm.drawThree();
        tm.endTurn();
        const pi0 = (st.currentPI + st.playerCount - 1) % st.playerCount;
        assert(st.players[pi0].bonusChipsNextTurn === 0,
            `после drawThree бонус=${st.players[pi0].bonusChipsNextTurn} (ожидаем 0)`);
    });

    test('endTurn с фишкой НЕ даёт бонус', () => {
        const st = new GameState(4, 15, 2, true);
        const tm = new TurnManager(st, makeInput());
        tm.replenish();
        const e = st.board.emptyNodes()[0];
        tm.placeChip(e[0], e[1]);
        tm.endTurn();
        const pi0 = (st.currentPI + st.playerCount - 1) % st.playerCount;
        assert(st.players[pi0].bonusChipsNextTurn === 0,
            `после placeChip бонус=${st.players[pi0].bonusChipsNextTurn} (ожидаем 0)`);
    });
}

// ── Сценарий 4: PlaceChips после снятия фишек паттерна ──────
// playCard должен снимать фишки паттерна ДО выполнения эффекта,
// чтобы эффект PlaceChipsEffect мог ставить фишки на клетки паттерна.
function scenarioPlaceAfterPatternRemoval() {
    console.log('── Сценарий 4: PlaceChips видит клетки паттерна как пустые ──');

    test('playCard с PlaceChips может ставить на клетки только что снятого паттерна', () => {
        const st = new GameState(4, 15, 2, false);
        const tm = new TurnManager(st, makeInput());
        const db = CardDatabase.create();

        // МИГРАЦИЯ: pattern W(1,1), playEffect=Place(1) — идеальный тест
        const migr = Object.values(db).find(c => c.name === 'МИГРАЦИЯ');
        assert(!!migr, 'МИГРАЦИЯ должна быть в базе');

        const pl = st.players[0];
        pl.hand = [migr];
        pl.reserve = 6;

        // Ставим единственную фишку игрока 0 в (1,1) — это и паттерн МИГРАЦИИ, и единственное место.
        st.board.nodes[1][1] = Occ.P1;
        pl.chipsOnBoard = 1;
        // Блокируем остальные клетки фишкой противника, кроме (1,1).
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
            if (r === 1 && c === 1) continue;
            st.board.nodes[r][c] = Occ.P2;
        }
        st.players[1].chipsOnBoard = 15;

        // input.chooseNodes выберет первую доступную — ожидаем (1,1) после снятия паттерна
        let chosenEmpty = null;
        tm.input.chooseNodes = (pi, empty, n, done) => {
            chosenEmpty = empty.map(([r, c]) => `${r},${c}`);
            done(empty.slice(0, n));
        };

        // Подготавливаем Turn-фазу и запускаем playCard
        st.phase = Phase.Turn;
        st.chipsPlaced = 2; // размещение уже выполнено
        st.tasksThisTurn = 0;
        st.placedThisTurn = [];

        const matches = PatternMatcher.findMatches(migr, st.board, 0);
        assert(matches.length > 0, `должен быть хотя бы 1 матч, got ${matches.length}`);

        let result = null;
        tm.playCard(migr, matches[0], r => { result = r; });
        assert(result === 'ok', `playCard вернул "${result}", ожидаем "ok"`);
        assert(chosenEmpty && chosenEmpty.includes('1,1'),
            `empty должен содержать "1,1" (освобождённая клетка паттерна), got: ${JSON.stringify(chosenEmpty)}`);
        // И поставлена фишка в (1,1)
        assert(st.board.nodes[1][1] === Occ.P1,
            `в (1,1) должна быть фишка P1 после Place, got: ${st.board.nodes[1][1]}`);
    });

    test('synthesis снимает фишки обеих карт до эффектов', () => {
        const st = new GameState(4, 20, 2, true);
        const tm = new TurnManager(st, makeInput());
        const db = CardDatabase.create();

        // Две карты с общей фишкой и PlaceChips в playEffect:
        //  МИГРАЦИЯ (W(1,1), Place(1)) и ДУБЛИРОВАНИЕ (W(1,0), W(1,2), Place(1))
        const migr = Object.values(db).find(c => c.name === 'МИГРАЦИЯ');
        const dup  = Object.values(db).find(c => c.name === 'ДУБЛИРОВАНИЕ');

        const pl = st.players[0];
        pl.hand = [migr, dup];
        pl.reserve = 6;

        // Ставим фишки так, чтобы оба паттерна матчились с общей фишкой в (1,1):
        //  МИГРАЦИЯ: (1,1). ДУБЛИРОВАНИЕ: (1,0), (1,2). Общей клетки в паттернах нет — придётся match с offset.
        // Проще: сместим — МИГРАЦИЯ матчится в (1,1), ДУБЛИРОВАНИЕ найдёт свой (1,0)+(1,2) rotate может дать (0,1)+(2,1).
        // Альтернатива: MIGR use (1,1), и BUFFER (id=8 БУФЕРИЗАЦИЯ) с синтезом. Но тут нужен overlap.
        // Простейший надёжный оверлэп: сами себе. Только один способ — использовать одинаковые ячейки.
        // Берём МИГРАЦИЯ × МИГРАЦИЯ невозможно (cardA===cardB запрещено).
        // Используем МИГРАЦИЯ + БИТ — оба pattern = W(1,1). Тогда overlap = (1,1).
        const bit = Object.values(db).find(c => c.name === 'БИТ');
        pl.hand = [migr, bit];

        st.board.nodes[1][1] = Occ.P1;
        pl.chipsOnBoard = 1;
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
            if (r === 1 && c === 1) continue;
            st.board.nodes[r][c] = Occ.P2;
        }
        st.players[1].chipsOnBoard = 15;

        const seenEmpty = [];
        tm.input.chooseNodes = (pi, empty, n, done) => {
            seenEmpty.push(empty.map(([r, c]) => `${r},${c}`));
            done(empty.slice(0, n));
        };

        st.phase = Phase.Turn;
        st.chipsPlaced = 2;
        st.tasksThisTurn = 0;

        const mA = PatternMatcher.findMatches(migr, st.board, 0)[0];
        const mB = PatternMatcher.findMatches(bit,  st.board, 0)[0];
        assert(mA && mB, 'матчи обеих карт должны найтись');

        let result = null;
        tm.synthesis(migr, bit, mA, mB, true, r => { result = r; });
        assert(result === 'ok', `synthesis вернул "${result}"`);
        // МИГРАЦИЯ.playEffect = Place(1), БИТ.playEffect = [] → единственный chooseNodes — от МИГРАЦИИ
        // Если фишки сняты ДО эффекта — (1,1) должен быть в empty.
        assert(seenEmpty.length >= 1, `ожидаем минимум 1 вызов chooseNodes, got ${seenEmpty.length}`);
        const union = seenEmpty.flat();
        assert(union.includes('1,1'),
            `empty должен содержать "1,1" после снятия паттерна, got: ${JSON.stringify(seenEmpty)}`);
    });
}

// ── MAIN ─────────────────────────────────────────────────────
console.log('═══ КИБЕР TARGETED SCENARIOS ═══\n');
scenarioReshuffle();
console.log('');
scenarioSynth();
console.log('');
scenarioHardMode();
console.log('');
scenarioPlaceAfterPatternRemoval();
console.log('');
console.log(`── Итоги: ${passCount} pass, ${failCount} fail ──`);
process.exit(failCount > 0 ? 1 : 0);
