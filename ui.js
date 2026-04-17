// ═══════════════════════════════════════════════════════════
//  КИБЕР — UI Controller
// ═══════════════════════════════════════════════════════════

class GameUI {
    constructor() {
        this.state = null;
        this.tm = null;

        // Pending state
        this.pendingCard = null;
        this.pendingNodes = [];
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

        // Card pattern rotations (card.id → degrees)
        this._cardRotations = new Map();

        // Score animation tracking
        this._prevScores = [0, 0, 0];
        this._playerCount = 2;

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
        document.getElementById('btn-play-again').onclick = () => this._startGame(this._playerCount);
        document.getElementById('btn-gameover-menu').onclick = () => this._showMenu();

        // Rules screen
        document.getElementById('btn-show-rules').onclick = () => document.getElementById('rules-screen').classList.remove('hidden');
        document.getElementById('btn-rules-close').onclick = () => document.getElementById('rules-screen').classList.add('hidden');

        // In-game menu
        document.getElementById('btn-ingame-menu').onclick = () => this._showIngameMenu();
        document.getElementById('btn-to-menu').onclick = () => { this._hideIngameMenu(); this._showMenu(); };
        document.getElementById('btn-restart').onclick = () => { this._hideIngameMenu(); this._startGame(this._playerCount); };
        document.getElementById('btn-close-ingame-menu').onclick = () => this._hideIngameMenu();
        document.getElementById('ingame-menu').addEventListener('click', e => { if (e.target.id === 'ingame-menu') this._hideIngameMenu(); });

        // Menu screen
        this.menuScreen = document.getElementById('menu-screen');
        document.getElementById('btn-mode-2p').onclick = () => this._startGame(2);
        document.getElementById('btn-mode-3p').onclick = () => this._startGame(3);

        // Card pick modal
        this.cardPickModal = document.getElementById('card-pick-modal');
        this.cardPickTitle = document.getElementById('card-pick-title');
        this.cardPickList = document.getElementById('card-pick-list');
        this.cardPickCount = document.getElementById('card-pick-count');
        this.cardPickConfirm = document.getElementById('card-pick-confirm');
        this.cardPickConfirm.onclick = () => this._onCardPickConfirm();

        // Card detail overlay
        this.cardDetail = document.getElementById('card-detail');
        this._detailRotation = 0;
        document.getElementById('card-detail-close').onclick = () => this.cardDetail.classList.add('hidden');
        document.getElementById('btn-rotate-ccw').onclick = () => this._rotateDetail(-90);
        document.getElementById('btn-rotate-cw').onclick  = () => this._rotateDetail(+90);
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

    _showMenu() {
        this.menuScreen.classList.remove('hidden');
        this.gameOverScreen.classList.add('hidden');
        this.handoffScreen.classList.add('hidden');
    }

    _startGame(playerCount = 2) {
        this._playerCount = playerCount;
        const boardSize = playerCount === 3 ? 5 : 4;
        const winScore  = playerCount === 3 ? 20 : 15;

        // 3-player mode class on #app
        document.getElementById('app').classList.toggle('mode-3p', playerCount === 3);

        this.state = new GameState(boardSize, winScore, playerCount);
        const self = this;
        this.input = {
            chooseCards(pi, cards, count, done) {
                if (cards.length <= count) { done(cards); return; }
                const ctx = self._buildChoiceContext(pi, count);
                if (pi !== self.state.currentPI) {
                    // Противник выбирает карты — передать устройство ему, затем вернуть
                    const actorPI = self.state.currentPI;
                    self._showHandoffForChoice(pi, () => {
                        self._showCardPick(pi, cards, count, chosen => {
                            self._showHandoffForChoice(actorPI, () => {
                                done(chosen);
                            }, { backToActor: true });
                        }, ctx);
                    }, ctx);
                } else {
                    self._showCardPick(pi, cards, count, done, ctx);
                }
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
        this._prevScores = [0, 0, 0];
        this._cardRotations = new Map();
        this.pendingCard = null;
        this.pendingNodes = [];
        this.currentPlacements = [];
        this.nodePickDone = null;
        this.synth = null;
        this._lastTurnSummary = null;
        this.menuScreen.classList.add('hidden');
        this.handoffScreen.classList.add('hidden');
        this.gameOverScreen.classList.add('hidden');
        this.placementPanel.classList.add('hidden');
        this.cardPickModal.classList.add('hidden');
        this.synthOrderPanel.classList.add('hidden');

        this._buildBoard(boardSize);
        this.tm.replenish();
    }

    // ── Rendering ─────────────────────────────────────────────

    _playerColor(pi) {
        return ['#6699ff', '#ff6655', '#44dd88'][pi] ?? '#aaccff';
    }

    _render() {
        const st = this.state;
        const win = st.winScore;

        // Scores & bars for all players
        const scoreEls = [this.p1ScoreEl, this.p2ScoreEl, document.getElementById('p3-score')];
        const barEls   = [this.p1BarEl, this.p2BarEl, document.getElementById('p3-bar')];
        const supplyEls = [this.p1SupplyEl, this.p2SupplyEl, document.getElementById('p3-supply')];
        const chipsEls  = [this.p1ChipsEl, this.p2ChipsEl, document.getElementById('p3-chips')];
        for (let i = 0; i < st.players.length; i++) {
            const p = st.players[i];
            if (p.score > this._prevScores[i]) {
                this._animateCounter(scoreEls[i], this._prevScores[i], p.score, win);
            } else {
                scoreEls[i].textContent = `${p.score} / ${win}`;
            }
            this._prevScores[i] = p.score;
            barEls[i].style.width = Math.min(100, (p.score / win) * 100) + '%';
            supplyEls[i].textContent = `Запас: ${p.supply}`;
            chipsEls[i].textContent = `Фишки: ${p.chipsOnBoard}/8`;
        }

        this.deckCountEl.textContent = `Колода: ${st.deck.count}`;
        this.discardCountEl.textContent = `Сброс: ${st.discard.length}`;

        const phaseNames = { Replenish: 'Восполнение', Action: 'Действия', Task: 'Задача' };
        const phaseName = phaseNames[st.phase] || st.phase;
        const turnName = `Ход Игрока ${st.currentPI + 1}`;
        this.phaseEl.textContent = phaseName;
        this.turnEl.textContent = turnName;

        // 3-player compact info strip
        const p3phase = document.getElementById('phase-label-3p');
        const p3turn  = document.getElementById('turn-label-3p');
        const p3deck  = document.getElementById('deck-count-3p');
        const p3disc  = document.getElementById('discard-count-3p');
        if (p3phase) p3phase.textContent = phaseName;
        if (p3turn)  p3turn.textContent  = turnName;
        if (p3deck)  p3deck.textContent  = `Колода: ${st.deck.count}`;
        if (p3disc)  p3disc.textContent  = `Сброс: ${st.discard.length}`;

        // Active player highlight
        for (let i = 0; i < 3; i++) {
            const panel = document.getElementById(`p${i+1}-panel`);
            if (panel) panel.classList.toggle('active-player', st.currentPI === i);
        }

        // Hand label with player color
        const playerColor = this._playerColor(st.currentPI);
        this.handLabelEl.textContent = `Рука Игрока ${st.currentPI + 1}`;
        this.handLabelEl.style.color = playerColor;

        // Phase hint
        this._updatePhaseHint();

        // Buttons visibility
        const inAction = st.phase === Phase.Action;
        const inTask = st.phase === Phase.Task;
        const inSynth = !!this.synth;
        const inNodePick = !!this.nodePickDone;
        const endActionBtn = document.getElementById('btn-end-action');
        const skipBtn = document.getElementById('btn-skip');
        endActionBtn.style.display = inAction ? '' : 'none';
        document.getElementById('btn-utilize').style.display = (inTask && !inSynth && !inNodePick) ? '' : 'none';
        skipBtn.style.display = (inTask && !inSynth && !inNodePick) ? '' : 'none';

        // Dynamic primary/secondary state for action buttons
        if (inAction) {
            const chipsLeft = st.chipsAllowed - st.chipsPlaced;
            endActionBtn.classList.toggle('btn-primary', chipsLeft === 0);
            endActionBtn.classList.toggle('btn-ghost', chipsLeft > 0);
        }
        if (inTask && !inSynth && !inNodePick) {
            const allCards = [...st.cp.hand, ...st.players.flatMap(p => p.revealed)];
            const hasPlayable = allCards.some(c => this.tm.getValidPlacements(c).length > 0);
            const hasHand = st.cp.hand.length > 0 || st.cp.revealed.length > 0;
            if (!hasHand)          skipBtn.textContent = '⏭ Завершить ход (нет карт)';
            else if (!hasPlayable) skipBtn.textContent = '⏭ Завершить ход (нет розыгрышей)';
            else                   skipBtn.textContent = '⏭ Завершить ход';
            // Primary когда нет розыгрышей/карт, ghost когда есть что делать
            skipBtn.classList.toggle('btn-primary', !hasPlayable);
            skipBtn.classList.toggle('btn-ghost', hasPlayable);
        }

        // Dynamic revealed labels
        const oppNums = st.players.map((_, i) => i + 1).filter(n => n !== st.currentPI + 1);
        document.getElementById('opp-revealed-label').textContent =
            `Раскрытые Игрок${oppNums.length > 1 ? 'и' : ''} ${oppNums.join(' & ')}`;
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
            if (this.pendingCard) {
                const pl = this.pendingCard.pattern.length;
                text = `Тапни ${pl} фишк${pl===1?'у':pl<5?'и':'ек'} паттерна · или ⊗ Утилизировать`;
                color = '#ffcc44';
            } else {
                const allCards = [...st.cp.hand, ...st.players.flatMap(p => p.revealed)];
                const hasPlayable = allCards.some(c => this.tm.getValidPlacements(c).length > 0);
                const hasHand = st.cp.hand.length > 0 || st.cp.revealed.length > 0;
                if (!hasHand) {
                    text = `Карт нет · завершай ход`;
                    color = '#8899aa';
                } else if (!hasPlayable) {
                    text = `Розыгрыш невозможен · ✦ утилизируй или завершай ход`;
                    color = '#e0a860';
                } else {
                    text = `Выбери карту · ▶ разыграй или ✦ утилизируй (${t}/2 · ${u}/2)`;
                    color = '#88ccff';
                }
            }
        }

        this.phaseHintEl.textContent = text;
        this.phaseHintEl.style.color = color;

        // Тонировать SVG-бар через hue-rotate
        let hue = '0deg', sat = '1', bri = '1';
        if (this.synth) {
            hue = '78deg';                      // фиолетовый
        } else if (st.phase === Phase.Replenish) {
            hue = '0deg'; sat = '0.15'; bri = '0.55'; // приглушённый
        } else if (st.phase === Phase.Action) {
            const chipsLeft = st.chipsAllowed - st.chipsPlaced;
            hue = chipsLeft > 0 ? '-147deg' : '-57deg'; // жёлтый / зелёный
        } else if (st.phase === Phase.Task) {
            hue = '18deg';                      // синий
        }
        this.phaseHintEl.style.setProperty('--hint-hue', hue);
        this.phaseHintEl.style.setProperty('--hint-sat', sat);
        this.phaseHintEl.style.setProperty('--hint-bri', bri);
    }

    _renderBoard() {
        const st = this.state;
        const occClass = ['empty', 'p1', 'p2', 'p3'];
        const cells = this.boardEl.querySelectorAll('.node');
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r), c = parseInt(cell.dataset.c);
            const occ = st.board.nodes[r][c];
            cell.className = 'node ' + (occClass[occ] ?? 'empty');
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

        // Compute playable cards (own hand + all revealed)
        const playable = new Set();
        const allRevealed = st.players.flatMap(p => p.revealed);
        [...pl.hand, ...allRevealed].forEach(c => {
            if (this.tm.getValidPlacements(c).length > 0) playable.add(c);
        });

        this._renderCardRow(this.handEl, pl.hand, playable, true);
    }

    _renderRevealed() {
        const st = this.state;
        const allRevealed = st.players.flatMap(p => p.revealed);
        const playable = new Set();
        [...st.cp.hand, ...allRevealed].forEach(c => {
            if (this.tm.getValidPlacements(c).length > 0) playable.add(c);
        });
        this._renderCardRow(this.ownRevealedEl, st.cp.revealed, playable, true);

        // Opponent(s) revealed: all opponents combined
        const oppRevealed = st.players.filter((_, i) => i !== st.currentPI).flatMap(p => p.revealed);
        this._renderCardRow(this.oppRevealedEl, oppRevealed, playable, false);

        // Collapse empty revealed zones
        this.ownRevealedWrap.classList.toggle('collapsed', st.cp.revealed.length === 0);
        this.oppRevealedWrap.classList.toggle('collapsed', oppRevealed.length === 0);
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

        // Cost badge color: red(-1 штраф) → gray(0) → blue(1-2) → orange(3-4)
        const costColor = card.cost < 0 ? '#cc4455'
                        : card.cost === 0 ? '#3a4452'
                        : card.cost <= 2  ? '#4488ff'
                        : '#ff8833';
        el.innerHTML = `
            <div class="card-cost" style="background:${costColor}">${card.cost}</div>
            <div class="card-name">${card.name}</div>
            <div class="card-pattern">${this._patternSVG(card.pattern, 44)}</div>
            <div class="card-fx">${this._describeEffectsCompact(card)}</div>
        `;

        // Apply stored rotation
        const storedRot = this._cardRotations.get(card.id) || 0;
        if (storedRot) {
            const svg = el.querySelector('.card-pattern svg');
            if (svg) svg.style.transform = `rotate(${storedRot}deg)`;
        }

        // Single tap → select card; double tap → rotate pattern
        let lastTap = 0;
        let didZoom = false;
        el.addEventListener('click', () => {
            if (didZoom) { didZoom = false; return; }
            const now = Date.now();
            if (now - lastTap < 300) {
                lastTap = 0;
                const next = ((this._cardRotations.get(card.id) || 0) + 90) % 360;
                this._cardRotations.set(card.id, next);
                const svg = el.querySelector('.card-pattern svg');
                if (svg) svg.style.transform = `rotate(${next}deg)`;
                return;
            }
            lastTap = now;
            this._onCardTap(card, isPlayable);
        });

        // Prevent text selection and context menu on long press
        el.addEventListener('selectstart', e => e.preventDefault());
        el.addEventListener('contextmenu', e => e.preventDefault());

        // Long press → floating popup above card
        let pressTimer;
        const zoomIn = (e) => {
            didZoom = true;
            this._haptic(8);
            this._showCardPopup(card, el);
        };
        const zoomOut = () => { clearTimeout(pressTimer); };
        el.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => zoomIn(e), 400);
        }, { passive: true });
        el.addEventListener('touchend', zoomOut, { passive: true });
        el.addEventListener('touchcancel', zoomOut, { passive: true });

        return el;
    }

    _showCardPopup(card, anchorEl) {
        // Remove existing popup
        document.getElementById('card-popup')?.remove();

        const popup = document.createElement('div');
        popup.id = 'card-popup';
        const costColor = card.cost < 0 ? '#cc4455'
                        : card.cost === 0 ? '#3a4452'
                        : card.cost <= 2  ? '#4488ff'
                        : '#ff8833';
        popup.innerHTML = `
            <div class="card-cost" style="background:${costColor}">${card.cost}</div>
            <div class="card-popup-name">${card.name}</div>
            <div class="card-pattern" style="display:flex;justify-content:center;margin:4px 0">${this._patternSVG(card.pattern, 56)}</div>
            <div class="card-fx" style="display:block">${this._describeEffects(card)}</div>
        `;
        document.body.appendChild(popup);

        // Position: above the anchor card, horizontally centred on it
        const rect = anchorEl.getBoundingClientRect();
        const pw = 160, ph = popup.offsetHeight || 180;
        let left = rect.left + rect.width / 2 - pw / 2;
        let top  = rect.top - ph - 10;
        // Clamp to viewport
        left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
        top  = Math.max(8, top);
        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';

        // Dismiss on any touch outside
        const dismiss = (e) => {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener('touchstart', dismiss);
            }
        };
        setTimeout(() => document.addEventListener('touchstart', dismiss, { passive: true }), 50);
    }

    _patternSVG(pattern, size = 48) {
        const cell = Math.floor((size - 8) / 3 - 2), gap = 2;
        let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
        svg += `<rect width="${size}" height="${size}" rx="5" fill="#07101e" stroke="rgba(40,60,120,0.5)" stroke-width="1"/>`;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            const x = 4 + c * (cell + gap), y = 4 + r * (cell + gap);
            const cell_data = pattern.find(p => p.row === r && p.col === c);
            if (cell_data) {
                if (cell_data.type === CellType.W) {
                    svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="#c0d0ff" stroke="rgba(160,190,255,0.5)" stroke-width="0.5"/>`;
                } else {
                    svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="#3a4a72" stroke="rgba(80,110,170,0.6)" stroke-width="0.5"/>`;
                }
            } else {
                svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>`;
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

    // Компактный формат для карт в руке: иконки + цифры
    _describeEffectsCompact(card) {
        const parts = [];
        if (card.playEffect.hasEffects)      parts.push(`<span class="fx-play">▶${this._fxCompact(card.playEffect)}</span>`);
        if (card.utilizeEffect.hasEffects)   parts.push(`<span class="fx-util">✦${this._fxCompact(card.utilizeEffect)}</span>`);
        if (card.synthesisEffect.hasEffects) parts.push(`<span class="fx-synth">⊕${this._fxCompact(card.synthesisEffect)}</span>`);
        return parts.join('') || '';
    }

    _fxCompact(effect) {
        return effect.effects.map(fx => {
            const self = fx.target === Target.Self || fx.target === undefined;
            const n = fx.n;
            const inf = n === Infinity;
            const num = inf ? '∞' : n;
            const oppMark = self ? '' : '!';  // ! = на противника
            switch (fx.constructor.name) {
                case 'DrawCardsEffect':    return ` +${n}c`;            // карты в руку
                case 'DigCardsEffect':     return ` ⛏${n}`;             // раскопать
                case 'PlaceChipsEffect':   return ` ●${n}`;             // фишки
                case 'RevealCardsEffect':  return ` 👁${num}${oppMark}`;
                case 'DiscardCardsEffect': return ` ✕${num}${oppMark}`;
                case 'StealCardsEffect':   return ` ⇆${n}`;
                case 'ModifySupplyEffect': {
                    const t = fx.target === Target.Self ? '' : '!';
                    return ` ⚡${fx.delta>0?'+':''}${fx.delta}${t}`;
                }
                case 'SetSupplyEffect':    return ` ⚡=${fx.val}${self?'':'!'}`;
                case 'CopyOpponentSupplyEffect': return ` ⚡=⚡!`;
                case 'ResetFieldEffect':   return ` ↻стол`;
                default: return '';
            }
        }).join('');
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

    _buildBoard(size = 4) {
        this.boardEl.innerHTML = '';
        this.boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        // For 5×5, slightly reduce board visual size
        if (size === 5) {
            this.boardEl.style.gap = '6px';
            this.boardEl.style.padding = '10px';
        } else {
            this.boardEl.style.gap = '';
            this.boardEl.style.padding = '';
        }
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

        // Task phase: накапливаем тапы по фишкам паттерна
        if (this.state.phase === Phase.Task) {
            if (this.pendingCard || this.synth?.step === 'placeA' || this.synth?.step === 'placeB') {
                this._onPatternNodeTap(r, c);
            }
            return;
        }

        if (this.state.phase !== Phase.Action) return;

        const st = this.state;
        const selfOcc = st.board.occOf(st.currentPI);

        // Нажатие на свою фишку
        if (st.board.nodes[r][c] === selfOcc) {
            const placedThisTurn = st.placedThisTurn || [];
            if (placedThisTurn.some(([pr, pc]) => pr === r && pc === c)) {
                // Фишка поставлена в этот ход — отменить
                const result = this.tm.undoChip(r, c);
                if (result === 'ok') {
                    this._haptic(14);
                    this._renderBoard();
                    this._highlightEmptyNodes();
                    this._updatePhaseHint();
                    this._render();
                }
            } else if (st.chipsPlaced === 0) {
                // Фишка с прошлого хода — убрать как альтернативное действие
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
            if (this.state.phase === Phase.Action) {
                // Подсветку пустых узлов оставляем только пока фишки ещё можно ставить
                if (st.chipsPlaced < st.chipsAllowed) this._highlightEmptyNodes();
                else this._clearHighlights();
            }
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
            this._showCardSelectedPanel();
            this._showMessage(`Тапни позицию для ${card.name} на доске`);
            return;
        }

        // ── Обычный выбор карты ──────────────────────────────────
        if (this.pendingCard === card) {
            this.pendingCard = null;
            this.pendingNodes = [];
            this.placementPanel.classList.add('hidden');
            this._clearHighlights();
            this._render();
            return;
        }

        this.pendingCard = card;
        this.pendingNodes = [];
        this.placementPanel.classList.add('hidden');
        this._clearHighlights();
        this._render();

        if (isPlayable) {
            const placements = this.tm.getValidPlacements(card);
            if (placements.length > 0) {
                this.currentPlacements = placements;
                this.placementIndex = 0;
                this._showCardSelectedPanel();
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
        if (this.nodePickDone) return;
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
        this.synth = { step: 'placeA', cardA: this.pendingCard, placementsA: this.currentPlacements };
        this.pendingCard = null;
        this.placementPanel.classList.add('hidden');
        this._clearHighlights();
        this._render();
        this._showMessage(`Тапни позицию ${this.synth.cardA.name} на доске`);
    }

    _cancelSynth() {
        this.synth = null;
        this.pendingCard = null;
        this.pendingNodes = [];
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
        if (this.nodePickDone) return;
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

    // Показывает панель без ‹›/счётчика/подтверждения — только Синтез и Отмена
    _showCardSelectedPanel() {
        const inSynthB = this.synth?.step === 'placeB';
        ['btn-prev', 'btn-next', 'placement-count', 'btn-confirm'].forEach(id => {
            document.getElementById(id).style.display = 'none';
        });
        // Показываем Синтез только если возможна вторая карта-партнёр
        const canSynth = !inSynthB
            && this.state.tasksThisTurn < 2
            && this.pendingCard
            && this._hasSynthPartner(this.pendingCard);
        document.getElementById('btn-synth').style.display = canSynth ? '' : 'none';
        const cancelBtn = document.getElementById('btn-synth-cancel');
        cancelBtn.textContent = inSynthB ? '✕ Отмена синтеза' : '✕ Отменить выбор';
        cancelBtn.style.display = '';
        this.placementPanel.classList.remove('hidden');
    }

    // Есть ли среди других карт (рука + раскрытые) хотя бы одна, с которой возможен синтез
    _hasSynthPartner(cardA) {
        const matchesA = this.currentPlacements;
        if (!matchesA || !matchesA.length) return false;
        const cp = this.state.cp;
        const candidates = [
            ...cp.hand,
            ...this.state.players.flatMap(p => p.revealed)
        ].filter(c => c !== cardA);
        for (const cardB of candidates) {
            const allB = this.tm.getValidPlacements(cardB);
            if (!allB.length) continue;
            for (const mA of matchesA) {
                const posA = new Set(mA.chipPositions.map(([r, c]) => `${r},${c}`));
                if (allB.some(p => p.chipPositions.some(([r, c]) => posA.has(`${r},${c}`)))) {
                    return true;
                }
            }
        }
        return false;
    }

    // Тап на узел в Task фазе — накапливаем выбранные фишки паттерна
    _onPatternNodeTap(r, c) {
        // Определяем длину нужного паттерна
        let patternLen;
        if (this.synth?.step === 'placeA')      patternLen = this.synth.cardA.pattern.length;
        else if (this.synth?.step === 'placeB') patternLen = this.pendingCard?.pattern.length;
        else if (this.pendingCard)              patternLen = this.pendingCard.pattern.length;
        if (!patternLen) return;

        // Пропускаем пустые узлы — паттерн состоит только из фишек
        if (this.state.board.nodes[r][c] === Occ.Empty) return;

        // Тогл: убрать если уже выбран, добавить если нет
        const idx = this.pendingNodes.findIndex(([nr, nc]) => nr === r && nc === c);
        if (idx >= 0) {
            this.pendingNodes.splice(idx, 1);
        } else {
            this.pendingNodes.push([r, c]);
        }

        // Подсветка накопленных узлов
        this._clearHighlights();
        if (this.pendingNodes.length) this._highlightNodes(this.pendingNodes);

        // Ещё не набрали все — ждём
        if (this.pendingNodes.length < patternLen) return;

        // Проверяем совпадение с валидной позицией
        const selSet = new Set(this.pendingNodes.map(([nr, nc]) => `${nr},${nc}`));
        const matchPos = placements => placements?.find(p => {
            const pos = new Set(p.chipPositions.map(([pr, pc]) => `${pr},${pc}`));
            return pos.size === selSet.size && [...pos].every(k => selSet.has(k));
        });

        const reset = () => { this.pendingNodes = []; this._clearHighlights(); };

        // Синтез: позиция первой карты
        if (this.synth?.step === 'placeA') {
            const match = matchPos(this.synth.placementsA);
            if (!match) { this._showMessage('Паттерн не совпадает'); reset(); return; }
            this.synth.matchA = match;
            this.synth.step = 'selectB';
            reset();
            this._render();
            this._showMessage('Выберите вторую карту для синтеза');
            return;
        }

        // Синтез: позиция второй карты
        if (this.synth?.step === 'placeB') {
            const match = matchPos(this.currentPlacements);
            if (!match) { this._showMessage('Паттерн не совпадает'); reset(); return; }
            this.synth.matchB = match;
            this.synth.step = 'chooseOrder';
            reset();
            this.placementPanel.classList.add('hidden');
            this._showSynthOrderPanel();
            return;
        }

        // Обычный розыгрыш
        const match = matchPos(this.currentPlacements);
        if (!match) { this._showMessage('Паттерн не совпадает'); reset(); return; }
        reset();
        this.placementPanel.classList.add('hidden');
        const card = this.pendingCard;
        this.pendingCard = null;
        this.tm.playCard(card, match, result => {
            if (!result) { this._haptic(26); this._playSound('play'); }
            this._render();
            if (result === 'limitReached') this._showMessage('Лимит задач (2) исчерпан');
        });
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
        this._render();
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
        const nextPI = this.state.currentPI;  // already advanced by _endTurn
        const playerColor = this._playerColor(s.playerIdx);
        const nextColor = this._playerColor(nextPI);

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
            `Передайте устройство<br><span style="color:${nextColor}">Игроку ${nextPI + 1}</span>`;

        this.handoffScreen.classList.remove('hidden');

        // Glitch entrance on "Передайте устройство" text
        const nextEl = document.getElementById('handoff-next');
        nextEl.classList.remove('glitch');
        requestAnimationFrame(() => nextEl.classList.add('glitch'));
        setTimeout(() => nextEl.classList.remove('glitch'), 750);
    }

    _onHandoffOk() {
        this.handoffScreen.classList.add('hidden');
        if (this._handoffCallback) {
            const cb = this._handoffCallback;
            this._handoffCallback = null;
            cb();
        } else {
            this.tm.replenish();
        }
    }

    // Контекст для модала/handoff: кто инициировал, какая карта, какой эффект
    _buildChoiceContext(targetPI, count) {
        const inp = this.input;
        const actorPI = this.state.currentPI;
        const card = inp.sourceCard;
        const mode = inp.sourceMode;       // 'play' | 'utilize' | 'synth'
        const kind = inp.actionKind;       // 'reveal' | 'discard' | 'dig'
        const targetIsActor = targetPI === actorPI;

        const modeLabel = mode === 'play' ? 'разыграл'
                        : mode === 'utilize' ? 'утилизировал'
                        : mode === 'synth' ? 'провёл синтез'
                        : 'разыграл';

        // Что должен сделать целевой игрок
        const cnt = count;
        const cardWord = cnt === 1 ? 'карту' : cnt < 5 ? 'карты' : 'карт';
        const one = cnt === 1;
        let actionLabel, instruction, consequence;
        if (kind === 'reveal') {
            actionLabel = `раскрыть ${cnt} ${cardWord}`;
            instruction = `Выбери ${cnt} ${cardWord} из своей руки чтобы раскрыть`;
            consequence = one
                ? `⚠ Эта карта будет видна противнику · любой игрок сможет её разыграть в свой ход`
                : `⚠ Эти карты будут видны противнику · любой игрок сможет их разыграть в свой ход`;
        } else if (kind === 'discard') {
            actionLabel = `сбросить ${cnt} ${cardWord}`;
            instruction = `Выбери ${cnt} ${cardWord} из своей руки чтобы сбросить`;
            consequence = one
                ? `⚠ Эта карта уйдёт в сброс и пропадёт из твоей руки`
                : `⚠ Эти карты уйдут в сброс и пропадут из твоей руки`;
        } else if (kind === 'dig') {
            actionLabel = `выбрать ${cnt} из ${cnt + 2}`;
            instruction = `Выбери ${cnt} ${cardWord} чтобы оставить себе`;
            consequence = `✓ Выбранные карты попадут в руку · остальные уйдут в сброс`;
        } else {
            actionLabel = `выбрать ${cnt}`;
            instruction = `Выбери ${cnt} ${cardWord}`;
            consequence = '';
        }

        return {
            actorPI, targetPI, targetIsActor,
            cardName: card?.name ?? '',
            cardCost: card?.cost,
            modeLabel, actionLabel, instruction, consequence, kind, count,
        };
    }

    // Показать экран передачи устройства игроку pi, затем вызвать callback
    _showHandoffForChoice(pi, callback, ctx) {
        const color = this._playerColor(pi);
        const actorColor = ctx ? this._playerColor(ctx.actorPI) : '#aaccff';

        if (ctx?.backToActor) {
            // Возврат устройства активному игроку после выбора противника
            document.getElementById('handoff-player').innerHTML = 'Выбор сделан';
            document.getElementById('handoff-summary').innerHTML =
                `<span style="opacity:0.85">Передайте устройство обратно</span>`;
        } else if (ctx) {
            // Передача противнику для выбора
            document.getElementById('handoff-player').innerHTML =
                `<span style="color:${actorColor}">Игрок ${ctx.actorPI + 1}</span> ${ctx.modeLabel}` +
                (ctx.cardName ? ` <span style="color:#c8dcff">«${ctx.cardName}»</span>` : '');
            document.getElementById('handoff-summary').innerHTML =
                `<span style="color:${color}">Игроку ${pi + 1}</span> нужно <b>${ctx.actionLabel}</b>`;
        } else {
            document.getElementById('handoff-player').innerHTML = 'Передайте устройство';
            document.getElementById('handoff-summary').innerHTML = '&nbsp;';
        }

        document.getElementById('handoff-next').innerHTML =
            `Передайте устройство<br><span style="color:${color}">Игроку ${pi + 1}</span>`;
        this._handoffCallback = callback;
        this.handoffScreen.classList.remove('hidden');

        const nextEl = document.getElementById('handoff-next');
        nextEl.classList.remove('glitch');
        requestAnimationFrame(() => nextEl.classList.add('glitch'));
        setTimeout(() => nextEl.classList.remove('glitch'), 750);
    }

    // ── Game over ──────────────────────────────────────────────

    _onGameOver(winner) {
        const st = this.state;
        const winColor = this._playerColor(winner);
        const scores = st.players.map((p, i) =>
            `<span style="color:${this._playerColor(i)}">${p.score}</span>`
        ).join(' — ');
        this.gameOverText.innerHTML =
            `🏆 <span style="color:${winColor}">Игрок ${winner + 1}</span> победил!<br>` +
            `<span style="font-size:18px">${scores}</span>`;
        this.gameOverScreen.classList.remove('hidden');
    }

    // ── Card pick modal ────────────────────────────────────────

    _showCardPick(pi, cards, count, done, ctx) {
        this._cardPickDone = done;
        this._cardPickRequired = count;
        this._cardPickSelected = [];

        // Заголовок: контекст источника + конкретная инструкция + последствие
        if (ctx) {
            const targetColor = this._playerColor(pi);
            const actorColor = this._playerColor(ctx.actorPI);
            const sourceLine = ctx.cardName
                ? `<span style="color:${actorColor}">Игрок ${ctx.actorPI + 1}</span> ${ctx.modeLabel} <span style="color:#c8dcff">«${ctx.cardName}»</span>`
                : `<span style="color:${actorColor}">Игрок ${ctx.actorPI + 1}</span>`;
            const consequenceColor = ctx.kind === 'dig' ? '#88cc99' : '#e0a860';
            const consequenceLine = ctx.consequence
                ? `<div style="font-size:10.5px;color:${consequenceColor};font-weight:500;margin-top:6px;line-height:1.4;letter-spacing:0.01em">${ctx.consequence}</div>`
                : '';
            this.cardPickTitle.innerHTML =
                `<div style="font-size:11px;color:#7a8aaa;font-weight:600;margin-bottom:6px;letter-spacing:0.03em">${sourceLine}</div>` +
                `<div style="font-size:15px;color:${targetColor};font-weight:700">${ctx.instruction}</div>` +
                consequenceLine;
        } else {
            this.cardPickTitle.textContent = `Игрок ${pi + 1}: выберите ${count} карт${count === 1 ? 'у' : 'ы'}`;
        }
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

    _rotateDetail(delta) {
        this._detailRotation = (this._detailRotation + delta + 360) % 360;
        const svg = document.querySelector('#detail-pattern svg');
        if (svg) svg.style.transform = `rotate(${this._detailRotation}deg)`;
    }

    _showCardDetail(card) {
        this._detailRotation = 0;
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

    // ── In-game menu ───────────────────────────────────────────

    _showIngameMenu() { document.getElementById('ingame-menu').classList.remove('hidden'); }
    _hideIngameMenu() { document.getElementById('ingame-menu').classList.add('hidden'); }

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
    // Show menu on first load; _startGame() called by menu buttons
});
