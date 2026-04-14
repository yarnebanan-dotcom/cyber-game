// ═══════════════════════════════════════════════════════════
//  КИБЕР — UI Controller
// ═══════════════════════════════════════════════════════════

class GameUI {
    constructor() {
        this.state = null;
        this.tm = null;

        // Pending state
        this.pendingCard = null;
        this.currentPlacements = [];
        this.placementIndex = 0;

        // Synthesis state
        // null | { step: 'selectB'|'placeB'|'chooseOrder', cardA, matchA, cardB?, matchB? }
        this.synth = null;

        // Node picking
        this.nodePickAllowed = null;
        this.nodePickRemaining = 0;
        this.nodePickResult = [];
        this.nodePickDone = null;

        // Last turn summary for handoff screen
        this._lastTurnSummary = null;

        // Score animation tracking
        this._prevScores = [0, 0];

        this._bindElements();
        this._initAudio();
    }

    _bindElements() {
        this.boardEl = document.getElementById('board');
        this.p1ScoreEl = document.getElementById('p1-score');
        this.p2ScoreEl = document.getElementById('p2-score');
        this.p1SupplyEl = document.getElementById('p1-supply');
        this.p2SupplyEl = document.getElementById('p2-supply');
        this.p1ChipsEl = document.getElementById('p1-chips');
        this.p2ChipsEl = document.getElementById('p2-chips');
        this.p1BarEl = document.getElementById('p1-bar');
        this.p2BarEl = document.getElementById('p2-bar');
        this.deckCountEl = document.getElementById('deck-count');
        this.discardCountEl = document.getElementById('discard-count');
        this.phaseEl = document.getElementById('phase-label');
        this.turnEl = document.getElementById('turn-label');
        this.phaseHintEl = document.getElementById('phase-hint');
        this.handEl = document.getElementById('hand-cards');
        this.handLabelEl = document.getElementById('hand-label');
        this.ownRevealedEl = document.getElementById('own-revealed');
        this.oppRevealedEl = document.getElementById('opp-revealed');
        this.ownRevealedWrap = document.getElementById('own-revealed-wrap');
        this.oppRevealedWrap = document.getElementById('opp-revealed-wrap');

        // Buttons
        document.getElementById('btn-end-action').onclick = () => this._onEndAction();
        document.getElementById('btn-utilize').onclick = () => this._onUtilize();
        document.getElementById('btn-skip').onclick = () => this._onEndTurn();

        // Placement panel
        this.placementPanel = document.getElementById('placement-panel');
        this.placementCount = document.getElementById('placement-count');
        document.getElementById('btn-prev').onclick = () => this._prevPlacement();
        document.getElementById('btn-next').onclick = () => this._nextPlacement();
        document.getElementById('btn-confirm').onclick = () => this._confirmPlacement();
        document.getElementById('btn-synth').onclick = () => this._onSynthNext();
        document.getElementById('btn-synth-cancel').onclick = () => this._cancelSynth();

        // Synth order panel
        this.synthOrderPanel = document.getElementById('synth-order-panel');
        document.getElementById('btn-order-a').onclick = () => this._onSynthOrderChoose(true);
        document.getElementById('btn-order-b').onclick = () => this._onSynthOrderChoose(false);

        // Handoff screen
        this.handoffScreen = document.getElementById('handoff-screen');
        document.getElementById('btn-handoff-ok').onclick = () => this._onHandoffOk();

        // Game over screen
        this.gameOverScreen = document.getElementById('gameover-screen');
        this.gameOverText = document.getElementById('gameover-text');
        document.getElementById('btn-play-again').onclick = () => this._startGame();

        // Card pick modal
        this.cardPickModal = document.getElementById('card-pick-modal');
        this.cardPickTitle = document.getElementById('card-pick-title');
        this.cardPickList = document.getElementById('card-pick-list');
        this.cardPickCount = document.getElementById('card-pick-count');
        this.cardPickConfirm = document.getElementById('card-pick-confirm');
        this.cardPickConfirm.onclick = () => this._onCardPickConfirm();

        // Card detail overlay
        this.cardDetail = document.getElementById('card-detail');
        document.getElementById('card-detail-close').onclick = () => this.cardDetail.classList.add('hidden');
    }

    // ── Audio & Haptics ────────────────────────────────────────

    _initAudio() {
        try {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) { this._audioCtx = null; }
    }

    _playSound(type) {
        if (!this._audioCtx) return;
        const ctx = this._audioCtx;
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t = ctx.currentTime;
        if (type === 'chip') {
            // Short click — falling tone
            osc.frequency.setValueAtTime(700, t);
            osc.frequency.exponentialRampToValueAtTime(200, t + 0.07);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
            osc.start(t); osc.stop(t + 0.07);
        } else if (type === 'play') {
            // Card play — rising tone
            osc.frequency.setValueAtTime(440, t);
            osc.frequency.exponentialRampToValueAtTime(1320, t + 0.13);
            gain.gain.setValueAtTime(0.16, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            osc.start(t); osc.stop(t + 0.15);
        } else if (type === 'turn') {
            // End turn — two-note descend
            osc.frequency.setValueAtTime(660, t);
            osc.frequency.setValueAtTime(440, t + 0.09);
            gain.gain.setValueAtTime(0.13, t);
            gain.gain.setValueAtTime(0.09, t + 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
            osc.start(t); osc.stop(t + 0.24);
        }
    }

    _haptic(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }

    // ── Score counter ──────────────────────────────────────────

    _animateCounter(el, from, to, win) {
        const dur = 480, start = performance.now();
        const tick = now => {
            const p = Math.min((now - start) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            el.textContent = `${Math.round(from + (to - from) * ease)} / ${win}`;
            if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    _startGame() {
        this.state = new GameState(4, 15);
        const self = this;
        this.input = {
            chooseCards(pi, cards, count, done) {
                if (cards.length <= count) { done(cards); return; }
                self._showCardPick(pi, cards, count, done);
            },
            chooseNodes(pi, nodes, count, done) {
                if (nodes.length <= count) { done(nodes); return; }
                self._startNodePick(nodes, count, done);
            }
        };
        this.tm = new TurnManager(this.state, this.input);
        this.tm.onStateChanged = () => this._render();
        this.tm.onPhaseChanged = p => this._onPhaseChanged(p);
        this.tm.onGameOver = w => this._onGameOver(w);

        // Reset UI state
        this._prevScores = [0, 0];
        this.pendingCard = null;
        this.currentPlacements = [];
        this.nodePickDone = null;
        this.synth = null;
        this._lastTurnSummary = null;
        this.handoffScreen.classList.add('hidden');
        this.gameOverScreen.classList.add('hidden');
        this.placementPanel.classList.add('hidden');
        this.cardPickModal.classList.add('hidden');
        this.synthOrderPanel.classList.add('hidden');

        this.tm.replenish();
    }

    // ── Rendering ─────────────────────────────────────────────

    _render() {
        const st = this.state;
        const p1 = st.players[0], p2 = st.players[1];

        // Scores (animated counter on increase)
        const win = st.winScore;
        if (p1.score > this._prevScores[0]) {
            this._animateCounter(this.p1ScoreEl, this._prevScores[0], p1.score, win);
        } else {
            this.p1ScoreEl.textContent = `${p1.score} / ${win}`;
        }
        if (p2.score > this._prevScores[1]) {
            this._animateCounter(this.p2ScoreEl, this._prevScores[1], p2.score, win);
        } else {
            this.p2ScoreEl.textContent = `${p2.score} / ${win}`;
        }
        this._prevScores[0] = p1.score;
        this._prevScores[1] = p2.score;

        // Progress bars
        this.p1BarEl.style.width = Math.min(100, (p1.score / win) * 100) + '%';
        this.p2BarEl.style.width = Math.min(100, (p2.score / win) * 100) + '%';

        // Secondary stats
        this.p1SupplyEl.textContent = `Запас: ${p1.supply}`;
        this.p2SupplyEl.textContent = `Запас: ${p2.supply}`;
        this.p1ChipsEl.textContent = `Фишки: ${p1.chipsOnBoard}/8`;
        this.p2ChipsEl.textContent = `Фишки: ${p2.chipsOnBoard}/8`;
        this.deckCountEl.textContent = `Колода: ${st.deck.count}`;
        this.discardCountEl.textContent = `Сброс: ${st.discard.length}`;

        const phaseNames = { Replenish: 'Восполнение', Action: 'Действия', Task: 'Задача' };
        this.phaseEl.textContent = phaseNames[st.phase] || st.phase;
        this.turnEl.textContent = `Ход Игрока ${st.currentPI + 1}`;

        // Active player highlight
        document.getElementById('p1-panel').classList.toggle('active-player', st.currentPI === 0);
        document.getElementById('p2-panel').classList.toggle('active-player', st.currentPI === 1);

        // Hand label with player color
        const playerColor = st.currentPI === 0 ? '#6699ff' : '#ff6655';
        this.handLabelEl.textContent = `Рука Игрока ${st.currentPI + 1}`;
        this.handLabelEl.style.color = playerColor;

        // Phase hint
        this._updatePhaseHint();

        // Buttons visibility
        const inAction = st.phase === Phase.Action;
        const inTask = st.phase === Phase.Task;
        const inSynth = !!this.synth;
        document.getElementById('btn-end-action').style.display = inAction ? '' : 'none';
        document.getElementById('btn-utilize').style.display = (inTask && !inSynth) ? '' : 'none';
        document.getElementById('btn-skip').style.display = (inTask && !inSynth) ? '' : 'none';

        // Dynamic revealed labels
        const oppIdx = 1 - st.currentPI;
        document.getElementById('opp-revealed-label').textContent =
            `Раскрытые карты Игрока ${oppIdx + 1}`;
        document.getElementById('own-revealed-label').textContent =
            `Мои раскрытые (Игрок ${st.currentPI + 1})`;

        this._renderBoard();
        this._renderHand();
        this._renderRevealed();
    }

    _updatePhaseHint() {
        const st = this.state;
        let text = '';
        let color = '#aac4ff';

        if (this.nodePickDone) {
            const n = this.nodePickRemaining;
            text = `Выбери ${n} узел${n === 1 ? '' : n < 5 ? 'а' : 'ов'} на доске`;
            color = '#ffcc44';
        } else if (this.synth) {
            color = '#cc99ff';
            if (this.synth.step === 'selectB') {
                text = `⊕ Синтез 2/4 · выбери вторую карту для "${this.synth.cardA.name}"`;
            } else if (this.synth.step === 'placeB') {
                text = `⊕ Синтез 3/4 · выбери позицию для "${this.synth.cardB.name}"`;
            } else if (this.synth.step === 'chooseOrder') {
                text = `⊕ Синтез 4/4 · выбери порядок эффектов`;
            }
        } else if (st.phase === Phase.Replenish) {
            text = 'Добираем карты до запаса...';
            color = '#556677';
        } else if (st.phase === Phase.Action) {
            const chipsLeft = st.chipsAllowed - st.chipsPlaced;
            if (chipsLeft > 0) {
                const w = chipsLeft === 1 ? 'фишку' : chipsLeft < 5 ? 'фишки' : 'фишек';
                text = `Поставь ${chipsLeft} ${w} на поле`;
                color = '#ffcc44';
            } else {
                text = '✓ Фишки поставлены · нажми «✓ Конец действий»';
                color = '#66dd88';
            }
        } else if (st.phase === Phase.Task) {
            const t = st.tasksThisTurn, u = st.utilizesThisTurn;
            text = `Задач: ${t}/2 · Утилизаций: ${u}/2 · выбери карту`;
            color = '#88ccff';
        }

        this.phaseHintEl.textContent = text;
        this.phaseHintEl.style.color = color;
    }

    _renderBoard() {
        const st = this.state;
        const cells = this.boardEl.querySelectorAll('.node');
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r), c = parseInt(cell.dataset.c);
            const occ = st.board.nodes[r][c];
            cell.className = 'node';
            if (occ === Occ.P1) cell.classList.add('p1');
            else if (occ === Occ.P2) cell.classList.add('p2');
            else cell.classList.add('empty');
        });
    }

    _highlightNodes(positions) {
        this._clearHighlights();
        for (const [r, c] of positions) {
            const cell = this.boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
            if (cell) cell.classList.add('highlighted');
        }
    }

    _clearHighlights() {
        this.boardEl.querySelectorAll('.node').forEach(n => n.classList.remove('highlighted'));
    }

    _renderHand() {
        const st = this.state;
        const pl = st.cp;

        // Compute playable cards
        const playable = new Set();
        [...pl.hand, ...pl.revealed, ...st.opp.revealed].forEach(c => {
            if (this.tm.getValidPlacements(c).length > 0) playable.add(c);
        });

        this._renderCardRow(this.handEl, pl.hand, playable, true);
    }

    _renderRevealed() {
        const st = this.state;
        const playable = new Set();
        [...st.cp.hand, ...st.cp.revealed, ...st.opp.revealed].forEach(c => {
            if (this.tm.getValidPlacements(c).length > 0) playable.add(c);
        });
        this._renderCardRow(this.ownRevealedEl, st.cp.revealed, playable, true);
        this._renderCardRow(this.oppRevealedEl, st.opp.revealed, playable, false);

        // Collapse empty revealed zones
        this.ownRevealedWrap.classList.toggle('collapsed', st.cp.revealed.length === 0);
        this.oppRevealedWrap.classList.toggle('collapsed', st.opp.revealed.length === 0);
    }

    _renderCardRow(container, cards, playable, interactive) {
        container.innerHTML = '';
        cards.forEach(card => {
            const el = this._makeCardEl(card, playable.has(card), interactive);
            container.appendChild(el);
        });
    }

    _makeCardEl(card, isPlayable, interactive) {
        const el = document.createElement('div');
        el.className = 'card' + (isPlayable ? ' playable' : ' unplayable');
        if (card === this.pendingCard) el.classList.add('selected');

        // Cost badge color: green(-1) → gray(0) → blue(1-2) → orange(3-4)
        const costColor = card.cost < 0 ? '#44cc77'
                        : card.cost === 0 ? '#556677'
                        : card.cost <= 2  ? '#4488ff'
                        : '#ff8833';
        el.innerHTML = `
            <div class="card-cost" style="background:${costColor}">${card.cost}</div>
            <div class="card-name">${card.name}</div>
            <div class="card-pattern">${this._patternSVG(card.pattern)}</div>
            <div class="card-fx">${this._describeEffects(card)}</div>
        `;

        el.addEventListener('click', () => this._onCardTap(card, isPlayable));

        // Long press for card detail
        let pressTimer;
        el.addEventListener('touchstart', () => {
            pressTimer = setTimeout(() => this._showCardDetail(card), 500);
        }, { passive: true });
        el.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });

        return el;
    }

    _patternSVG(pattern) {
        const size = 48, cell = 14, gap = 2;
        let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
        svg += `<rect width="${size}" height="${size}" fill="transparent"/>`;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            const x = 4 + c * (cell + gap), y = 4 + r * (cell + gap);
            const cell_data = pattern.find(p => p.row === r && p.col === c);
            if (cell_data) {
                const fill = cell_data.type === CellType.W ? '#e0e0ff' : '#888';
                svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}" stroke="#666" stroke-width="1"/>`;
            } else {
                svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="none" stroke="#333" stroke-width="1"/>`;
            }
        }
        svg += '</svg>';
        return svg;
    }

    _describeEffects(card) {
        const parts = [];
        if (card.playEffect.hasEffects) parts.push(`<span class="fx-play">▶ ${this._fxText(card.playEffect)}</span>`);
        if (card.utilizeEffect.hasEffects) parts.push(`<span class="fx-util">✦ ${this._fxText(card.utilizeEffect)}</span>`);
        if (card.synthesisEffect.hasEffects) parts.push(`<span class="fx-synth">⊕ ${this._fxText(card.synthesisEffect)}</span>`);
        return parts.join('<br>') || '<span class="fx-none">—</span>';
    }

    _fxText(effect) {
        return effect.effects.map(fx => {
            const self = fx.target === Target.Self || fx.target === undefined;
            const tgt = self ? 'себе' : 'противнику';
            const n = fx.n;
            const inf = n === Infinity;
            switch (fx.constructor.name) {
                case 'DrawCardsEffect':    return `взять ${n}`;
                case 'DigCardsEffect':     return `раскопать ${n}`;
                case 'PlaceChipsEffect':   return `поставить ${n} фишк${n===1?'у':n<5?'и':'ек'}`;
                case 'RevealCardsEffect':  return inf ? `раскрыть все (${tgt})` : `раскрыть ${n} (${tgt})`;
                case 'DiscardCardsEffect': return inf ? `сбросить все (${tgt})` : `сбросить ${n} (${tgt})`;
                case 'StealCardsEffect':   return `украсть ${n}`;
                case 'ModifySupplyEffect': return `${fx.delta > 0 ? '+' : ''}${fx.delta} запас (${tgt})`;
                case 'SetSupplyEffect':    return `запас = ${fx.val} (${tgt})`;
                case 'CopyOpponentSupplyEffect': return 'запас = запас противника';
                case 'ResetFieldEffect':   return 'сбросить стол';
                default: return fx.constructor.name;
            }
        }).join(', ');
    }

    // ── Board building ─────────────────────────────────────────

    _buildBoard() {
        this.boardEl.innerHTML = '';
        const size = 4;
        this.boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const cell = document.createElement('div');
                cell.className = 'node empty';
                cell.dataset.r = r;
                cell.dataset.c = c;
                cell.addEventListener('click', () => this._onNodeTap(r, c));
                this.boardEl.appendChild(cell);
            }
        }
    }

    // ── Event handlers ─────────────────────────────────────────

    _onPhaseChanged(phase) {
        if (phase === Phase.Action) {
            this._highlightEmptyNodes();
        } else {
            this._clearHighlights();
        }
        this._updatePhaseHint();
    }

    _highlightEmptyNodes() {
        this._clearHighlights();
        const empty = this.state.board.emptyNodes();
        this._highlightNodes(empty);
    }

    _onNodeTap(r, c) {
        // Node picking mode (for PlaceChipsEffect)
        if (this.nodePickDone) {
            this._handleNodePick(r, c);
            return;
        }

        if (this.state.phase !== Phase.Action) return;

        const st = this.state;
        const selfOcc = st.board.occOf(st.currentPI);

        // Нажатие на свою фишку без уже размещённых — убрать её
        if (st.board.nodes[r][c] === selfOcc) {
            if (st.chipsPlaced === 0) {
                const result = this.tm.returnPiece(r, c);
                if (result === 'ok') {
                    this._renderBoard();
                    this._clearHighlights();
                    this._updatePhaseHint();
                }
            }
            return;
        }

        const result = this.tm.placeChip(r, c);
        if (result === 'ok') {
            this._haptic(14);
            this._playSound('chip');
            this._renderBoard();
            if (this.state.phase === Phase.Action) this._highlightEmptyNodes();
            this._updatePhaseHint();
        }
    }

    _onCardTap(card, isPlayable) {
        if (this.state.phase !== Phase.Task) return;

        // ── Синтез: выбор второй карты ──────────────────────────
        if (this.synth?.step === 'selectB') {
            if (card === this.synth.cardA) {
                this._cancelSynth();
                return;
            }
            const sharedPlacements = this._getSynthPlacements(card, this.synth.matchA);
            if (sharedPlacements.length === 0) {
                this._showMessage('Нет позиций с общей фишкой с первой картой');
                return;
            }
            this.synth.cardB = card;
            this.synth.step = 'placeB';
            this.pendingCard = card;
            this.currentPlacements = sharedPlacements;
            this.placementIndex = 0;
            this._render();
            this._showPlacementPanel();
            this._showMessage(`Выберите позицию для ${card.name}`);
            return;
        }

        // ── Обычный выбор карты ──────────────────────────────────
        if (this.pendingCard === card) {
            this.pendingCard = null;
            this.placementPanel.classList.add('hidden');
            this._clearHighlights();
            this._render();
            return;
        }

        this.pendingCard = card;
        this.placementPanel.classList.add('hidden');
        this._clearHighlights();
        this._render();

        if (isPlayable) {
            const placements = this.tm.getValidPlacements(card);
            if (placements.length > 0) {
                this.currentPlacements = placements;
                this.placementIndex = 0;
                this._showPlacementPanel();
            }
        }
    }

    // Позиции для второй карты синтеза: только те, что делят хотя бы одну фишку с matchA
    _getSynthPlacements(cardB, matchA) {
        const all = this.tm.getValidPlacements(cardB);
        const posA = new Set(matchA.chipPositions.map(([r, c]) => `${r},${c}`));
        return all.filter(p => p.chipPositions.some(([r, c]) => posA.has(`${r},${c}`)));
    }

    _onEndAction() {
        this.tm.endAction();
    }

    _onUtilize() {
        if (!this.pendingCard) {
            this._showMessage('Сначала выберите карту');
            return;
        }
        const st = this.state;
        if (st.utilizesThisTurn >= 2) {
            this._showMessage('Лимит утилизаций (2) исчерпан');
            return;
        }
        this.tm.utilizeCard(this.pendingCard, result => {
            this.pendingCard = null;
            this._render();
            if (result === 'limitReached') this._showMessage('Лимит утилизаций (2) исчерпан');
        });
    }

    // ── Синтез ─────────────────────────────────────────────────

    _onSynthNext() {
        const matchA = this.currentPlacements[this.placementIndex];
        this.synth = { step: 'selectB', cardA: this.pendingCard, matchA };
        this.placementPanel.classList.add('hidden');
        this._highlightNodes(matchA.chipPositions);
        this.pendingCard = null;
        this._render();
        this._showMessage(`Первая карта: ${this.synth.cardA.name}. Выберите вторую карту`);
    }

    _cancelSynth() {
        this.synth = null;
        this.pendingCard = null;
        this.placementPanel.classList.add('hidden');
        this.synthOrderPanel.classList.add('hidden');
        this._clearHighlights();
        this._render();
    }

    _showSynthOrderPanel() {
        const { cardA, cardB } = this.synth;
        document.getElementById('btn-order-a').innerHTML =
            `<span class="synth-order-name">${cardA.name}</span><span class="synth-order-arrow">→</span><span class="synth-order-name">${cardB.name}</span>`;
        document.getElementById('btn-order-b').innerHTML =
            `<span class="synth-order-name">${cardB.name}</span><span class="synth-order-arrow">→</span><span class="synth-order-name">${cardA.name}</span>`;
        this.synthOrderPanel.classList.remove('hidden');
        this._updatePhaseHint();
    }

    _onSynthOrderChoose(aFirst) {
        this.synthOrderPanel.classList.add('hidden');
        const { cardA, cardB, matchA, matchB } = this.synth;
        this.synth = null;
        this.pendingCard = null;
        this.tm.synthesis(cardA, cardB, matchA, matchB, aFirst, result => {
            this._render();
            if (result === 'limitReached') this._showMessage('Лимит задач (2) исчерпан');
            if (result === 'invalidAction') this._showMessage('Синтез невозможен: нет общей фишки');
        });
    }

    _onEndTurn() {
        const st = this.state;
        // Сохраняем итог хода до endTurn()
        const summary = {
            playerIdx: st.currentPI,
            tasks: st.tasksThisTurn,
            utilizes: st.utilizesThisTurn,
            score: st.cp.score,
        };
        const ok = this.tm.endTurn();
        if (ok) {
            this._haptic([12, 8, 32]);
            this._playSound('turn');
            this._lastTurnSummary = summary;
            this.pendingCard = null;
            this.placementPanel.classList.add('hidden');
            this._clearHighlights();
            this._render();
            this._showHandoff();
        }
    }

    // ── Placement panel ────────────────────────────────────────

    _showPlacementPanel() {
        const inSynthB = this.synth?.step === 'placeB';
        const tasksLeft = this.state.tasksThisTurn < 2;
        document.getElementById('btn-synth').style.display = (!inSynthB && tasksLeft) ? '' : 'none';
        document.getElementById('btn-confirm').textContent = inSynthB ? 'Подтвердить' : 'Разыграть!';
        document.getElementById('btn-synth-cancel').style.display = inSynthB ? '' : 'none';
        this.placementPanel.classList.remove('hidden');
        this._updatePlacementHighlight();
    }

    _updatePlacementHighlight() {
        const placement = this.currentPlacements[this.placementIndex];
        this._highlightNodes(placement.chipPositions);
        this.placementCount.textContent =
            `Позиция ${this.placementIndex + 1} из ${this.currentPlacements.length}`;
    }

    _prevPlacement() {
        this.placementIndex = (this.placementIndex - 1 + this.currentPlacements.length) % this.currentPlacements.length;
        this._updatePlacementHighlight();
    }

    _nextPlacement() {
        this.placementIndex = (this.placementIndex + 1) % this.currentPlacements.length;
        this._updatePlacementHighlight();
    }

    _confirmPlacement() {
        const placement = this.currentPlacements[this.placementIndex];

        if (this.synth?.step === 'placeB') {
            this.synth.matchB = placement;
            this.synth.step = 'chooseOrder';
            this.placementPanel.classList.add('hidden');
            this._clearHighlights();
            this._showSynthOrderPanel();
            return;
        }

        this.placementPanel.classList.add('hidden');
        this._clearHighlights();
        const card = this.pendingCard;
        this.pendingCard = null;
        this.tm.playCard(card, placement, result => {
            if (!result) { this._haptic(26); this._playSound('play'); }
            this._render();
            if (result === 'limitReached') this._showMessage('Лимит задач (2) исчерпан');
        });
    }

    // ── Node picking ───────────────────────────────────────────

    _startNodePick(allowed, count, done) {
        this.nodePickAllowed = [...allowed];
        this.nodePickRemaining = count;
        this.nodePickResult = [];
        this.nodePickDone = done;
        this._highlightNodes(this.nodePickAllowed);
        this._updatePhaseHint();
    }

    _handleNodePick(r, c) {
        const idx = this.nodePickAllowed.findIndex(([pr, pc]) => pr === r && pc === c);
        if (idx < 0) return;

        this.nodePickResult.push([r, c]);
        this.nodePickAllowed.splice(idx, 1);
        this.nodePickRemaining--;

        const cell = this.boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
        if (cell) cell.classList.add('selected-node');

        if (this.nodePickRemaining <= 0 || this.nodePickAllowed.length === 0) {
            this._clearHighlights();
            const done = this.nodePickDone;
            const result = this.nodePickResult;
            this.nodePickDone = null;
            this._updatePhaseHint();
            done(result);
        } else {
            this._highlightNodes(this.nodePickAllowed);
            this._updatePhaseHint();
        }
    }

    // ── Handoff screen ─────────────────────────────────────────

    _showHandoff() {
        const s = this._lastTurnSummary;
        const nextPlayer = this.state.currentPI + 1;
        const playerColor = s.playerIdx === 0 ? '#6699ff' : '#ff6655';

        // Итог хода
        const parts = [];
        if (s.tasks > 0) parts.push(`сыграно карт: ${s.tasks}`);
        if (s.utilizes > 0) parts.push(`утилизировано: ${s.utilizes}`);
        if (parts.length === 0) parts.push('ход завершён без задач');

        document.getElementById('handoff-player').innerHTML =
            `<span style="color:${playerColor}">Игрок ${s.playerIdx + 1}</span> завершил ход`;
        document.getElementById('handoff-summary').innerHTML =
            `${parts.join(' · ')}<br>Счёт: <span style="color:${playerColor}">${s.score}</span> / ${this.state.winScore}`;
        document.getElementById('handoff-next').innerHTML =
            `Передайте устройство<br>Игроку ${nextPlayer}`;

        this.handoffScreen.classList.remove('hidden');

        // Glitch entrance on "Передайте устройство" text
        const nextEl = document.getElementById('handoff-next');
        nextEl.classList.remove('glitch');
        requestAnimationFrame(() => nextEl.classList.add('glitch'));
        setTimeout(() => nextEl.classList.remove('glitch'), 750);
    }

    _onHandoffOk() {
        this.handoffScreen.classList.add('hidden');
        this.tm.replenish();
    }

    // ── Game over ──────────────────────────────────────────────

    _onGameOver(winner) {
        const st = this.state;
        this.gameOverText.innerHTML =
            `🏆 Победитель: Игрок ${winner + 1}!<br>` +
            `Счёт: ${st.players[0].score} — ${st.players[1].score}`;
        this.gameOverScreen.classList.remove('hidden');
    }

    // ── Card pick modal ────────────────────────────────────────

    _showCardPick(pi, cards, count, done) {
        this._cardPickDone = done;
        this._cardPickRequired = count;
        this._cardPickSelected = [];

        this.cardPickTitle.textContent = `Игрок ${pi + 1}: выберите ${count} карт${count === 1 ? 'у' : 'ы'}`;
        this.cardPickList.innerHTML = '';

        cards.forEach(card => {
            const item = document.createElement('div');
            item.className = 'pick-item';
            const fxLines = [];
            if (card.playEffect.hasEffects) fxLines.push(`▶ ${this._fxText(card.playEffect)}`);
            if (card.utilizeEffect.hasEffects) fxLines.push(`✕ ${this._fxText(card.utilizeEffect)}`);
            item.innerHTML =
                `<div class="pick-item-pattern">${this._patternSVG(card.pattern)}</div>` +
                `<div class="pick-item-info">` +
                  `<div class="pick-item-header"><strong>${card.name}</strong><span class="pick-cost">[${card.cost}]</span></div>` +
                  (fxLines.length ? `<div class="pick-item-fx">${fxLines.join('<br>')}</div>` : '') +
                `</div>`;
            item.addEventListener('click', () => {
                if (this._cardPickSelected.includes(card)) {
                    this._cardPickSelected = this._cardPickSelected.filter(c => c !== card);
                    item.classList.remove('selected');
                } else if (this._cardPickSelected.length < count) {
                    this._cardPickSelected.push(card);
                    item.classList.add('selected');
                }
                this.cardPickCount.textContent = `Выбрано: ${this._cardPickSelected.length} / ${count}`;
                this.cardPickConfirm.disabled = this._cardPickSelected.length !== count;
            });
            this.cardPickList.appendChild(item);
        });

        this.cardPickCount.textContent = `Выбрано: 0 / ${count}`;
        this.cardPickConfirm.disabled = true;
        this.cardPickModal.classList.remove('hidden');
    }

    _onCardPickConfirm() {
        this.cardPickModal.classList.add('hidden');
        const done = this._cardPickDone;
        const selected = this._cardPickSelected;
        this._cardPickDone = null;
        done(selected);
    }

    // ── Card detail ────────────────────────────────────────────

    _showCardDetail(card) {
        document.getElementById('detail-name').textContent = card.name;
        document.getElementById('detail-cost').textContent = `Стоимость: ${card.cost}`;
        document.getElementById('detail-pattern').innerHTML = this._patternSVG(card.pattern);
        document.getElementById('detail-effects').innerHTML = [
            card.playEffect.hasEffects ? `<b>Розыгрыш:</b> ${this._fxText(card.playEffect)}` : '',
            card.utilizeEffect.hasEffects ? `<b>Утилизация:</b> ${this._fxText(card.utilizeEffect)}` : '',
            card.synthesisEffect.hasEffects ? `<b>Синтез:</b> ${this._fxText(card.synthesisEffect)}` : '',
        ].filter(Boolean).join('<br>') || '—';
        this.cardDetail.classList.remove('hidden');
    }

    // ── Utils ──────────────────────────────────────────────────

    _showMessage(text) {
        const el = document.getElementById('toast');
        el.textContent = text;
        el.classList.remove('hidden');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2000);
    }
}

// ── Bootstrap ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const ui = new GameUI();
    ui._buildBoard();
    ui._startGame();
});
