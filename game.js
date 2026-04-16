// ═══════════════════════════════════════════════════════════
//  КИБЕР — Game Logic (ported from C# Unity project)
// ═══════════════════════════════════════════════════════════

// ── Enums ────────────────────────────────────────────────────
const Occ = { Empty: 0, P1: 1, P2: 2, P3: 3 };
const Phase = { Replenish: 'Replenish', Action: 'Action', Task: 'Task' };
const CellType = { W: 'W', G: 'G' };
const Target = { Self: 'Self', Opp: 'Opp' };

// ── Helpers ──────────────────────────────────────────────────
const W = (r, c) => ({ row: r, col: c, type: CellType.W });
const G = (r, c) => ({ row: r, col: c, type: CellType.G });
const E = (...fx) => new CardEffect(fx);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ── PlayerState ───────────────────────────────────────────────
class PlayerState {
    constructor(idx) {
        this.idx = idx;
        this.hand = [];
        this.revealed = [];
        this.supply = 3;
        this.score = 0;
        this.totalChips = 8;
        this.chipsOnBoard = 0;
    }
    get reserve() { return this.totalChips - this.chipsOnBoard; }
}

// ── BoardState ────────────────────────────────────────────────
class BoardState {
    constructor(size = 4) {
        this.size = size;
        this.nodes = Array.from({ length: size }, () => new Array(size).fill(Occ.Empty));
    }
    isEmpty(r, c) { return this.nodes[r][c] === Occ.Empty; }
    occOf(pi) { return pi + 1; }                               // P1=1, P2=2, P3=3
    isOpp(pi, occ) { return occ !== Occ.Empty && occ !== this.occOf(pi); }
    emptyNodes() {
        const r = [];
        for (let row = 0; row < this.size; row++)
            for (let col = 0; col < this.size; col++)
                if (this.nodes[row][col] === Occ.Empty) r.push([row, col]);
        return r;
    }
}

// ── GameState ─────────────────────────────────────────────────
class GameState {
    constructor(boardSize = 4, winScore = 15, playerCount = 2) {
        this.board = new BoardState(boardSize);
        this.playerCount = playerCount;
        this.players = Array.from({ length: playerCount }, (_, i) => new PlayerState(i));
        this.discard = [];
        this.currentPI = 0;
        this.phase = Phase.Replenish;
        this.winScore = winScore;
        this.chipsPlaced = 0;
        this.chipsAllowed = 2;
        this.tasksThisTurn = 0;
        this.utilizesThisTurn = 0;
        this.mainActionDone = false;
        const cards = CardDatabase.create3();
        this.deck = new Deck(cards, this.discard);
    }
    get cp() { return this.players[this.currentPI]; }
    get opp() { return this.players[(this.currentPI + 1) % this.playerCount]; }
}

// ── Deck ──────────────────────────────────────────────────────
class Deck {
    constructor(cards, discard) {
        this.cards = shuffle([...cards]);
        this.discard = discard;
    }
    get count() { return this.cards.length; }
    draw(n) {
        const out = [];
        for (let i = 0; i < n; i++) {
            if (this.cards.length === 0) {
                if (this.discard.length === 0) break;
                this.cards = shuffle([...this.discard]);
                this.discard.length = 0;
            }
            out.push(this.cards.pop());
        }
        return out;
    }
}

// ═══════════════════════════════════════════════════════════
//  EFFECTS
// ═══════════════════════════════════════════════════════════

class DrawCardsEffect {
    constructor(n) { this.n = n; }
    execute(st, ap, inp, done) {
        st.players[ap].hand.push(...st.deck.draw(this.n));
        done?.();
    }
}

class DigCardsEffect {
    constructor(n) { this.n = n; }
    execute(st, ap, inp, done) {
        const drawn = st.deck.draw(this.n + 2);
        if (drawn.length <= this.n) { st.players[ap].hand.push(...drawn); done?.(); return; }
        inp.chooseCards(ap, drawn, this.n, chosen => {
            st.players[ap].hand.push(...chosen);
            drawn.filter(c => !chosen.includes(c)).forEach(c => st.discard.push(c));
            done?.();
        });
    }
}

class PlaceChipsEffect {
    constructor(n) { this.n = n; }
    execute(st, ap, inp, done) {
        const pl = st.players[ap];
        const canPlace = Math.min(this.n, pl.reserve);
        if (canPlace <= 0) { done?.(); return; }
        const empty = st.board.emptyNodes();
        const toPlace = Math.min(canPlace, empty.length);
        if (toPlace <= 0) { done?.(); return; }
        inp.chooseNodes(ap, empty, toPlace, chosen => {
            const occ = st.board.occOf(ap);
            chosen.forEach(([r, c]) => { st.board.nodes[r][c] = occ; pl.chipsOnBoard++; });
            done?.();
        });
    }
}

class RevealCardsEffect {
    constructor(n, target) { this.n = n; this.target = target; }
    execute(st, ap, inp, done) {
        const ti = this.target === Target.Self ? ap : (ap + 1) % st.players.length;
        const tp = st.players[ti];
        const toReveal = this.n === Infinity ? tp.hand.length : Math.min(this.n, tp.hand.length);
        if (toReveal <= 0) { done?.(); return; }
        inp.chooseCards(ti, [...tp.hand], toReveal, chosen => {
            chosen.forEach(c => {
                const i = tp.hand.indexOf(c);
                if (i >= 0) tp.hand.splice(i, 1);
                tp.revealed.push(c);
            });
            done?.();
        });
    }
}

class DiscardCardsEffect {
    constructor(n, target) { this.n = n; this.target = target; }
    execute(st, ap, inp, done) {
        const ti = this.target === Target.Self ? ap : (ap + 1) % st.players.length;
        const tp = st.players[ti];
        const all = [...tp.hand, ...tp.revealed];
        const toDiscard = this.n === Infinity ? all.length : Math.min(this.n, all.length);
        if (toDiscard <= 0) { done?.(); return; }
        inp.chooseCards(ti, all, toDiscard, chosen => {
            chosen.forEach(c => {
                let i = tp.hand.indexOf(c);
                if (i >= 0) tp.hand.splice(i, 1);
                else { i = tp.revealed.indexOf(c); if (i >= 0) tp.revealed.splice(i, 1); }
                st.discard.push(c);
            });
            done?.();
        });
    }
}

class StealCardsEffect {
    constructor(n) { this.n = n; }
    execute(st, ap, inp, done) {
        const opp = st.players[(ap + 1) % st.players.length], actor = st.players[ap];
        const toSteal = Math.min(this.n, opp.hand.length);
        for (let i = 0; i < toSteal; i++) {
            const idx = Math.floor(Math.random() * opp.hand.length);
            actor.hand.push(opp.hand.splice(idx, 1)[0]);
        }
        done?.();
    }
}

class ModifySupplyEffect {
    constructor(delta, target) { this.delta = delta; this.target = target; }
    execute(st, ap, inp, done) {
        const ti = this.target === Target.Self ? ap : (ap + 1) % st.players.length;
        st.players[ti].supply = clamp(st.players[ti].supply + this.delta, 2, 6);
        done?.();
    }
}

class SetSupplyEffect {
    constructor(val, target) { this.val = val; this.target = target; }
    execute(st, ap, inp, done) {
        const ti = this.target === Target.Self ? ap : (ap + 1) % st.players.length;
        st.players[ti].supply = clamp(this.val, 2, 6);
        done?.();
    }
}

class CopyOpponentSupplyEffect {
    execute(st, ap, inp, done) {
        st.players[ap].supply = clamp(st.players[(ap + 1) % st.players.length].supply, 2, 6);
        done?.();
    }
}

class ResetFieldEffect {
    execute(st, ap, inp, done) {
        for (let r = 0; r < st.board.size; r++)
            for (let c = 0; c < st.board.size; c++) {
                const occ = st.board.nodes[r][c];
                if (occ !== Occ.Empty) st.players[occ - 1].chipsOnBoard--;
                st.board.nodes[r][c] = Occ.Empty;
            }
        done?.();
    }
}

class CardEffect {
    constructor(effects = []) { this.effects = effects; }
    execute(st, ap, inp, done) { this._chain(0, st, ap, inp, done); }
    _chain(i, st, ap, inp, done) {
        if (i >= this.effects.length) { done?.(); return; }
        this.effects[i].execute(st, ap, inp, () => this._chain(i + 1, st, ap, inp, done));
    }
    get hasEffects() { return this.effects.length > 0; }
    static get None() { return new CardEffect([]); }
}

// ── Shorthand builders ────────────────────────────────────────
const Dig = n => new DigCardsEffect(n);
const Draw = n => new DrawCardsEffect(n);
const Place = n => new PlaceChipsEffect(n);
const Reveal = (n, t) => new RevealCardsEffect(n, t);
const RevealAll = t => new RevealCardsEffect(Infinity, t);
const Discard = (n, t) => new DiscardCardsEffect(n, t);
const DiscardAll = t => new DiscardCardsEffect(Infinity, t);
const Steal = n => new StealCardsEffect(n);
const Supply = (d, t) => new ModifySupplyEffect(d, t);
const SetSup = (v, t) => new SetSupplyEffect(v, t);
const CopySup = () => new CopyOpponentSupplyEffect();
const Reset = () => new ResetFieldEffect();

// ═══════════════════════════════════════════════════════════
//  PATTERN MATCHER
// ═══════════════════════════════════════════════════════════

class PatternMatcher {
    // Rotate 90° clockwise in 3×3 grid: (r,c) → (c, 2-r)
    static _rotate90(cells) {
        return cells.map(({ row, col, type }) => ({ row: col, col: 2 - row, type }));
    }

    // All unique rotations (0/90/180/270°) of the pattern
    static _getRotations(pattern) {
        const rotations = [];
        const seen = new Set();
        let cur = pattern;
        for (let i = 0; i < 4; i++) {
            const key = [...cur].sort((a, b) => a.row * 10 + a.col - (b.row * 10 + b.col))
                .map(c => `${c.row}${c.col}${c.type}`).join('|');
            if (!seen.has(key)) { seen.add(key); rotations.push(cur); }
            cur = PatternMatcher._rotate90(cur);
        }
        return rotations;
    }

    static findMatches(pattern, board, ap) {
        if (!pattern || pattern.length === 0) return [];
        const results = [];
        const seenPos = new Set();

        for (const rot of PatternMatcher._getRotations(pattern)) {
            let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
            for (const cell of rot) {
                minR = Math.min(minR, cell.row); maxR = Math.max(maxR, cell.row);
                minC = Math.min(minC, cell.col); maxC = Math.max(maxC, cell.col);
            }
            const drMin = -minR, drMax = board.size - 1 - maxR;
            const dcMin = -minC, dcMax = board.size - 1 - maxC;
            for (let dr = drMin; dr <= drMax; dr++)
                for (let dc = dcMin; dc <= dcMax; dc++) {
                    const p = PatternMatcher._tryPlace(rot, board, ap, dr, dc);
                    if (p) {
                        // Deduplicate by set of chip positions
                        const key = [...p.chipPositions].sort().map(([r, c]) => `${r},${c}`).join('|');
                        if (!seenPos.has(key)) { seenPos.add(key); results.push(p); }
                    }
                }
        }
        return results;
    }

    static _tryPlace(pattern, board, ap, dr, dc) {
        const selfOcc = board.occOf(ap);
        const positions = [];
        for (const cell of pattern) {
            const r = cell.row + dr, c = cell.col + dc;
            const occ = board.nodes[r][c];
            if (cell.type === CellType.W) { if (occ !== selfOcc) return null; }          // W = своя фишка
            else                          { if (!board.isOpp(ap, occ)) return null; }    // G = любая чужая фишка
            positions.push([r, c]);
        }
        return { chipPositions: positions };
    }
}

// ═══════════════════════════════════════════════════════════
//  TURN MANAGER
// ═══════════════════════════════════════════════════════════

class TurnManager {
    constructor(state, input) {
        this.state = state;
        this.input = input;
        this.isGameOver = false;
        this.winner = -1;
        this.onPhaseChanged = null;  // fn(phase)
        this.onStateChanged = null;  // fn(state)
        this.onGameOver = null;      // fn(winner)
    }

    // Восполнение
    replenish() {
        if (this.state.phase !== Phase.Replenish) return false;
        const pl = this.state.cp;
        const toDraw = Math.max(0, pl.supply - pl.hand.length);
        pl.hand.push(...this.state.deck.draw(toDraw));
        this._toAction();
        return true;
    }

    // Действия
    placeChip(r, c) {
        const st = this.state;
        if (st.phase !== Phase.Action) return 'invalidPhase';
        if (!st.board.isEmpty(r, c)) return 'invalidAction';
        if (st.chipsPlaced >= st.chipsAllowed) return 'invalidAction';
        if (st.cp.reserve <= 0) return 'invalidAction';
        st.board.nodes[r][c] = st.board.occOf(st.currentPI);
        st.cp.chipsOnBoard++;
        st.chipsPlaced++;
        st.placedThisTurn.push([r, c]);
        this._notify();
        return 'ok';
    }

    // Вернуть свою фишку с доски (вместо размещения 2-х)
    returnPiece(r, c) {
        const st = this.state;
        if (st.phase !== Phase.Action) return 'invalidPhase';
        if (st.chipsPlaced > 0) return 'invalidAction';  // уже начал ставить фишки
        if (st.board.nodes[r][c] !== st.board.occOf(st.currentPI)) return 'invalidAction';
        st.board.nodes[r][c] = Occ.Empty;
        st.cp.chipsOnBoard--;
        st.mainActionDone = true;
        this._notify();
        this._toTask();
        return 'ok';
    }

    endAction() {
        if (this.state.phase !== Phase.Action) return false;
        this.state.mainActionDone = true;
        this._toTask();
        return true;
    }

    endTurn() {
        if (this.state.phase !== Phase.Task) return false;
        this._endTurn();
        return true;
    }

    // Розыгрыш карты (не завершает ход — игрок может сыграть до 2 карт + 2 утилизации)
    playCard(card, placement, onDone) {
        const st = this.state;
        if (this.isGameOver) { onDone?.('gameOver'); return; }
        if (st.phase !== Phase.Task) { onDone?.('invalidPhase'); return; }
        if (st.tasksThisTurn >= 2) { onDone?.('limitReached'); return; }

        const pl = st.cp;
        const owned = pl.hand.includes(card) || st.players.some(p => p.revealed.includes(card));
        if (!owned) { onDone?.('invalidAction'); return; }

        const validPlacements = PatternMatcher.findMatches(card.pattern, st.board, st.currentPI);
        if (!this._isPlacementValid(placement, validPlacements)) { onDone?.('invalidAction'); return; }

        // Правила: +очки → эффект → фишки снимаются → карта в сброс
        pl.score += card.cost;

        card.playEffect.execute(st, st.currentPI, this.input, () => {
            // Снимаем фишки после выполнения эффекта
            for (const [r, c] of placement.chipPositions) {
                const occ = st.board.nodes[r][c];
                if (occ !== Occ.Empty) st.players[occ - 1].chipsOnBoard--;
                st.board.nodes[r][c] = Occ.Empty;
            }
            this._removeCardFromOwner(card);
            st.discard.push(card);
            st.tasksThisTurn++;
            this._notify();
            if (this._checkWin()) { onDone?.('gameOver'); return; }
            onDone?.('ok');
        });
    }

    // Утилизация (не завершает ход)
    utilizeCard(card, onDone) {
        const st = this.state;
        if (this.isGameOver) { onDone?.('gameOver'); return; }
        if (st.phase !== Phase.Task) { onDone?.('invalidPhase'); return; }
        if (st.utilizesThisTurn >= 2) { onDone?.('limitReached'); return; }

        const pl = st.cp;
        if (!pl.hand.includes(card) && !pl.revealed.includes(card)) { onDone?.('invalidAction'); return; }

        card.utilizeEffect.execute(st, st.currentPI, this.input, () => {
            this._removeCardFromOwner(card);
            st.discard.push(card);
            st.utilizesThisTurn++;
            this._notify();
            if (this._checkWin()) { onDone?.('gameOver'); return; }
            onDone?.('ok');
        });
    }

    // Синтез — два паттерна одновременно, хотя бы одна общая фишка
    synthesis(cardA, cardB, matchA, matchB, orderAFirst, onDone) {
        const st = this.state;
        if (this.isGameOver) { onDone?.('gameOver'); return; }
        if (st.phase !== Phase.Task) { onDone?.('invalidPhase'); return; }
        if (st.tasksThisTurn >= 2) { onDone?.('limitReached'); return; }
        if (cardA === cardB) { onDone?.('invalidAction'); return; }

        const pl = st.cp;
        const ownedA = pl.hand.includes(cardA) || st.players.some(p => p.revealed.includes(cardA));
        const ownedB = pl.hand.includes(cardB) || st.players.some(p => p.revealed.includes(cardB));
        if (!ownedA || !ownedB) { onDone?.('invalidAction'); return; }

        const validsA = PatternMatcher.findMatches(cardA.pattern, st.board, st.currentPI);
        const validsB = PatternMatcher.findMatches(cardB.pattern, st.board, st.currentPI);
        if (!this._isPlacementValid(matchA, validsA)) { onDone?.('invalidAction'); return; }
        if (!this._isPlacementValid(matchB, validsB)) { onDone?.('invalidAction'); return; }

        // Проверяем хотя бы одну общую позицию
        const posSetA = new Set(matchA.chipPositions.map(([r, c]) => `${r},${c}`));
        const hasShared = matchB.chipPositions.some(([r, c]) => posSetA.has(`${r},${c}`));
        if (!hasShared) { onDone?.('invalidAction'); return; }

        // Очки за обе карты
        pl.score += cardA.cost + cardB.cost;

        const [first, second] = orderAFirst ? [cardA, cardB] : [cardB, cardA];

        // Эффекты синтеза: playEffect + synthesisEffect каждой карты
        const fxFirst  = new CardEffect([...first.playEffect.effects, ...first.synthesisEffect.effects]);
        const fxSecond = new CardEffect([...second.playEffect.effects, ...second.synthesisEffect.effects]);

        const finalize = () => {
            // Снимаем объединение фишек в конце
            const seen = new Set();
            for (const [r, c] of [...matchA.chipPositions, ...matchB.chipPositions]) {
                const key = `${r},${c}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const occ = st.board.nodes[r][c];
                if (occ !== Occ.Empty) st.players[occ - 1].chipsOnBoard--;
                st.board.nodes[r][c] = Occ.Empty;
            }
            this._removeCardFromOwner(cardA);
            this._removeCardFromOwner(cardB);
            st.discard.push(cardA, cardB);
            st.tasksThisTurn++;
            this._notify();
            if (this._checkWin()) { onDone?.('gameOver'); return; }
            onDone?.('ok');
        };

        fxFirst.execute(st, st.currentPI, this.input, () => {
            fxSecond.execute(st, st.currentPI, this.input, finalize);
        });
    }

    getValidPlacements(card) {
        return PatternMatcher.findMatches(card.pattern, this.state.board, this.state.currentPI);
    }

    // ── Internals ──
    undoChip(r, c) {
        const st = this.state;
        if (st.phase !== Phase.Action) return 'invalidPhase';
        const idx = st.placedThisTurn?.findIndex(([pr, pc]) => pr === r && pc === c);
        if (idx < 0) return 'invalidAction';
        st.placedThisTurn.splice(idx, 1);
        st.board.nodes[r][c] = Occ.Empty;
        st.cp.chipsOnBoard--;
        st.chipsPlaced--;
        this._notify();
        return 'ok';
    }

    _toAction() {
        const st = this.state;
        st.phase = Phase.Action;
        st.chipsPlaced = 0;
        st.chipsAllowed = 2;
        st.placedThisTurn = [];
        st.tasksThisTurn = 0;
        st.utilizesThisTurn = 0;
        st.mainActionDone = false;
        this.onPhaseChanged?.(Phase.Action);
        this._notify();
    }
    _toTask() {
        this.state.phase = Phase.Task;
        this.onPhaseChanged?.(Phase.Task);
        this._notify();
    }
    _endTurn() {
        const st = this.state;
        st.currentPI = (st.currentPI + 1) % st.playerCount;
        st.phase = Phase.Replenish;
        this.onPhaseChanged?.(Phase.Replenish);
        this._notify();
    }
    _notify() { this.onStateChanged?.(this.state); }
    _checkWin() {
        for (let i = 0; i < this.state.players.length; i++) {
            if (this.state.players[i].score >= this.state.winScore) {
                this.isGameOver = true;
                this.winner = i;
                this.onGameOver?.(i);
                return true;
            }
        }
        return false;
    }
    _removeCardFromOwner(card) {
        const pl = this.state.cp;
        let i = pl.hand.indexOf(card); if (i >= 0) { pl.hand.splice(i, 1); return; }
        for (const p of this.state.players) {
            i = p.revealed.indexOf(card); if (i >= 0) { p.revealed.splice(i, 1); return; }
        }
    }
    _isPlacementValid(target, valids) {
        if (!target || !valids) return false;
        return valids.some(p =>
            p.chipPositions.length === target.chipPositions.length &&
            p.chipPositions.every(([r, c], i) => r === target.chipPositions[i][0] && c === target.chipPositions[i][1])
        );
    }
}

// ═══════════════════════════════════════════════════════════
//  CARD DATABASE  (53 карты)
// ═══════════════════════════════════════════════════════════

class CardDatabase {
    static create() {
        const cards = [];
        let id = 1;
        const add = (copies, name, cost, pattern, play, utilize, synthesis) => {
            for (let i = 0; i < copies; i++) cards.push({
                id: id++, name, cost, pattern: pattern || [],
                playEffect: play || CardEffect.None,
                utilizeEffect: utilize || CardEffect.None,
                synthesisEffect: synthesis || CardEffect.None,
            });
        };

        // ── СТОИМОСТЬ 0 ──
        add(2, 'БАЙТ',               0, [W(1,1)], E(Dig(1)));
        add(2, 'БИТЫЙ ПИКСЕЛЬ',      0, [G(1,1)]);
        add(2, 'МИГРАЦИЯ',           0, [W(1,1)], E(Place(1)));
        add(1, 'ОБРАТНАЯ СВЯЗЬ',     0, [G(0,2),W(2,0)], E(Draw(1)));
        add(1, 'УЯЗВИМОСТЬ',         0, [W(1,0),G(1,2),G(2,1)], E(Steal(1)));
        add(1, 'ИНКАПСУЛЯЦИЯ',       0, [G(0,1),G(1,0),G(1,1),G(1,2)], E(Dig(1)));
        add(1, 'ШИФРОВАНИЕ',         0, [W(0,1),G(1,0),G(1,2),W(2,1)], E(Supply(+1,Target.Self)));
        add(1, 'БУФЕРИЗАЦИЯ',        0, [W(0,1),G(1,0),G(1,2),W(2,1)], null, null, E(Place(1)));
        add(1, 'БЭКДОР',             0, [G(0,1),W(2,0),W(2,2)], E(Supply(-1,Target.Opp)));
        add(1, 'ПЕРЕХВАТ ПОТОКА',    0, [W(1,0),G(0,2)], E(Reveal(1,Target.Opp)), E(Reveal(1,Target.Self)));
        add(1, 'ТЕРНАРНЫЙ ОПЕРАТОР', 0, [W(0,1),W(1,0),W(1,2),W(2,1)], E(Discard(3,Target.Opp)), E(Discard(2,Target.Self)));

        // ── СТОИМОСТЬ 1 ──
        add(2, 'БИТ',                1, [W(1,1)], null, E(Place(1)));
        add(1, 'ДУБЛИРОВАНИЕ',       1, [W(1,0),W(1,2)], E(Place(1)));
        add(1, 'БРУТФОРС',           1, [G(0,2),W(2,0),W(2,1),W(2,2)], E(Reveal(1,Target.Opp),Draw(2)));
        add(1, 'НАПРАВЛЕННЫЙ ПОТОК', 1, [W(2,0),W(1,1),W(0,2)], E(Reveal(3,Target.Opp)), E(Reveal(1,Target.Self)));
        add(1, 'БИНАРНЫЙ ОПЕРАТОР',  1, [W(0,2),W(1,0),W(1,2),W(2,1)], E(Supply(+1,Target.Self)));
        add(1, 'СОРТИРОВКА',         1, [W(0,0),W(1,1),W(2,1),W(2,2)], E(Dig(2),Supply(+1,Target.Self)));
        add(1, 'ОБНОВЛЕНИЕ',         1, [W(0,2),W(1,1),W(2,0)], E(SetSup(4,Target.Self)));
        add(1, 'СИНХРОНИЗАЦИЯ',      1, [G(0,1),W(1,0),W(1,2),G(2,1)], E(CopySup()));
        add(1, 'ИНЪЕКЦИЯ КОДА',      1, [W(0,0),W(1,1),G(2,2)], E(Reveal(1,Target.Opp),Steal(1)));
        add(1, 'ПРОКСИ',             1, [W(0,0),G(0,1),G(1,1),W(1,2)], E(Place(1),Reveal(1,Target.Self),Discard(1,Target.Opp)));
        add(1, 'ЗАМЫКАНИЕ',          1, [W(1,0),W(1,1),W(1,2),W(2,2)], E(Supply(-1,Target.Opp)));
        add(1, 'РЕКУРСИЯ',           1, [G(1,0),G(1,1),G(1,2),W(2,0),W(2,2)], E(Steal(1)));

        // ── СТОИМОСТЬ 2 ──
        add(2, 'ЗАЦИКЛИВАНИЕ',       2, [W(1,1)], E(Discard(1,Target.Self)));
        add(1, 'БИНАРНЫЕ ПОТОКИ',    2, [W(0,1),W(1,2)]);
        add(1, 'ПЕРЕЗАГРУЗКА',       2, [W(0,1),W(2,0),W(2,2)], E(Reset(),Place(1)));
        add(1, 'СИНЕРГИЯ',           2, [G(0,0),W(0,2),W(2,0),G(2,2)], E(Supply(+1,Target.Opp),Supply(+1,Target.Self)));
        add(1, 'ЛОЖНЫЕ ДАННЫЕ',      2, [W(0,0),W(2,0),G(1,2)], E(Reveal(2,Target.Self),Draw(2)));
        add(1, 'БРАНДМАУЭР',         2, [W(0,1),W(1,1),W(2,2)], E(Place(2)));
        add(1, 'ИТЕРАЦИЯ',           2, [W(0,1),W(1,0),W(1,2),W(2,1)], E(Place(4)));
        add(1, 'АСИНХРОННОСТЬ',      2, [G(0,0),W(0,2),W(2,0),G(2,2)], E(Reveal(2,Target.Opp),Reveal(2,Target.Self)));
        add(1, 'ФОРК',               2, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Place(2),Draw(2)));
        add(1, 'ИНТЕРФЕЙС',          2, [W(0,2),W(1,0),W(1,1),W(1,2),W(2,1)], E(Reveal(2,Target.Self),Place(4),Discard(1,Target.Opp)));

        // ── СТОИМОСТЬ 3 ──
        add(1, 'ПЕРЕГРУЗКА',         3, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Draw(3)));
        add(1, 'РЕЗЕРВ',             3, [W(0,1),W(1,0),W(1,1),W(1,2),W(2,1)], E(Discard(1,Target.Opp)), E(Discard(2,Target.Self),Draw(2)));
        add(1, 'РЕФАКТОРИНГ',        3, [W(0,0),W(0,2),W(1,1),W(2,0),W(2,2)], E(Steal(2),Place(3)), E(Reveal(1,Target.Self)));
        add(1, 'СОКЕТ',              3, [W(0,1),W(0,2),W(1,0),W(1,1)], E(Draw(3)));
        add(1, 'ФРАГМЕНТАЦИЯ',       3, [W(0,0),G(0,2),W(1,1),W(2,0)], E(Dig(1)));
        add(1, 'ЧЕРВЬ СЕТИ',         3, [W(0,0),W(1,0),W(2,0),W(2,1)], E(DiscardAll(Target.Opp)), E(DiscardAll(Target.Self)));

        // ── СТОИМОСТЬ 4 ──
        add(1, 'ПАРАЛЛЕЛЬНЫЕ ПОТОКИ',4, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Reveal(2,Target.Self),Draw(2)));
        add(1, 'КЭШИРОВАНИЕ',        4, [W(0,0),W(0,2),W(1,0),W(1,1),W(1,2)], E(Draw(3),Discard(1,Target.Opp)));
        add(1, 'РЕПЛИКАЦИЯ',         4, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Draw(3),RevealAll(Target.Self)));
        add(1, 'ДЕФРАГМЕНТАЦИЯ',     4, [W(0,0),W(0,2),W(2,0),W(2,2)], E(DiscardAll(Target.Self),Draw(4)));
        add(1, 'ЭНТРОПИЯ',           4, [W(0,2),G(1,0),G(1,2),W(2,0)], E(Supply(-1,Target.Self)));
        add(1, 'ТУННЕЛИРОВАНИЕ',     4, [W(0,0),W(0,1),W(1,0),W(2,0)], null, null, E(Supply(+1,Target.Self)));

        // ── СТОИМОСТЬ -1 ──
        add(1, 'ПЕРЕНАПРАВЛЕНИЕ',   -1, [G(0,0),G(0,2),W(2,0),W(2,2)], null, E(Place(1)));
        add(1, 'КЛЮЧ БЕЗОПАСНОСТИ', -1, [W(0,1),G(2,1)], E(Reveal(1,Target.Opp)), null, E(Reset()));
        add(1, 'ПРЕРЫВАНИЕ',        -1, [G(1,0),G(1,1),G(1,2)], null, null, E(Supply(-1,Target.Opp)));

        return cards;
    }

    // ── 3-PLAYER DECK (54 карты: те же 53 + УСИЛЕНИЕ ЯДРА; часть паттернов изменена) ──
    static create3() {
        const cards = [];
        let id = 1001;
        const add = (copies, name, cost, pattern, play, utilize, synthesis) => {
            for (let i = 0; i < copies; i++) cards.push({
                id: id++, name, cost, pattern: pattern || [],
                playEffect: play || CardEffect.None,
                utilizeEffect: utilize || CardEffect.None,
                synthesisEffect: synthesis || CardEffect.None,
            });
        };

        // ── СТОИМОСТЬ 0 ──
        add(2, 'БАЙТ',               0, [W(1,1)], E(Dig(1)));
        add(2, 'БИТЫЙ ПИКСЕЛЬ',      0, [G(1,1)]);
        add(2, 'МИГРАЦИЯ',           0, [W(1,1)], E(Place(1)));
        add(1, 'ОБРАТНАЯ СВЯЗЬ',     0, [G(0,2),W(2,0)], E(Draw(1)));
        add(1, 'УЯЗВИМОСТЬ',         0, [W(1,0),G(1,2),G(2,1)], E(Steal(1)));
        add(1, 'ИНКАПСУЛЯЦИЯ',       0, [G(0,1),G(1,0),G(1,1),G(1,2)], E(Dig(1)));
        add(1, 'ШИФРОВАНИЕ',         0, [W(0,1),G(1,0),G(1,2),W(2,1)], E(Supply(+1,Target.Self)));
        add(1, 'БУФЕРИЗАЦИЯ',        0, [W(0,1),G(1,0),G(1,2),W(2,1)], null, null, E(Place(1)));
        add(1, 'БЭКДОР',             0, [G(0,1),W(2,0),W(2,2)], E(Supply(-1,Target.Opp)));
        add(1, 'ПЕРЕХВАТ ПОТОКА',    0, [W(1,0),G(0,2)], E(Reveal(1,Target.Opp)), E(Reveal(1,Target.Self)));
        add(1, 'ТЕРНАРНЫЙ ОПЕРАТОР', 0, [W(0,1),W(1,0),W(1,2),W(2,1)], E(Discard(3,Target.Opp)), E(Discard(2,Target.Self)));

        // ── СТОИМОСТЬ 1 ──
        add(2, 'БИТ',                1, [W(1,1)], null, E(Place(1)));
        add(1, 'ДУБЛИРОВАНИЕ',       1, [W(1,0),W(1,2)], E(Place(1)));
        add(1, 'БРУТФОРС',           1, [G(0,2),W(2,0),W(2,1),W(2,2)], E(Reveal(1,Target.Opp),Draw(2)));
        add(1, 'НАПРАВЛЕННЫЙ ПОТОК', 1, [W(2,0),W(1,1),W(0,2)], E(Reveal(3,Target.Opp)), E(Reveal(1,Target.Self)));
        add(1, 'БИНАРНЫЙ ОПЕРАТОР',  1, [W(0,2),W(1,0),W(1,2),W(2,1)], E(Supply(+1,Target.Self)));
        add(1, 'СОРТИРОВКА',         1, [W(0,0),W(1,1),W(2,1),W(2,2)], E(Dig(2),Supply(+1,Target.Self)));
        add(1, 'ОБНОВЛЕНИЕ',         1, [W(0,2),W(1,1),W(2,0)], E(SetSup(4,Target.Self)));
        add(1, 'СИНХРОНИЗАЦИЯ',      1, [G(0,1),W(1,0),W(1,2),G(2,1)], E(CopySup()));
        add(1, 'ИНЪЕКЦИЯ КОДА',      1, [W(0,0),W(1,1),G(2,2)], E(Reveal(1,Target.Opp),Steal(1)));
        add(1, 'ПРОКСИ',             1, [W(0,0),G(0,1),G(1,1),W(1,2)], E(Place(1),Reveal(1,Target.Self),Discard(1,Target.Opp)));
        // Паттерн изменён: ML:W MC:W MR:G (вместо 2p: ML:W MC:W MR:W BR:W)
        add(1, 'ЗАМЫКАНИЕ',          1, [W(1,0),W(1,1),G(1,2)], E(Supply(-1,Target.Opp)));
        add(1, 'РЕКУРСИЯ',           1, [G(1,0),G(1,1),G(1,2),W(2,0),W(2,2)], E(Steal(1)));

        // ── СТОИМОСТЬ 2 ──
        add(2, 'ЗАЦИКЛИВАНИЕ',       2, [W(1,1)], E(Discard(1,Target.Self)));
        add(1, 'БИНАРНЫЕ ПОТОКИ',    2, [W(0,1),W(1,2)]);
        add(1, 'ПЕРЕЗАГРУЗКА',       2, [W(0,1),W(2,0),W(2,2)], E(Reset(),Place(1)));
        add(1, 'СИНЕРГИЯ',           2, [G(0,0),W(0,2),W(2,0),G(2,2)], E(Supply(+1,Target.Opp),Supply(+1,Target.Self)));
        add(1, 'ЛОЖНЫЕ ДАННЫЕ',      2, [W(0,0),W(2,0),G(1,2)], E(Reveal(2,Target.Self),Draw(2)));
        add(1, 'БРАНДМАУЭР',         2, [W(0,1),W(1,1),W(2,2)], E(Place(2)));
        add(1, 'ИТЕРАЦИЯ',           2, [W(0,1),W(1,0),W(1,2),W(2,1)], E(Place(4)));
        // Паттерн изменён: TL:G TR:G BL:W BR:W (вместо 2p: TL:G TR:W BL:W BR:G)
        add(1, 'АСИНХРОННОСТЬ',      2, [G(0,0),G(0,2),W(2,0),W(2,2)], E(Reveal(2,Target.Opp),Reveal(2,Target.Self)));
        add(1, 'ФОРК',               2, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Place(2),Draw(2)));
        add(1, 'ИНТЕРФЕЙС',          2, [W(0,2),W(1,0),W(1,1),W(1,2),W(2,1)], E(Reveal(2,Target.Self),Place(4),Discard(1,Target.Opp)));

        // ── СТОИМОСТЬ 3 ──
        add(1, 'ПЕРЕГРУЗКА',         3, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Draw(3)));
        // Паттерн изменён: 4 клетки без центра (вместо 2p: 5 клеток с центром)
        add(1, 'РЕЗЕРВ',             3, [W(0,1),W(1,0),W(1,2),W(2,1)], E(Discard(1,Target.Opp)), E(Discard(2,Target.Self),Draw(2)));
        add(1, 'УСИЛЕНИЕ ЯДРА',      3, [W(0,1),W(1,0),W(1,1),W(1,2),W(2,1)], E(Supply(+2,Target.Self)));  // НОВАЯ
        add(1, 'РЕФАКТОРИНГ',        3, [W(0,0),W(0,2),W(1,1),W(2,0),W(2,2)], E(Steal(2),Place(3)), E(Reveal(1,Target.Self)));
        add(1, 'СОКЕТ',              3, [W(0,1),W(0,2),W(1,0),W(1,1)], E(Draw(3)));
        add(1, 'ФРАГМЕНТАЦИЯ',       3, [W(0,0),G(0,2),W(1,1),W(2,0)], E(Dig(1)));
        add(1, 'ЧЕРВЬ СЕТИ',         3, [W(0,0),W(1,0),W(2,0),W(2,1)], E(DiscardAll(Target.Opp)), E(DiscardAll(Target.Self)));

        // ── СТОИМОСТЬ 4 ──
        add(1, 'ПАРАЛЛЕЛЬНЫЕ ПОТОКИ',4, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Reveal(2,Target.Self),Draw(2)));
        add(1, 'КЭШИРОВАНИЕ',        4, [W(0,0),W(0,2),W(1,0),W(1,1),W(1,2)], E(Draw(3),Discard(1,Target.Opp)));
        add(1, 'РЕПЛИКАЦИЯ',         4, [W(0,0),W(0,2),W(2,0),W(2,2)], E(Draw(3),RevealAll(Target.Self)));
        add(1, 'ДЕФРАГМЕНТАЦИЯ',     4, [W(0,0),W(0,2),W(2,0),W(2,2)], E(DiscardAll(Target.Self),Draw(4)));
        add(1, 'ЭНТРОПИЯ',           4, [W(0,2),G(1,0),G(1,2),W(2,0)], E(Supply(-1,Target.Self)));
        add(1, 'ТУННЕЛИРОВАНИЕ',     4, [W(0,0),W(0,1),W(1,0),W(2,0)], null, null, E(Supply(+1,Target.Self)));

        // ── СТОИМОСТЬ -1 ──
        add(1, 'ПЕРЕНАПРАВЛЕНИЕ',   -1, [G(0,0),G(0,2),W(2,0),W(2,2)], null, E(Place(1)));
        add(1, 'КЛЮЧ БЕЗОПАСНОСТИ', -1, [W(0,1),G(2,1)], E(Reveal(1,Target.Opp)), null, E(Reset()));
        add(1, 'ПРЕРЫВАНИЕ',        -1, [G(1,0),G(1,1),G(1,2)], null, null, E(Supply(-1,Target.Opp)));

        return cards;
    }
}
