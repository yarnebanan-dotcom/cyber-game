// ═══════════════════════════════════════════════════════════
//  КИБЕР — Headless fuzz: thousands of randomized games
// ═══════════════════════════════════════════════════════════
//
//  Запуск:
//    node _test-fuzz.js                   # 1000 партий 2p, easy
//    N=5000 MODE=2p  node _test-fuzz.js
//    N=1000 MODE=3p  node _test-fuzz.js
//    N=1000 MODE=2ph node _test-fuzz.js   # 2p + hard
//    SEED=42 node _test-fuzz.js           # детерминированно
//    VERBOSE=1 node _test-fuzz.js         # логировать каждую партию
//
//  Что проверяется после каждого ActionStep:
//    · supply ∈ [2,6], score типа number, chipsOnBoard ≥ 0 и ≤ totalChips
//    · сумма карт в системе = размер колоды (без дублей по референсу)
//    · фактические фишки на доске совпадают с chipsOnBoard по игрокам
//    · tasksThisTurn ≤ 2, utilizesThisTurn ≤ 2
//    · нет исключений в TurnManager
//
// ═══════════════════════════════════════════════════════════

const fs  = require('fs');
const vm  = require('vm');
const path = require('path');

// ── Параметры ────────────────────────────────────────────────
const N        = parseInt(process.env.N || '1000', 10);
const MODE     = (process.env.MODE || '2p').toLowerCase();      // 2p | 3p | 2ph | 3ph
const SEED0    = parseInt(process.env.SEED || String(Date.now() & 0xffff), 10);
const VERBOSE  = !!process.env.VERBOSE;
const MAX_TURNS= parseInt(process.env.MAX_TURNS || '300', 10);  // safety cap
const STOP_ON_FAIL = !!process.env.STOP_ON_FAIL;

// ── Детерминированный RNG (Mulberry32) ──────────────────────
function makeRng(seed) {
    let s = seed >>> 0;
    return function() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Загружаем game.js в изолированный контекст ───────────────
// class X и const X в top-level НЕ попадают в globalThis vm-контекста.
// Трюк: оборачиваем в функцию-обёртку и экспортируем через `this`.
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
    GameState, TurnManager, PatternMatcher, CardDatabase,
    CardEffect
} = context;

// ── Фиксированный Math.random для определённого seed-а ───────
// В game.js shuffle() и Deck.shuffle используют global Math.random — подменяем.
function withSeededRandom(rng, fn) {
    const prev = Math.random;
    Math.random = rng;
    try { return fn(); } finally { Math.random = prev; }
}

// ── Режимы ───────────────────────────────────────────────────
function cfgFor(mode) {
    switch (mode) {
        case '2p':  return { boardSize: 4, winScore: 15, playerCount: 2, hardMode: false };
        case '2ph': return { boardSize: 4, winScore: 15, playerCount: 2, hardMode: true  };
        case '3p':  return { boardSize: 5, winScore: 20, playerCount: 3, hardMode: false };
        case '3ph': return { boardSize: 5, winScore: 20, playerCount: 3, hardMode: true  };
        default: throw new Error('MODE must be 2p|2ph|3p|3ph');
    }
}

// ── Валидные выборы: случайно из пула ────────────────────────
function pickRandomSubset(arr, n, rng) {
    const pool = [...arr];
    const out = [];
    const k = Math.min(n, pool.length);
    for (let i = 0; i < k; i++) {
        const idx = Math.floor(rng() * pool.length);
        out.push(pool.splice(idx, 1)[0]);
    }
    return out;
}

// ── Инварианты ───────────────────────────────────────────────
function checkInvariants(tm, ctx) {
    const st = tm.state;

    // supply каждого игрока в [2, 6]
    for (const p of st.players) {
        if (p.supply < 2 || p.supply > 6)
            throw new Error(`supply out of bounds: P${p.idx}.supply=${p.supply}`);
        if (p.chipsOnBoard < 0 || p.chipsOnBoard > p.totalChips)
            throw new Error(`chipsOnBoard out of bounds: P${p.idx}=${p.chipsOnBoard}/${p.totalChips}`);
        if (typeof p.score !== 'number' || Number.isNaN(p.score))
            throw new Error(`score NaN: P${p.idx}=${p.score}`);
    }

    // chipsOnBoard сверка с фактической доской
    const boardCounts = new Array(st.playerCount).fill(0);
    for (let r = 0; r < st.board.size; r++)
        for (let c = 0; c < st.board.size; c++) {
            const occ = st.board.nodes[r][c];
            if (occ !== Occ.Empty) boardCounts[occ - 1]++;
        }
    for (let i = 0; i < st.playerCount; i++) {
        if (boardCounts[i] !== st.players[i].chipsOnBoard)
            throw new Error(`chipsOnBoard mismatch P${i}: board=${boardCounts[i]} vs player=${st.players[i].chipsOnBoard}`);
    }

    // tasksThisTurn/utilizesThisTurn ≤ 2
    if (st.tasksThisTurn > 2)       throw new Error(`tasksThisTurn=${st.tasksThisTurn} > 2`);
    if (st.utilizesThisTurn > 2)    throw new Error(`utilizesThisTurn=${st.utilizesThisTurn} > 2`);

    // Целостность колоды: все карты уникальны по референсу, сумма = изначальное число
    const seen = new Set();
    const addCard = (c) => {
        if (seen.has(c)) throw new Error(`duplicate card ref: ${c?.name}#${c?.id}`);
        seen.add(c);
    };
    for (const p of st.players) { p.hand.forEach(addCard); p.revealed.forEach(addCard); }
    for (const c of st.discard) addCard(c);
    for (const c of st.deck.cards) addCard(c);
    if (seen.size !== ctx.totalCards)
        throw new Error(`cards missing: have ${seen.size}, expected ${ctx.totalCards}`);
}

// ── Агент: валидные случайные действия на ходу ───────────────
function playOneTurn(tm, rng) {
    const st = tm.state;

    // Replenish → Turn. Перед replenish — погасить pendingActions (как делает UI).
    if (st.phase === Phase.Replenish) {
        resolvePending(tm, rng);
        tm.replenish();
    }

    // В Hard: иногда (10%) выбираем альтернативу drawThree вместо фишек
    if (st.hardMode && st.chipsPlaced === 0 && rng() < 0.10) {
        tm.drawThree();
    } else {
        // Размещение 2 фишек
        for (let i = 0; i < 2; i++) {
            if (st.chipsPlaced >= st.chipsAllowed) break;
            if (st.cp.reserve <= 0) break;
            const empties = st.board.emptyNodes();
            if (empties.length === 0) break;
            const [r, c] = empties[Math.floor(rng() * empties.length)];
            tm.placeChip(r, c);
        }
    }

    // Попытаться сыграть/утилизировать карты — до tasks≤2 и util≤2
    // Сильно перемешаем пул разыгрываемых: рука currentPI + все revealed.
    let safety = 10;
    while (safety-- > 0) {
        if (st.tasksThisTurn >= 2 && st.utilizesThisTurn >= 2) break;

        const pool = [
            ...st.cp.hand,
            ...st.players.flatMap(p => p.revealed),
        ];
        if (pool.length === 0) break;

        // Случайный порядок
        const order = pickRandomSubset(pool, pool.length, rng);
        let didSomething = false;

        for (const card of order) {
            // Сначала пробуем розыгрыш если есть паттерн и лимит не исчерпан
            if (st.tasksThisTurn < 2) {
                const valids = tm.getValidPlacements(card);
                if (valids.length > 0) {
                    const pick = valids[Math.floor(rng() * valids.length)];
                    let result = null;
                    tm.playCard(card, pick, r => { result = r; });
                    if (result === 'ok' || result === 'gameOver') {
                        didSomething = true;
                        if (tm.isGameOver) return;
                        break;
                    }
                }
            }
            // Иначе — утилизация если в руке и лимит не исчерпан
            if (st.utilizesThisTurn < 2 && st.cp.hand.includes(card) && card.utilizeEffect?.hasEffects) {
                let result = null;
                tm.utilizeCard(card, r => { result = r; });
                if (result === 'ok' || result === 'gameOver') {
                    didSomething = true;
                    if (tm.isGameOver) return;
                    break;
                }
            }
        }
        if (!didSomething) break;
    }

    tm.endTurn();
}

// ── InputProvider (auto) ─────────────────────────────────────
function makeInput(rng) {
    const inp = {
        sourceCard: null,
        sourceMode: null,
        actionKind: null,
        actionCount: 0,
        actionTargetSelf: true,
        digStep: null,

        chooseCards(pi, pool, n, done) {
            // Случайный выбор n карт из pool
            const chosen = pickRandomSubset(pool, n, rng);
            // done — синхронный вызов (в эффектах execute)
            done(chosen);
        },
        chooseNodes(pi, empty, n, done) {
            const chosen = pickRandomSubset(empty, n, rng);
            done(chosen);
        },
        chooseStealSource(ap, ctx, done) {
            const { revealedPool, opponents } = ctx;
            // 50/50: если есть revealed, иногда берём открыто; иначе всегда blind.
            const useRevealed = revealedPool.length > 0 && (opponents.length === 0 || rng() < 0.5);
            if (useRevealed) {
                const pick = revealedPool[Math.floor(rng() * revealedPool.length)];
                done({ type: 'revealed', card: pick.card, ownerPI: pick.ownerPI });
            } else if (opponents.length > 0) {
                const pick = opponents[Math.floor(rng() * opponents.length)];
                done({ type: 'blind', ownerPI: pick.pi });
            } else {
                done(null);
            }
        },
    };
    return inp;
}

// ── Резолв отложенных эффектов противника (pendingActions) ───
// Вне UI-контекста: на старте своего хода игрок платит "долги" — случайный выбор.
function resolvePending(tm, rng) {
    const st = tm.state;
    const pl = st.cp;
    while (pl.pendingActions.length) {
        const action = pl.pendingActions.shift();
        const all = action.kind === 'discard' ? [...pl.hand, ...pl.revealed] : [...pl.hand];
        const cnt = Math.min(action.count, all.length);
        if (cnt <= 0) continue;
        const chosen = pickRandomSubset(all, cnt, rng);
        chosen.forEach(c => {
            let i = pl.hand.indexOf(c);
            if (i >= 0) pl.hand.splice(i, 1);
            else { i = pl.revealed.indexOf(c); if (i >= 0) pl.revealed.splice(i, 1); }
            if (action.kind === 'discard') st.discard.push(c);
            else if (action.kind === 'reveal') pl.revealed.push(c);
        });
    }
}

// ── Один матч ────────────────────────────────────────────────
function runOneGame(seed, cfg) {
    const rng = makeRng(seed);
    let result = null;

    withSeededRandom(rng, () => {
        const st  = new GameState(cfg.boardSize, cfg.winScore, cfg.playerCount, cfg.hardMode);
        const inp = makeInput(rng);
        const tm  = new TurnManager(st, inp);

        // Посчитать total cards для инварианта
        const totalCards = st.players.reduce((s, p) => s + p.hand.length, 0) + st.deck.cards.length + st.discard.length;
        const ctx = { totalCards };

        // Проверка старта
        checkInvariants(tm, ctx);

        let turns = 0;
        const cardPlays = {};   // name → count
        let synthAttempts = 0;
        let maxReserveHit = false;
        let emptyDeckReshuffle = 0;
        let prevDeckCount = st.deck.count;

        while (!tm.isGameOver && turns < MAX_TURNS) {
            // Ловим перетасовку сброса → колода
            const handsBefore = st.players.reduce((s, p) => s + p.hand.length, 0);
            const deckBefore = st.deck.count;
            const discardBefore = st.discard.length;

            playOneTurn(tm, rng);

            // После хода если колода выросла — был reshuffle
            if (st.deck.count > deckBefore && discardBefore > 0) emptyDeckReshuffle++;

            checkInvariants(tm, ctx);
            turns++;

            // Статистика разыгранных карт: в discard прибавились новые
            for (let i = discardBefore; i < st.discard.length; i++) {
                const name = st.discard[i].name;
                cardPlays[name] = (cardPlays[name] || 0) + 1;
            }

            if (st.players.some(p => p.chipsOnBoard === p.totalChips)) maxReserveHit = true;
        }

        result = {
            won: tm.isGameOver,
            winner: tm.winner,
            turns,
            scores: st.players.map(p => p.score),
            handCounts: st.players.map(p => p.hand.length),
            revealedCounts: st.players.map(p => p.revealed.length),
            deckLeft: st.deck.count,
            discardSize: st.discard.length,
            cardPlays,
            emptyDeckReshuffle,
            maxReserveHit,
            timedOut: !tm.isGameOver,
        };
    });

    return result;
}

// ── MAIN ─────────────────────────────────────────────────────
function main() {
    const cfg = cfgFor(MODE);
    console.log(`═══ КИБЕР FUZZ ═══`);
    console.log(`mode=${MODE} N=${N} seed0=${SEED0} cfg=${JSON.stringify(cfg)} maxTurns=${MAX_TURNS}`);
    const t0 = Date.now();

    const agg = {
        total: 0, won: 0, timedOut: 0, failed: 0,
        failures: [],
        winnerDist: {},           // pi → count
        turnHist: [],             // all turn counts
        cardPlaysTotal: {},       // name → total plays
        reshuffles: 0,
        maxReserveHits: 0,
    };

    for (let i = 0; i < N; i++) {
        const seed = SEED0 + i;
        try {
            const r = runOneGame(seed, cfg);
            agg.total++;
            if (r.won) {
                agg.won++;
                agg.winnerDist[r.winner] = (agg.winnerDist[r.winner] || 0) + 1;
            }
            if (r.timedOut) agg.timedOut++;
            agg.turnHist.push(r.turns);
            agg.reshuffles += r.emptyDeckReshuffle;
            if (r.maxReserveHit) agg.maxReserveHits++;
            for (const [k, v] of Object.entries(r.cardPlays)) {
                agg.cardPlaysTotal[k] = (agg.cardPlaysTotal[k] || 0) + v;
            }
            if (VERBOSE) console.log(`#${i} seed=${seed} turns=${r.turns} winner=${r.winner} scores=[${r.scores}]`);
        } catch (e) {
            agg.failed++;
            agg.failures.push({ seed, err: e.message, stack: e.stack?.split('\n').slice(0, 6).join('\n') });
            if (VERBOSE || agg.failures.length <= 3)
                console.log(`✗ seed=${seed}: ${e.message}`);
            if (STOP_ON_FAIL) break;
        }
    }

    const dt = (Date.now() - t0) / 1000;

    // Статистика
    agg.turnHist.sort((a, b) => a - b);
    const n = agg.turnHist.length;
    const avgTurns = n ? (agg.turnHist.reduce((s, x) => s + x, 0) / n).toFixed(1) : '-';
    const p50 = n ? agg.turnHist[Math.floor(n * 0.5)] : '-';
    const p95 = n ? agg.turnHist[Math.floor(n * 0.95)] : '-';
    const minT = n ? agg.turnHist[0] : '-';
    const maxT = n ? agg.turnHist[n - 1] : '-';

    console.log(`\n═══ РЕЗУЛЬТАТЫ ═══`);
    console.log(`Время: ${dt.toFixed(2)}s (${(agg.total / dt).toFixed(1)} матчей/сек)`);
    console.log(`Всего: ${agg.total}  Победы: ${agg.won} (${(agg.won/agg.total*100).toFixed(1)}%)  Тайм-аут: ${agg.timedOut}  Крашей: ${agg.failed}`);
    console.log(`Победитель: ${JSON.stringify(agg.winnerDist)}`);
    console.log(`Ходов (min/p50/avg/p95/max): ${minT} / ${p50} / ${avgTurns} / ${p95} / ${maxT}`);
    console.log(`Перетасовок сброса: ${agg.reshuffles}`);
    console.log(`Матчей с полным исчерпанием фишек: ${agg.maxReserveHits}`);

    // Coverage карт: сколько различных карт разыграно, и топ-20 + 10 самых редких
    const cardsSorted = Object.entries(agg.cardPlaysTotal).sort((a, b) => b[1] - a[1]);
    console.log(`\nРазличных карт сыграно: ${cardsSorted.length}`);
    if (cardsSorted.length) {
        console.log(`ТОП-5 по частоте: ${cardsSorted.slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        console.log(`РЕДКИЕ: ${cardsSorted.slice(-5).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    if (agg.failures.length) {
        console.log(`\n═══ CRASH'И (первые 5) ═══`);
        for (const f of agg.failures.slice(0, 5)) {
            console.log(`  seed=${f.seed}: ${f.err}`);
            if (VERBOSE) console.log(f.stack);
        }
    }

    process.exit(agg.failed > 0 ? 1 : 0);
}

main();
