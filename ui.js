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

        // ── Online / network mode ──
        this.netMode = null;     // null | 'host' | 'guest'
        this.localPI = 0;        // host → 0 (P1), guest → 1 (P2)
        this.net = null;         // Net instance
        this.cardsById = null;   // Map<id, cardObj> — для восстановления state на госте
        this._netGameOverShown = false;
        this._netPendingInputs = new Map(); // guest: reqId → контекст активного модала

        this._bindElements();
        this._initAudio();
    }

    _bindElements() {
        this.boardEl = document.getElementById('board');
        // KIT Phase 3 — compact HUD elements
        this.turnTagEl = document.getElementById('turn-tag');
        this.playerTagEl = document.getElementById('player-tag');
        this.oppScoresEl = document.getElementById('opp-scores');
        this.curScoreEl = document.getElementById('cur-score');
        this.curScoreMaxEl = document.getElementById('cur-score-max');
        this.phaseStepperEl = document.getElementById('phase-stepper');
        this.deckCountEl = document.getElementById('deck-count');
        this.discardCountEl = document.getElementById('discard-count');
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
        // FIX-16: skip glitch animation on any tap — reveal next player instantly
        this.handoffScreen.addEventListener('pointerdown', () => {
            const nextEl = document.getElementById('handoff-next');
            if (nextEl && nextEl.classList.contains('glitch')) {
                nextEl.classList.remove('glitch');
            }
        }, { capture: true });

        // Game over screen
        this.gameOverScreen = document.getElementById('gameover-screen');
        this.gameOverText = document.getElementById('gameover-text');
        document.getElementById('btn-play-again').onclick = () => this._startGame(this._playerCount);
        document.getElementById('btn-gameover-menu').onclick = () => this._showMenu();

        // Rules screen
        document.getElementById('btn-show-rules').onclick = () => document.getElementById('rules-screen').classList.remove('hidden');
        document.getElementById('btn-rules-close').onclick = () => document.getElementById('rules-screen').classList.add('hidden');
        // Rules tabs
        document.querySelectorAll('.rules-tab').forEach(btn => {
            btn.onclick = () => {
                const idx = btn.dataset.pane;
                document.querySelectorAll('.rules-tab').forEach(t => t.classList.toggle('active', t.dataset.pane === idx));
                document.querySelectorAll('.rules-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === idx));
            };
        });

        // In-game menu
        document.getElementById('btn-ingame-menu').onclick = () => this._showIngameMenu();
        document.getElementById('btn-to-menu').onclick = () => { this._hideIngameMenu(); this._showMenu(); };
        document.getElementById('btn-restart').onclick = () => { this._hideIngameMenu(); this._startGame(this._playerCount); };
        document.getElementById('btn-close-ingame-menu').onclick = () => this._hideIngameMenu();
        document.getElementById('ingame-menu').addEventListener('click', e => { if (e.target.id === 'ingame-menu') this._hideIngameMenu(); });

        // Menu screen
        this.menuScreen = document.getElementById('menu-screen');
        this._menuMode = 2;
        const btn2p = document.getElementById('btn-mode-2p');
        const btn3p = document.getElementById('btn-mode-3p');
        const setMenuMode = (n) => {
            this._menuMode = n;
            btn2p.classList.toggle('active', n === 2);
            btn3p.classList.toggle('active', n === 3);
        };
        btn2p.onclick = () => setMenuMode(2);
        btn3p.onclick = () => setMenuMode(3);
        document.getElementById('btn-initiate').onclick = () => this._startGame(this._menuMode);
        document.getElementById('btn-mode-online').onclick = () => this._showOnlineMenu();
        const cfgBtn = document.getElementById('btn-show-cfg');
        if (cfgBtn) cfgBtn.onclick = () => {};

        // Generate radar tick marks (24 marks, every 6th bolder)
        const radarSvg = document.getElementById('menu-radar-svg');
        if (radarSvg) {
            const svgNS = 'http://www.w3.org/2000/svg';
            for (let i = 0; i < 24; i++) {
                const a = (i / 24) * Math.PI * 2;
                const x1 = 140 + Math.cos(a) * 126;
                const y1 = 140 + Math.sin(a) * 126;
                const x2 = 140 + Math.cos(a) * 134;
                const y2 = 140 + Math.sin(a) * 134;
                const line = document.createElementNS(svgNS, 'line');
                line.setAttribute('x1', x1); line.setAttribute('y1', y1);
                line.setAttribute('x2', x2); line.setAttribute('y2', y2);
                line.setAttribute('stroke', 'var(--line-dim)');
                line.setAttribute('stroke-width', i % 6 === 0 ? 1.5 : 0.5);
                radarSvg.appendChild(line);
            }
        }

        // Online screens
        this.onlineScreen = document.getElementById('online-screen');
        this.onlineHostScreen = document.getElementById('online-host-screen');
        this.onlineJoinScreen = document.getElementById('online-join-screen');
        this.netOverlay = document.getElementById('net-overlay');
        this.netTurnIndicator = document.getElementById('net-turn-indicator');

        document.getElementById('btn-online-back').onclick = () => this._hideOnlineScreens();
        document.getElementById('btn-online-host').onclick = () => this._onHostClick();
        document.getElementById('btn-online-join').onclick = () => this._onJoinClick();
        document.getElementById('btn-online-host-cancel').onclick = () => this._cancelOnline();
        document.getElementById('btn-online-join-cancel').onclick = () => this._cancelOnline();
        document.getElementById('btn-online-join-confirm').onclick = () => this._onJoinConfirm();
        document.getElementById('btn-net-overlay-exit').onclick = () => this._exitOnlineGame();

        const joinInput = document.getElementById('online-join-input');
        joinInput.addEventListener('input', () => {
            const val = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
            joinInput.value = val;
            document.getElementById('btn-online-join-confirm').disabled = val.length !== 4;
        });
        joinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && joinInput.value.length === 4) this._onJoinConfirm();
        });

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

    _animateCounter(el, from, to, win, noSuffix = false) {
        const dur = 480, start = performance.now();
        const tick = now => {
            const p = Math.min((now - start) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            const val = Math.round(from + (to - from) * ease);
            el.textContent = noSuffix ? String(val) : `${val} / ${win}`;
            if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    _showMenu() {
        this.menuScreen.classList.remove('hidden');
        this.gameOverScreen.classList.add('hidden');
        this.handoffScreen.classList.add('hidden');
    }

    _startGame(playerCount = 2, netOpts = null) {
        this._playerCount = playerCount;
        const boardSize = playerCount === 3 ? 5 : 4;
        const winScore  = playerCount === 3 ? 20 : 15;

        // 3-player mode class on #app
        document.getElementById('app').classList.toggle('mode-3p', playerCount === 3);

        // Сетевой режим
        this.netMode = netOpts?.role ?? null;
        this.localPI = netOpts?.localPI ?? 0;
        this._netGameOverShown = false;

        // Guest: только оболочка UI, состояние придёт snapshot'ом
        if (this.netMode === 'guest') {
            this.cardsById = buildCardsById(playerCount);
            this._resetUiState();
            this.menuScreen.classList.add('hidden');
            this._hideOnlineScreens();
            this._buildBoard(boardSize);
            this._updateNetTurnIndicator();
            return;
        }

        this.state = new GameState(boardSize, winScore, playerCount);
        this.cardsById = buildCardsById(playerCount);
        const self = this;
        this.input = {
            chooseCards(pi, cards, count, done) {
                if (cards.length <= count) { done(cards); return; }
                const ctx = self._buildChoiceContext(pi, count);

                // Онлайн: всё определяется тем, кто target
                if (self.netMode === 'host') {
                    if (pi === self.localPI) {
                        self._showCardPick(pi, cards, count, done, ctx);
                    } else {
                        self.net.request('chooseCards', pi, ctx, {
                            cardIds: cards.map(c => c.id), count
                        }).then(chosenIds => {
                            const arr = Array.isArray(chosenIds) ? chosenIds : [];
                            const chosen = arr.map(id => cards.find(c => c.id === id)).filter(Boolean);
                            done(chosen.length === count ? chosen : cards.slice(0, count));
                        });
                    }
                    return;
                }

                if (pi !== self.state.currentPI) {
                    // Hot-seat: противник выбирает карты — передать устройство ему, затем вернуть
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
                if (self.netMode === 'host') {
                    if (pi === self.localPI) {
                        self._startNodePick(nodes, count, done);
                    } else {
                        self.net.request('chooseNodes', pi, null, {
                            nodes: nodes.map(([r, c]) => [r, c]), count
                        }).then(chosen => {
                            done(Array.isArray(chosen) ? chosen : nodes.slice(0, count));
                        });
                    }
                    return;
                }
                self._startNodePick(nodes, count, done);
            }
        };
        this.tm = new TurnManager(this.state, this.input);
        this.tm.onStateChanged = () => {
            this._render();
            if (this.netMode === 'host') this._hostSendState();
        };
        this.tm.onPhaseChanged = p => this._onPhaseChanged(p);
        this.tm.onGameOver = w => {
            this._onGameOver(w);
            if (this.netMode === 'host') this._hostSendGameOver(w);
        };

        // Reset UI state
        this._resetUiState();
        this.menuScreen.classList.add('hidden');
        this._hideOnlineScreens();

        this._buildBoard(boardSize);
        this._updateNetTurnIndicator();
        this.tm.replenish();
    }

    _resetUiState() {
        this._prevScores = [0, 0, 0];
        this._turnNumber = 1;
        this._matchStartTime = Date.now();
        this._lastRenderCurrentPI = undefined;
        this._cardRotations = new Map();
        this.pendingCard = null;
        this.pendingNodes = [];
        this.currentPlacements = [];
        this.nodePickDone = null;
        this.synth = null;
        this._lastTurnSummary = null;
        this.handoffScreen.classList.add('hidden');
        this.gameOverScreen.classList.add('hidden');
        this.placementPanel.classList.add('hidden');
        this.cardPickModal.classList.add('hidden');
        this.synthOrderPanel.classList.add('hidden');
    }

    _viewPI() {
        return this.netMode ? this.localPI : this.state.currentPI;
    }

    // ── Rendering ─────────────────────────────────────────────

    _playerColor(pi) {
        return ['#3fd0e6', '#ff6a2b', '#b76cff'][pi] ?? '#aaccff';
    }

    _render() {
        const st = this.state;
        const win = st.winScore;

        // KIT Phase 3 — Turn counter (total turns taken across all players)
        if (this._lastRenderCurrentPI !== st.currentPI) {
            if (this._lastRenderCurrentPI !== undefined) this._turnNumber = (this._turnNumber || 1) + 1;
            else this._turnNumber = this._turnNumber || 1;
            this._lastRenderCurrentPI = st.currentPI;
            // Snapshot all players' scores at turn start (for END summary gain calc)
            this._turnStartScores = st.players.map(p => p.score);
            // FIX-11: полный снимок для отчёта в end-turn
            this._turnStartSnapshot = {
                pi: st.currentPI,
                handSize: st.players[st.currentPI].hand.length,
                supply: st.players[st.currentPI].supply,
                chipsOnBoard: st.players[st.currentPI].chipsOnBoard,
                deckSize: st.deck?.cards?.length ?? 0,
            };
        }
        if (!this._turnNumber) this._turnNumber = 1;
        if (!this._turnStartScores) this._turnStartScores = st.players.map(p => p.score);

        // Compact header — turn tag + player tag + opp scores + current score
        if (this.turnTagEl) this.turnTagEl.textContent = 'T' + String(this._turnNumber).padStart(2, '0');
        const activePI = st.currentPI;
        // FIX-04: HUD data-player красит tier-1 через CSS
        const hudEl = document.getElementById('hud');
        if (hudEl) hudEl.dataset.player = `p${activePI + 1}`;
        if (this.playerTagEl) {
            // FIX-04: «ИГРОК N» вместо «P-0N»
            this.playerTagEl.textContent = `ИГРОК ${activePI + 1}`;
        }
        // FIX-04: tier-2 phase counter "ДЕЙСТВ 1/2" / "ЗАДАЧА 0/2"
        const phaseInfoEl = document.getElementById('hud-phase-info');
        if (phaseInfoEl) {
            const phaseName = st.phase === Phase.Replenish ? 'ВОСПОЛН'
                : st.phase === Phase.Action ? `ДЕЙСТВ ${st.chipsPlaced}/${st.chipsAllowed}`
                : st.phase === Phase.Task ? `▶ ${st.tasksThisTurn || 0}/2 · ✦ ${st.utilizesThisTurn || 0}/2`
                : 'КОНЕЦ';
            phaseInfoEl.textContent = phaseName;
        }
        // Opponent score chips
        if (this.oppScoresEl) {
            const chips = [];
            for (let i = 0; i < st.players.length; i++) {
                if (i === activePI) continue;
                chips.push(`<span class="p${i+1}">P${i+1}:${st.players[i].score}</span>`);
            }
            this.oppScoresEl.innerHTML = chips.join('');
        }
        // Active player score — animate on change
        const activeScore = st.players[activePI].score;
        const prevActiveScore = this._prevScores[activePI] ?? 0;
        if (activeScore > prevActiveScore && this.curScoreEl) {
            this._animateCounter(this.curScoreEl, prevActiveScore, activeScore, win, /*noSuffix*/ true);
        } else if (this.curScoreEl) {
            this.curScoreEl.textContent = String(activeScore);
        }
        for (let i = 0; i < st.players.length; i++) this._prevScores[i] = st.players[i].score;
        if (this.curScoreMaxEl) this.curScoreMaxEl.textContent = `/${win}`;

        this.deckCountEl.textContent = String(st.deck.count);
        this.discardCountEl.textContent = String(st.discard.length);

        // Phase stepper — map Replenish→0, Action→1, Task→2 (END=3 only during summary)
        const phaseIdx = st.phase === Phase.Replenish ? 0 : st.phase === Phase.Action ? 1 : st.phase === Phase.Task ? 2 : 3;
        if (this.phaseStepperEl) {
            for (const cell of this.phaseStepperEl.querySelectorAll('.ps-cell')) {
                const p = parseInt(cell.dataset.phase, 10);
                cell.classList.remove('current', 'past');
                if (p === phaseIdx) cell.classList.add('current');
                else if (p < phaseIdx) cell.classList.add('past');
            }
        }

        // Hand label per UX_SPEC §2.7: "◦ РУКА ··· N/5"
        const viewPI = this._viewPI();
        const playerColor = this._playerColor(viewPI);
        const handSize = st.players[this.netMode ? viewPI : st.currentPI].hand.length;
        const playerTag = this.netMode
            ? `Игрок ${viewPI + 1}`
            : `Игрок ${st.currentPI + 1}`;
        this.handLabelEl.innerHTML = `◦ РУКА · ${playerTag} <span style="color:var(--text-ghost)">··· ${handSize}/5</span> <span class="zone-hint">зажать = детали</span>`;
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
            const vp = st.players[this._viewPI()];
            const allCards = [...vp.hand, ...st.players.flatMap(p => p.revealed)];
            const hasPlayable = allCards.some(c => this.tm.getValidPlacements(c).length > 0);
            const hasHand = vp.hand.length > 0 || vp.revealed.length > 0;
            if (!hasHand)          skipBtn.textContent = '⏭ Завершить ход (нет карт)';
            else if (!hasPlayable) skipBtn.textContent = '⏭ Завершить ход (нет розыгрышей)';
            else                   skipBtn.textContent = '⏭ Завершить ход';
            // Primary когда нет розыгрышей/карт, ghost когда есть что делать
            skipBtn.classList.toggle('btn-primary', !hasPlayable);
            skipBtn.classList.toggle('btn-ghost', hasPlayable);
        }

        // Dynamic revealed labels
        const vpi = this._viewPI();
        const oppNums = st.players.map((_, i) => i + 1).filter(n => n !== vpi + 1);
        document.getElementById('opp-revealed-label').textContent =
            `◦ РАСКРЫТО · P-${oppNums.map(n => String(n).padStart(2, '0')).join(' · P-')}`;
        document.getElementById('own-revealed-label').textContent =
            `◦ РАСКРЫТО · P-${String(vpi + 1).padStart(2, '0')} (ВЫ)`;

        this._renderBoard();
        this._renderHand();
        this._renderRevealed();
        this._updateNetTurnIndicator();
    }

    _updatePhaseHint() {
        const st = this.state;
        let text = '';
        let tone = 'replenish';
        let counter = '';

        if (this.nodePickDone) {
            const n = this.nodePickRemaining;
            text = `Выбери ${n} узел${n === 1 ? '' : n < 5 ? 'а' : 'ов'} на доске`;
            tone = 'action';
        } else if (this.synth) {
            tone = 'synth';
            if (this.synth.step === 'selectB') {
                text = `⊕ Синтез 2/4 · выбери вторую карту для "${this.synth.cardA.name}"`;
            } else if (this.synth.step === 'placeB') {
                text = `⊕ Синтез 3/4 · выбери позицию для "${this.synth.cardB.name}"`;
            } else if (this.synth.step === 'chooseOrder') {
                text = `⊕ Синтез 4/4 · выбери порядок эффектов`;
            }
        } else if (st.phase === Phase.Replenish) {
            text = 'Добираем карты до запаса...';
            tone = 'replenish';
        } else if (st.phase === Phase.Action) {
            const chipsLeft = st.chipsAllowed - st.chipsPlaced;
            if (chipsLeft > 0) {
                const w = chipsLeft === 1 ? 'фишку' : chipsLeft < 5 ? 'фишки' : 'фишек';
                text = `Поставь ${chipsLeft} ${w} на поле`;
                tone = 'action';
                counter = `${chipsLeft}/${st.chipsAllowed}`;
            } else {
                text = '✓ Фишки поставлены · нажми «конец действий»';
                tone = 'ok';
            }
        } else if (st.phase === Phase.Task) {
            const t = st.tasksThisTurn, u = st.utilizesThisTurn;
            if (this.pendingCard) {
                const pl = this.pendingCard.pattern.length;
                text = `Тапни ${pl} фишк${pl===1?'у':pl<5?'и':'ек'} паттерна · или ✦ Утилизировать`;
                tone = 'action';
            } else {
                const allCards = [...st.cp.hand, ...st.players.flatMap(p => p.revealed)];
                const hasPlayable = allCards.some(c => this.tm.getValidPlacements(c).length > 0);
                const hasHand = st.cp.hand.length > 0 || st.cp.revealed.length > 0;
                if (!hasHand) {
                    text = `Карт нет · завершай ход`;
                    tone = 'replenish';
                } else if (!hasPlayable) {
                    text = `Розыгрыш невозможен · ✦ утилизируй или завершай ход`;
                    tone = 'action';
                } else {
                    text = `Выбери карту · ▶ разыграй или ✦ утилизируй`;
                    tone = 'task';
                    counter = `${t}/2 · ${u}/2`;
                }
            }
        }

        // Render hint bar with arrow + text + optional counter (kit proto pattern)
        const counterHTML = counter ? `<span class="hint-counter">${counter}</span>` : '';
        this.phaseHintEl.innerHTML = `<span class="hint-arrow">&gt;</span><span class="hint-text">${text}</span>${counterHTML}`;
        this.phaseHintEl.className = 'tone-' + tone;
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
        const vpi = this._viewPI();
        const pl = st.players[vpi];

        // Compute playable cards (own hand + all revealed)
        const playable = new Set();
        const allRevealed = st.players.flatMap(p => p.revealed);
        const canAct = !this.netMode || st.currentPI === this.localPI;
        if (canAct) {
            [...pl.hand, ...allRevealed].forEach(c => {
                if (this.tm.getValidPlacements(c).length > 0) playable.add(c);
            });
        }

        this._renderCardRow(this.handEl, pl.hand, playable, true, vpi);
    }

    _renderRevealed() {
        const st = this.state;
        const vpi = this._viewPI();
        const vp = st.players[vpi];
        const allRevealed = st.players.flatMap(p => p.revealed);
        const playable = new Set();
        const canAct = !this.netMode || st.currentPI === this.localPI;
        if (canAct) {
            [...vp.hand, ...allRevealed].forEach(c => {
                if (this.tm.getValidPlacements(c).length > 0) playable.add(c);
            });
        }
        // Own revealed: owner = view player
        this._renderCardRow(this.ownRevealedEl, vp.revealed, playable, true, vpi);

        // Opponent(s) revealed: render each card with its actual owner PI
        const oppPairs = [];
        st.players.forEach((p, i) => { if (i !== vpi) p.revealed.forEach(c => oppPairs.push({ card: c, pi: i })); });
        this.oppRevealedEl.innerHTML = '';
        oppPairs.forEach(({ card, pi }) => {
            const el = this._makeCardEl(card, playable.has(card), false, pi);
            this.oppRevealedEl.appendChild(el);
        });

        // Collapse empty revealed zones
        this.ownRevealedWrap.classList.toggle('collapsed', vp.revealed.length === 0);
        this.oppRevealedWrap.classList.toggle('collapsed', oppPairs.length === 0);
    }

    _renderCardRow(container, cards, playable, interactive, ownerPI) {
        container.innerHTML = '';
        cards.forEach(card => {
            const el = this._makeCardEl(card, playable.has(card), interactive, ownerPI);
            container.appendChild(el);
        });
    }

    _makeCardEl(card, isPlayable, interactive, ownerPI) {
        const el = document.createElement('div');
        el.className = 'card' + (isPlayable ? ' playable' : ' unplayable');
        if (typeof ownerPI === 'number') el.dataset.player = `p${ownerPI + 1}`;
        if (card === this.pendingCard) el.classList.add('selected');

        const storedRot = this._cardRotations.get(card.id) || 0;
        const cornerText = storedRot ? `↻${storedRot}°` : '◇◇◇';
        const cornerClass = storedRot ? 'card-corner rot' : 'card-corner';
        el.innerHTML = `
            <div class="card-header">
                <div class="card-cost">${card.cost}</div>
                <div class="${cornerClass}">${cornerText}</div>
            </div>
            <div class="card-pattern">${this._patternGridHTML(card.pattern)}</div>
            <div class="card-name">${card.name}</div>
        `;

        // Apply stored rotation to pattern grid
        if (storedRot) {
            const grid = el.querySelector('.card-pattern-grid');
            if (grid) grid.style.transform = `rotate(${storedRot}deg)`;
        }

        // UX_SPEC §2.7: click = rotate (TASK phase = selection instead)
        //   long-press 350ms = detail popup
        let didLongPress = false;
        const rotate = () => {
            const next = ((this._cardRotations.get(card.id) || 0) + 90) % 360;
            this._cardRotations.set(card.id, next);
            const grid = el.querySelector('.card-pattern-grid');
            if (grid) grid.style.transform = next ? `rotate(${next}deg)` : '';
            // Update corner tag
            const cornerEl = el.querySelector('.card-corner');
            if (cornerEl) {
                if (next === 0) {
                    cornerEl.className = 'card-corner';
                    cornerEl.textContent = '◇◇◇';
                } else {
                    cornerEl.className = 'card-corner rot';
                    cornerEl.textContent = `↻${next}°`;
                }
            }
            this._haptic(6);
        };

        el.addEventListener('click', () => {
            if (didLongPress) { didLongPress = false; return; }
            // In TASK phase: selection (existing behavior)
            if (this.state && this.state.phase === Phase.Task) {
                this._onCardTap(card, isPlayable);
                return;
            }
            // REFILL/END: no interaction per UX_SPEC line 427
            if (this.state && (this.state.phase === Phase.Refill || this.state.phase === Phase.End)) {
                return;
            }
            // ACTIONS or anywhere else: rotate
            rotate();
        });

        // Prevent text selection and context menu on long press
        el.addEventListener('selectstart', e => e.preventDefault());
        el.addEventListener('contextmenu', e => e.preventDefault());

        // Long press (touch + mouse) → floating popup above card, 350ms per UX_SPEC §2.7
        let pressTimer;
        const startPress = () => {
            pressTimer = setTimeout(() => {
                didLongPress = true;
                this._haptic(8);
                this._showCardPopup(card, el);
            }, 350);
        };
        const endPress = () => clearTimeout(pressTimer);
        el.addEventListener('touchstart', startPress, { passive: true });
        el.addEventListener('touchend', endPress, { passive: true });
        el.addEventListener('touchcancel', endPress, { passive: true });
        el.addEventListener('mousedown', startPress);
        el.addEventListener('mouseup', endPress);
        el.addEventListener('mouseleave', endPress);

        return el;
    }

    _showCardPopup(card, anchorEl) {
        // FIX-02: ownerPI берём с data-player атрибута карты-источника
        const dp = anchorEl?.dataset?.player;  // "p1" | "p2" | "p3"
        const ownerPI = dp ? (parseInt(dp.slice(1), 10) - 1) : undefined;
        // Remove existing popup
        document.getElementById('card-popup')?.remove();

        const popup = document.createElement('div');
        popup.id = 'card-popup';
        popup.innerHTML = `
            <div class="card-cost">${card.cost}</div>
            <div class="card-popup-name">${card.name}</div>
            <div class="card-pattern" style="display:flex;justify-content:center;margin:4px 0">${this._patternSVG(card.pattern, 56, ownerPI)}</div>
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

    // Inline HTML 3x3 grid per kit GameCard (strictly matches chips-cards.jsx)
    _patternGridHTML(pattern) {
        let html = '<div class="card-pattern-grid">';
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            const cell_data = pattern.find(p => p.row === r && p.col === c);
            let cls = 'empty';
            if (cell_data) cls = cell_data.type === CellType.W ? 'w' : 'g';
            html += `<div class="card-pattern-cell ${cls}"></div>`;
        }
        html += '</div>';
        return html;
    }

    _patternSVG(pattern, size = 48, ownerPI) {
        const cell = Math.floor((size - 8) / 3 - 2), gap = 2;
        // FIX-02: W = цвет владельца, G = нейтральный серый
        const ownerColor = (typeof ownerPI === 'number') ? this._playerColor(ownerPI) : '#ff6a2b';
        const enemyColor = '#4a5560'; // --enemy-neutral
        let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
        svg += `<rect width="${size}" height="${size}" fill="transparent"/>`;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            const x = 4 + c * (cell + gap), y = 4 + r * (cell + gap);
            const cell_data = pattern.find(p => p.row === r && p.col === c);
            if (cell_data) {
                const fill = cell_data.type === CellType.W ? ownerColor : enemyColor;
                svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`;
            } else {
                // empty → dashed ghost outline
                svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="transparent" stroke="#0e3542" stroke-width="0.5" stroke-dasharray="1.5 1.5"/>`;
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
        // Склонения: карта 1 / карты 2-4 / карт 5+
        const cardsWord = n => n === 1 ? 'карту' : n < 5 ? 'карты' : 'карт';
        const chipsWord = n => n === 1 ? 'фишку' : n < 5 ? 'фишки' : 'фишек';
        // Притяжательное «свой» для разных форм (свою фишку / свои фишки / своих фишек)
        const myOwn = (n, thingSingular) => {
            if (thingSingular === 'card') return n === 1 ? 'свою' : n < 5 ? 'свои' : 'своих';
            if (thingSingular === 'chip') return n === 1 ? 'свою' : n < 5 ? 'свои' : 'своих';
            return '';
        };
        return effect.effects.map(fx => {
            const self = fx.target === Target.Self || fx.target === undefined;
            const n = fx.n;
            const inf = n === Infinity;
            switch (fx.constructor.name) {
                case 'DrawCardsEffect':
                    return `возьми ${n} ${cardsWord(n)} из колоды`;
                case 'DigCardsEffect':
                    return `раскопай ${n} ${cardsWord(n)} (+2 в сброс)`;
                case 'PlaceChipsEffect':
                    return `поставь ${n} ${myOwn(n,'chip')} ${chipsWord(n)} на поле`;
                case 'RevealCardsEffect':
                    if (inf) return self ? 'раскрой ВСЮ свою руку' : 'противник раскроет ВСЮ руку';
                    return self ? `раскрой ${n} ${myOwn(n,'card')} ${cardsWord(n)}`
                                : `противник раскроет ${n} ${cardsWord(n)}`;
                case 'DiscardCardsEffect':
                    if (inf) return self ? 'сбрось ВСЮ свою руку' : 'противник сбросит ВСЮ руку';
                    return self ? `сбрось ${n} ${myOwn(n,'card')} ${cardsWord(n)}`
                                : `противник сбросит ${n} ${cardsWord(n)}`;
                case 'StealCardsEffect':
                    return `укради ${n} ${cardsWord(n)} у противника`;
                case 'ModifySupplyEffect': {
                    const sign = fx.delta > 0 ? '+' : '';
                    return self ? `${sign}${fx.delta} к своему запасу` : `${sign}${fx.delta} к запасу противника`;
                }
                case 'SetSupplyEffect':
                    return self ? `твой запас = ${fx.val}` : `запас противника = ${fx.val}`;
                case 'CopyOpponentSupplyEffect':
                    return 'твой запас = запасу противника';
                case 'ResetFieldEffect':
                    return 'убери все фишки с поля';
                default: return fx.constructor.name;
            }
        }).join(' · ');
    }

    // Развёрнутые описания — для peek-окна
    _fxLongText(effect) {
        return effect.effects.map(fx => {
            const self = fx.target === Target.Self || fx.target === undefined;
            const n = fx.n;
            const inf = n === Infinity;
            const tgtWho = self ? 'Ты' : 'Противник';
            const tgtWhose = self ? 'свою' : 'чужую';
            const tgtWhom = self ? 'тебе' : 'противнику';
            switch (fx.constructor.name) {
                case 'DrawCardsEffect':
                    return `${tgtWho} ${self?'берёшь':'берёт'} ${n} карт${n===1?'у':n<5?'ы':''} из колоды в руку.`;
                case 'DigCardsEffect':
                    return `Возьми ${n + 2} верхних карт колоды, выбери ${n} себе в руку, остальные уйдут в сброс.`;
                case 'PlaceChipsEffect':
                    return `Поставь ${n} сво${n===1?'ю':'их'} фишк${n===1?'у':n<5?'и':'ек'} на любые свободные узлы поля.`;
                case 'RevealCardsEffect':
                    if (inf) return `${tgtWho} выклад${self?'ываешь':'ывает'} ВСЮ руку лицом вверх в зону раскрытых. Любой игрок может разыграть их в свой ход.`;
                    return `${tgtWho} выбира${self?'ешь':'ет'} ${n} карт${n===1?'у':n<5?'ы':''} из руки и клад${self?'ёшь':'ёт'} лицом вверх в зону раскрытых. Раскрытые не считаются в руке при восполнении, но их может разыграть любой игрок.`;
                case 'DiscardCardsEffect':
                    if (inf) return `${tgtWho} сбрасыва${self?'ешь':'ет'} ВСЮ свою руку (включая раскрытые карты) в сброс.`;
                    return `${tgtWho} выбира${self?'ешь':'ет'} ${n} карт${n===1?'у':n<5?'ы':''} из руки и отправля${self?'ешь':'ет'} в сброс. Можно выбирать и раскрытые карты.`;
                case 'StealCardsEffect':
                    return `Возьми ${n} случайн${n===1?'ую':'ых'} карт${n===1?'у':n<5?'ы':''} из руки противника вслепую — они станут твоими.`;
                case 'ModifySupplyEffect': {
                    const sign = fx.delta > 0 ? '+' : '';
                    return `Измени запас ${tgtWhose === 'свою' ? 'себе' : 'противнику'} на ${sign}${fx.delta} (итог в диапазоне 2..6). Запас = на сколько карт добираешь до руки на фазе Восполнения.`;
                }
                case 'SetSupplyEffect':
                    return `Установи запас ${tgtWhom} равным ${fx.val} (диапазон 2..6). Запас = на сколько карт добирает игрок в фазе Восполнения.`;
                case 'CopyOpponentSupplyEffect':
                    return `Твой запас становится равен запасу противника (диапазон 2..6).`;
                case 'ResetFieldEffect':
                    return `Все фишки уходят с поля — каждый игрок забирает свои обратно в пул.`;
                default: return '';
            }
        }).filter(Boolean).join(' ');
    }

    // ── Board building ─────────────────────────────────────────

    _buildBoard(size = 4) {
        this.boardEl.innerHTML = '';
        this.boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        // Board uses 0 gap; connection lines drawn via SVG overlay
        this.boardEl.style.gap = '0';
        this.boardEl.style.padding = size === 5 ? '10px' : '14px';

        // SVG overlay with dashed connection lines between node centers (per kit ChipBoard)
        const unit = 100; // viewBox unit per cell
        const W = size * unit;
        let svg = `<svg id="board-lines" viewBox="0 0 ${W} ${W}" preserveAspectRatio="none">`;
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
            const cx = c * unit + unit / 2;
            const cy = r * unit + unit / 2;
            if (c < size - 1) {
                svg += `<line x1="${cx}" y1="${cy}" x2="${cx + unit}" y2="${cy}" stroke="#0e3542" stroke-width="0.6" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>`;
            }
            if (r < size - 1) {
                svg += `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + unit}" stroke="#0e3542" stroke-width="0.6" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>`;
            }
        }
        svg += '</svg>';
        this.boardEl.insertAdjacentHTML('beforeend', svg);

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

        // Онлайн: блокируем действия, когда ход соперника
        if (this.netMode && this.state.currentPI !== this.localPI) return;

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
        if (this.netMode && this.state.currentPI !== this.localPI) return;

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
                // FIX-06: подсветить все валидные фишки — объединение chipPositions
                const allChips = new Set();
                for (const p of placements) {
                    for (const [r, c] of p.chipPositions) allChips.add(`${r},${c}`);
                }
                const positions = [...allChips].map(s => s.split(',').map(Number));
                this._highlightNodes(positions);
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
        if (this.netMode && this.state.currentPI !== this.localPI) return;
        const st = this.state;
        const chipsLeft = st.chipsAllowed - st.chipsPlaced;
        const btn = document.getElementById('btn-end-action');
        if (chipsLeft > 0 && !this._endActionConfirm) {
            // Первый тап — предупреждение. Второй тап в течение 3 сек подтверждает.
            this._endActionConfirm = true;
            const word = chipsLeft === 1 ? 'фишку' : chipsLeft < 5 ? 'фишки' : 'фишек';
            btn.textContent = `⚠ Не поставил ${chipsLeft} ${word} · тапни ещё раз`;
            btn.style.background = 'linear-gradient(135deg, #ff9944, #d46a1e)';
            btn.style.color = '#111';
            if (navigator.vibrate) navigator.vibrate(30);
            clearTimeout(this._endActionTimer);
            this._endActionTimer = setTimeout(() => {
                this._endActionConfirm = false;
                btn.textContent = '✓ Конец действий';
                btn.style.background = '';
                btn.style.color = '';
            }, 3000);
            return;
        }
        this._endActionConfirm = false;
        clearTimeout(this._endActionTimer);
        btn.textContent = '✓ Конец действий';
        btn.style.background = '';
        btn.style.color = '';
        this.tm.endAction();
    }

    _onUtilize() {
        if (this.nodePickDone) return;
        if (this.netMode && this.state.currentPI !== this.localPI) return;
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
        if (this.netMode && this.state.currentPI !== this.localPI) return;
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
        if (this.netMode && this.state.currentPI !== this.localPI) return;
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
        if (this.netMode && this.state.currentPI !== this.localPI) return;
        const st = this.state;
        // FIX-11: полный снимок итога хода
        const snap = this._turnStartSnapshot;
        const p = st.cp;
        const summary = {
            playerIdx: st.currentPI,
            tasks: st.tasksThisTurn,
            utilizes: st.utilizesThisTurn,
            score: p.score,
            prevScore: this._turnStartScores?.[st.currentPI] ?? p.score,
            chipsPlaced: st.chipsPlaced,
            chipsOnBoard: p.chipsOnBoard,
            handSize: p.hand.length,
            handDelta: (snap && snap.pi === st.currentPI) ? (p.hand.length - snap.handSize) : null,
            supply: p.supply,
            supplyDelta: (snap && snap.pi === st.currentPI) ? (p.supply - snap.supply) : null,
            deckSize: st.deck?.cards?.length ?? 0,
            discardSize: st.deck?.discard?.length ?? 0,
        };
        const ok = this.tm.endTurn();
        if (ok === true || ok === 'ok' || this.netMode === 'guest') {
            this._haptic([12, 8, 32]);
            this._playSound('turn');
            this._lastTurnSummary = summary;
            this.pendingCard = null;
            this.placementPanel.classList.add('hidden');
            this._clearHighlights();
            this._render();
            if (this.netMode === 'host') {
                // Онлайн: без handoff, авто-восполнение для следующего игрока
                if (this.state.phase === Phase.Replenish) this.tm.replenish();
            } else if (this.netMode === 'guest') {
                // На guest ничего — ждём snapshot от host
            } else {
                this._showHandoff();
            }
        }
    }

    // ── Placement panel ────────────────────────────────────────

    // FIX-20: HUD-стиль panel — карта, шапка, рот-нав, primary-кнопка
    _showCardSelectedPanel() {
        const inSynthB = this.synth?.step === 'placeB';
        const card = this.pendingCard;
        const placements = this.currentPlacements || [];
        const total = placements.length;
        const idx = this.placementIndex || 0;

        // Card preview (left side)
        const preview = document.getElementById('pp-card-preview');
        if (preview && card) {
            const ownerPI = this.state.currentPI;
            const color = this._playerColor(ownerPI);
            const rot = this._cardRotations.get(card.id) || 0;
            const rotTxt = rot ? `↻${rot}°` : '0°';
            let patternCells = '';
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
                const cd = card.pattern.find(p => p.row === r && p.col === c);
                const cls = cd ? (cd.type === CellType.W ? 'w' : 'g') : '';
                patternCells += `<span class="${cls}"></span>`;
            }
            preview.style.color = color;
            preview.innerHTML = `
                <div class="pp-card-top">
                    <span class="pp-card-cost">${card.cost}</span>
                    <span class="pp-card-rot">${rotTxt}</span>
                </div>
                <div class="pp-card-pattern">${patternCells}</div>
                <div class="pp-card-name">${card.name}</div>
            `;
        }

        // Hint — описание эффекта розыгрыша
        const hintEl = document.getElementById('pp-hint');
        if (hintEl && card) {
            const fx = card.playEffect;
            if (fx && fx.hasEffects) {
                hintEl.classList.remove('empty');
                hintEl.innerHTML = `▶ ${this._fxText(fx)}`;
            } else {
                hintEl.classList.add('empty');
                hintEl.textContent = '▶ эффекта розыгрыша нет';
            }
        }

        // Header counter + rotnav
        const headerCount = document.getElementById('pp-count-header');
        if (headerCount) headerCount.textContent = `${Math.min(idx + 1, total)}/${total}`;
        const rotLbl = document.getElementById('placement-count');
        if (rotLbl) rotLbl.textContent = `ВАРИАНТ ${Math.min(idx + 1, total)} / ${total}`;
        const rotNav = document.getElementById('pp-rotnav');
        if (rotNav) rotNav.classList.toggle('hidden', total <= 1);

        // Primary "▶ РАЗЫГРАТЬ" — в SynthB он не работает (там auto-confirm по фишкам)
        const confirmBtn = document.getElementById('btn-confirm');
        if (confirmBtn) {
            confirmBtn.style.display = total > 0 ? '' : 'none';
            confirmBtn.disabled = total === 0;
        }

        // Synth — только если возможна вторая карта-партнёр
        const canSynth = !inSynthB
            && this.state.tasksThisTurn < 2
            && this.pendingCard
            && this._hasSynthPartner(this.pendingCard);
        const synthBtn = document.getElementById('btn-synth');
        if (synthBtn) synthBtn.style.display = canSynth ? '' : 'none';

        // Cancel — unified: всегда "✕ ОТМЕНА" в шапке (синтез-отмена тоже через неё)
        const cancelBtn = document.getElementById('btn-synth-cancel');
        if (cancelBtn) {
            cancelBtn.textContent = inSynthB ? '✕ ОТМЕНА СИНТЕЗА' : '✕ ОТМЕНА';
            cancelBtn.style.display = '';
        }

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

        // FIX-07: тап по пустому узлу в режиме паттерна — невалидно, явная обратная связь
        if (this.state.board.nodes[r][c] === Occ.Empty) {
            this._feedbackInvalidTap(r, c, 'Тапни фишку из паттерна');
            return;
        }

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
        // FIX-07: вместо тихого сброса — откат последнего тапа + shake + toast
        const rollbackLast = () => {
            const last = this.pendingNodes.pop();
            this._clearHighlights();
            if (this.pendingNodes.length) this._highlightNodes(this.pendingNodes);
            if (last) this._feedbackInvalidTap(last[0], last[1], 'Паттерн не совпадает');
            else { this._shakeBoard(); this._showMessage('Паттерн не совпадает', { error: true }); }
        };

        // Синтез: позиция первой карты
        if (this.synth?.step === 'placeA') {
            const match = matchPos(this.synth.placementsA);
            if (!match) { rollbackLast(); return; }
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
            if (!match) { rollbackLast(); return; }
            this.synth.matchB = match;
            this.synth.step = 'chooseOrder';
            reset();
            this.placementPanel.classList.add('hidden');
            this._showSynthOrderPanel();
            return;
        }

        // Обычный розыгрыш
        const match = matchPos(this.currentPlacements);
        if (!match) { rollbackLast(); return; }
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
        if (!this.currentPlacements?.length) return;
        this.placementIndex = (this.placementIndex - 1 + this.currentPlacements.length) % this.currentPlacements.length;
        this._updatePlacementHighlight();
    }

    _nextPlacement() {
        if (!this.currentPlacements?.length) return;
        this.placementIndex = (this.placementIndex + 1) % this.currentPlacements.length;
        this._updatePlacementHighlight();
    }

    // FIX-20: обновить подсветку текущего варианта и счётчики в panel
    _updatePlacementHighlight() {
        const total = this.currentPlacements?.length || 0;
        const idx = this.placementIndex || 0;
        const headerCount = document.getElementById('pp-count-header');
        if (headerCount) headerCount.textContent = `${Math.min(idx + 1, total)}/${total}`;
        const rotLbl = document.getElementById('placement-count');
        if (rotLbl) rotLbl.textContent = `ВАРИАНТ ${Math.min(idx + 1, total)} / ${total}`;
        // Подсветка конкретного варианта
        this._clearHighlights();
        const cur = this.currentPlacements?.[idx];
        if (cur) this._highlightNodes(cur.chipPositions);
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
        if (this.netMode) return;  // онлайн — handoff не нужен
        const s = this._lastTurnSummary;
        const nextPI = this.state.currentPI;  // already advanced by _endTurn

        const prev = s.prevScore ?? s.score;
        const gain = Math.max(0, s.score - prev);

        // FIX-09: data-player на корне — раскрашивает .hl-player
        this.handoffScreen.dataset.player = `p${s.playerIdx + 1}`;

        // Top label: "ИГРОК N · ХОД ЗАВЕРШЁН"
        document.getElementById('handoff-player').innerHTML =
            `<span class="hl-player">ИГРОК ${s.playerIdx + 1}</span> · ХОД ЗАВЕРШЁН`;

        // END panel: +gain + {prev}→{score}/win
        const gainEl = document.getElementById('handoff-gain');
        gainEl.textContent = gain > 0 ? `+${gain}` : `—`;
        gainEl.classList.toggle('zero', gain === 0);
        document.getElementById('handoff-delta').innerHTML =
            `<strong>${prev}</strong> → <strong>${s.score}</strong> / ${this.state.winScore}`;

        // Stats rows
        const tasksRow = document.getElementById('handoff-stat-tasks');
        const utilsRow = document.getElementById('handoff-stat-utils');
        tasksRow.querySelector('.hsr-val').textContent = s.tasks || 0;
        tasksRow.classList.toggle('zero', !s.tasks);
        utilsRow.querySelector('.hsr-val').textContent = s.utilizes || 0;
        utilsRow.classList.toggle('zero', !s.utilizes);

        // FIX-11: расширенные метрики с дельтами
        const setStatRow = (id, val, isZero) => {
            const row = document.getElementById(id);
            if (!row) return;
            row.querySelector('.hsr-val').innerHTML = val;
            row.classList.toggle('zero', !!isZero);
        };
        const fmtDelta = d => {
            if (d == null || d === 0) return '';
            const sign = d > 0 ? '+' : '';
            const color = d > 0 ? 'var(--ok)' : 'var(--danger)';
            return ` <span style="color:${color};font-weight:500">${sign}${d}</span>`;
        };
        setStatRow('handoff-stat-chips', `${s.chipsOnBoard ?? 0}`, !s.chipsOnBoard);
        setStatRow('handoff-stat-hand', `${s.handSize ?? 0}${fmtDelta(s.handDelta)}`, false);
        setStatRow('handoff-stat-supply', `${s.supply ?? '—'}${fmtDelta(s.supplyDelta)}`, false);
        setStatRow('handoff-stat-deck', `${s.deckSize ?? 0} / ${s.discardSize ?? 0}`, false);

        // Next player prompt (свой data-player — следующий игрок)
        const nextEl0 = document.getElementById('handoff-next');
        nextEl0.dataset.player = `p${nextPI + 1}`;
        nextEl0.innerHTML =
            `<span class="hn-prompt">&gt; Передать устройство</span>` +
            `<span class="hn-player player-title">Игрок ${nextPI + 1}</span>`;

        this.handoffScreen.classList.remove('hidden');

        // Glitch entrance on next-player line
        const nextEl = document.getElementById('handoff-next');
        nextEl.classList.remove('glitch');
        requestAnimationFrame(() => nextEl.classList.add('glitch'));
        setTimeout(() => nextEl.classList.remove('glitch'), 450);
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
        // FIX-09: data-player на корне — по целевому игроку
        this.handoffScreen.dataset.player = `p${pi + 1}`;

        const playerEl = document.getElementById('handoff-player');
        if (ctx?.backToActor) {
            // Возврат устройства активному игроку после выбора противника
            playerEl.innerHTML = 'Выбор сделан';
            playerEl.dataset.player = `p${ctx.actorPI + 1}`;
            document.getElementById('handoff-summary').innerHTML =
                `<span style="opacity:0.85">Передайте устройство обратно</span>`;
        } else if (ctx) {
            // Передача противнику для выбора
            playerEl.dataset.player = `p${ctx.actorPI + 1}`;
            playerEl.innerHTML =
                `<span class="player-title">Игрок ${ctx.actorPI + 1}</span> ${ctx.modeLabel}` +
                (ctx.cardName ? ` <span style="color:#c8dcff">«${ctx.cardName}»</span>` : '');
            const summaryEl = document.getElementById('handoff-summary');
            summaryEl.dataset.player = `p${pi + 1}`;
            summaryEl.innerHTML =
                `<span class="player-title">Игроку ${pi + 1}</span> нужно <b>${ctx.actionLabel}</b>`;
        } else {
            playerEl.innerHTML = 'Передайте устройство';
            playerEl.removeAttribute('data-player');
            document.getElementById('handoff-summary').innerHTML = '&nbsp;';
        }

        const nextEl2 = document.getElementById('handoff-next');
        nextEl2.dataset.player = `p${pi + 1}`;
        nextEl2.innerHTML =
            `Передайте устройство<br><span class="player-title">Игроку ${pi + 1}</span>`;
        this._handoffCallback = callback;
        this.handoffScreen.classList.remove('hidden');

        const nextEl = document.getElementById('handoff-next');
        nextEl.classList.remove('glitch');
        requestAnimationFrame(() => nextEl.classList.add('glitch'));
        setTimeout(() => nextEl.classList.remove('glitch'), 450);
    }

    // ── Game over ──────────────────────────────────────────────

    _onGameOver(winner) {
        const st = this.state;
        const winScore = st.winScore;
        const winnerScore = st.players[winner].score;

        // FIX-09: data-player на корне — цвет через CSS-переменные
        this.gameOverScreen.dataset.player = `p${winner + 1}`;

        // Title "ПОБЕДА" — цвет наследуется через .player-title внутри
        this.gameOverText.textContent = 'ПОБЕДА';
        this.gameOverText.classList.add('player-title');
        this.gameOverText.style.color = '';
        this.gameOverText.style.textShadow = '';

        // Sub: "P-0N · score/win PTS"
        document.getElementById('gameover-sub').innerHTML =
            `<span class="player-title">P-${String(winner+1).padStart(2,'0')}</span> · ${winnerScore}/${winScore} PTS`;

        // Ring ticks (36 ticks, every 9th bolder)
        const ticks = document.getElementById('gameover-ticks');
        if (ticks && !ticks.dataset.done) {
            let svg = '';
            for (let i = 0; i < 36; i++) {
                const a = (i / 36) * Math.PI * 2;
                const x1 = 120 + Math.cos(a) * 96;
                const y1 = 120 + Math.sin(a) * 96;
                const x2 = 120 + Math.cos(a) * 102;
                const y2 = 120 + Math.sin(a) * 102;
                const w = i % 9 === 0 ? 2 : 0.5;
                svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--accent)" stroke-width="${w}"/>`;
            }
            ticks.innerHTML = svg;
            ticks.dataset.done = '1';
        }

        // MATCH.LOG
        const rows = [];
        const turns = this._turnNumber || 1;
        rows.push({ label: 'TURNS', val: String(turns) });
        rows.push({ label: 'SCORE', val: `${winnerScore}/${winScore}`, hot: true });
        st.players.forEach((p, i) => {
            if (i !== winner) rows.push({ label: `P-${String(i+1).padStart(2,'0')} SCORE`, val: `${p.score}/${winScore}` });
        });
        if (this._totalCardsPlayed != null) rows.push({ label: 'CARDS PLAYED', val: String(this._totalCardsPlayed) });
        if (this._totalSyntheses != null) rows.push({ label: 'SYNTHESES', val: String(this._totalSyntheses) });

        document.getElementById('gameover-log-rows').innerHTML = rows.map(r => `
            <div class="gameover-stat ${r.hot ? 'hot' : ''}">
                <span class="gs-label">${r.label}</span>
                <span class="gs-sep"></span>
                <span class="gs-val">${r.val}</span>
            </div>
        `).join('');

        this.gameOverScreen.classList.remove('hidden');
    }

    // ── Card pick modal ────────────────────────────────────────

    _showCardPick(pi, cards, count, done, ctx) {
        this._cardPickDone = done;
        this._cardPickRequired = count;
        this._cardPickSelected = [];

        // Заголовок: контекст источника + конкретная инструкция + последствие
        if (ctx) {
            // FIX-09: data-player на модалке = цвет целевого игрока (.player-title)
            this.cardPickModal.dataset.player = `p${pi + 1}`;
            const sourceLine = ctx.cardName
                ? `<span data-player="p${ctx.actorPI + 1}" class="player-title" style="display:inline">ИГРОК ${ctx.actorPI + 1}</span> <span style="color:var(--text-dim)">${ctx.modeLabel}</span> <span style="color:var(--text);font-family:var(--display);letter-spacing:0.1em">«${ctx.cardName}»</span>`
                : `<span data-player="p${ctx.actorPI + 1}" class="player-title" style="display:inline">ИГРОК ${ctx.actorPI + 1}</span>`;
            const consequenceLine = ctx.consequence
                ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:0.15em;margin-top:6px;line-height:1.5;text-transform:uppercase">${ctx.consequence}</div>`
                : '';
            this.cardPickTitle.innerHTML =
                `<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.2em;margin-bottom:6px;text-transform:uppercase">${sourceLine}</div>` +
                `<div class="player-title" style="font-family:var(--display);font-size:15px;font-weight:600;letter-spacing:0.1em">${ctx.instruction}</div>` +
                consequenceLine;
        } else {
            // FIX-09: data-player по целевому игроку
            this.cardPickModal.dataset.player = `p${pi + 1}`;
            this.cardPickTitle.innerHTML =
                `<div style="font-family:var(--mono);font-size:9px;color:var(--accent);letter-spacing:0.2em;margin-bottom:4px">&gt; ВЫБОР КАРТ</div>` +
                `<div style="font-family:var(--display);font-size:15px;letter-spacing:0.1em"><span class="player-title">ИГРОК ${pi + 1}</span> · ВЫБЕРИ ${count}</div>`;
        }
        this.cardPickList.innerHTML = '';

        cards.forEach(card => {
            const item = document.createElement('div');
            item.className = 'pick-item';
            const fxLines = [];
            if (card.playEffect.hasEffects) fxLines.push(`▶ ${this._fxText(card.playEffect)}`);
            if (card.utilizeEffect.hasEffects) fxLines.push(`✕ ${this._fxText(card.utilizeEffect)}`);
            item.innerHTML =
                `<div class="pick-item-pattern">${this._patternSVG(card.pattern, 48, pi)}</div>` +
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
                this.cardPickCount.textContent = `${this._cardPickSelected.length} / ${count}`;
                this.cardPickConfirm.disabled = this._cardPickSelected.length !== count;
            });
            this.cardPickList.appendChild(item);
        });

        this.cardPickCount.textContent = `0 / ${count}`;
        this.cardPickConfirm.disabled = true;
        // FIX-08: portal — перенести в body, чтобы не наследовать stacking context родителя
        if (this.cardPickModal.parentElement !== document.body) {
            document.body.appendChild(this.cardPickModal);
        }
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

    _showCardDetail(card, ownerPI) {
        this._detailRotation = 0;
        document.getElementById('detail-name').textContent = card.name;
        document.getElementById('detail-cost').textContent = String(card.cost);
        document.getElementById('detail-pattern').innerHTML = this._patternSVG(card.pattern, 48, ownerPI);

        const renderFx = (type, icon, label, effect) => {
            if (!effect || !effect.hasEffects) return '';
            const short = this._fxText(effect);
            const long = this._fxLongText(effect);
            return `<div class="detail-fx fx-${type}">
                <div class="detail-fx-head">
                    <span class="dfh-icon">${icon}</span>
                    <span>${label}</span>
                </div>
                <div class="detail-fx-short">${short}</div>
                <div class="detail-fx-long">${long}</div>
            </div>`;
        };
        const blocks = [
            renderFx('play',  '▶', 'Розыгрыш',   card.playEffect),
            renderFx('util',  '✦', 'Утилизация', card.utilizeEffect),
            renderFx('synth', '⊕', 'Синтез',     card.synthesisEffect),
        ].filter(Boolean);
        const html = blocks.length
            ? blocks.join('')
            : `<div class="detail-fx-empty">◦ БЕЗ ЭФФЕКТОВ · ТОЛЬКО ОЧКИ ◦</div>`;
        document.getElementById('detail-effects').innerHTML = html;

        // FIX-08: portal в body
        if (this.cardDetail.parentElement !== document.body) {
            document.body.appendChild(this.cardDetail);
        }
        this.cardDetail.classList.remove('hidden');
    }

    // ── In-game menu ───────────────────────────────────────────

    _showIngameMenu() {
        // Update turn tag
        const turnEl = document.getElementById('pause-turn-tag');
        if (turnEl) turnEl.textContent = 'T' + String(this._turnNumber || 1).padStart(2, '0');

        // FIX-09: data-player на корне паузы — для .player-title внутри
        const ingameEl = document.getElementById('ingame-menu');
        if (ingameEl && this.state) ingameEl.dataset.player = `p${this.state.currentPI + 1}`;

        // FIX-10: снимок матча
        if (this.state) {
            const st = this.state;
            const phaseName = st.phase === Phase.Replenish ? 'ВОСПОЛНЕНИЕ'
                : st.phase === Phase.Action ? `ДЕЙСТВИЯ ${st.chipsPlaced}/${st.chipsAllowed}`
                : st.phase === Phase.Task ? `ЗАДАЧА ▶ ${st.tasksThisTurn || 0}/2 · ✦ ${st.utilizesThisTurn || 0}/2`
                : 'КОНЕЦ ХОДА';
            const elapsedMs = Date.now() - (this._matchStartTime || Date.now());
            const mm = Math.floor(elapsedMs / 60000);
            const ss = Math.floor((elapsedMs % 60000) / 1000);
            const active = st.players[st.currentPI];
            const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setEl('ps-phase', phaseName);
            setEl('ps-turn', `T${String(this._turnNumber || 1).padStart(2, '0')} / ИГРОК ${st.currentPI + 1}`);
            setEl('ps-active', `ИГРОК ${st.currentPI + 1} · ${active.score}/${st.winScore}`);
            setEl('ps-elapsed', `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
            const deckLen = st.deck?.cards?.length ?? st.deck?.length ?? 0;
            const discardLen = st.deck?.discard?.length ?? st.discard?.length ?? 0;
            setEl('ps-deck', `${deckLen} / ${discardLen}`);
            const supply = active.supply ?? '—';
            setEl('ps-hand', `${active.hand.length} карт · запас ${supply}`);
        }

        // Render HudRings for each player
        const ringsEl = document.getElementById('pause-rings');
        if (ringsEl && this.state) {
            const st = this.state;
            const win = st.winScore;
            const activePI = st.currentPI;
            ringsEl.innerHTML = st.players.map((p, i) => {
                const pct = Math.min(1, p.score / win);
                const r = 28, c = 2 * Math.PI * r;
                const dash = c * pct;
                const colorVar = i === activePI ? 'var(--accent)' : 'var(--line-dim)';
                const activeCls = i === activePI ? 'active' : '';
                return `
                <div class="pause-ring-item ${activeCls}">
                    <div class="hud-ring ${activeCls}">
                        <svg viewBox="0 0 64 64">
                            <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--line-ghost)" stroke-width="2"/>
                            <circle cx="32" cy="32" r="${r}" fill="none" stroke="${colorVar}" stroke-width="2"
                                stroke-dasharray="${dash} ${c - dash}" stroke-linecap="butt"/>
                        </svg>
                        <div class="ring-val">${p.score}</div>
                    </div>
                    <div class="ring-label">P-${String(i+1).padStart(2,'0')}</div>
                </div>`;
            }).join('');
        }

        document.getElementById('ingame-menu').classList.remove('hidden');
    }
    _hideIngameMenu() { document.getElementById('ingame-menu').classList.add('hidden'); }

    // ── Utils ──────────────────────────────────────────────────

    _showMessage(text, opts = {}) {
        const el = document.getElementById('toast');
        el.textContent = text;
        el.classList.remove('hidden');
        el.classList.toggle('toast-error', opts.error === true);
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('toast-error');
        }, opts.error ? 2400 : 2000);
    }

    // FIX-07: невалидный тап — красная вспышка на узле + shake доски + toast
    _feedbackInvalidTap(r, c, message) {
        const cell = this.boardEl?.querySelector?.(`.node[data-r="${r}"][data-c="${c}"]`);
        if (cell) {
            cell.classList.remove('invalid-tap');
            // reflow to restart animation
            void cell.offsetWidth;
            cell.classList.add('invalid-tap');
            setTimeout(() => cell.classList.remove('invalid-tap'), 500);
        }
        this._shakeBoard();
        this._haptic(32);
        if (message) this._showMessage(message, { error: true });
    }

    _shakeBoard() {
        const board = this.boardEl || document.getElementById('board');
        if (!board) return;
        board.classList.remove('shake');
        void board.offsetWidth;
        board.classList.add('shake');
        setTimeout(() => board.classList.remove('shake'), 360);
    }

    // ═══════════════════════════════════════════════════════════
    //  ONLINE / NETWORK
    // ═══════════════════════════════════════════════════════════

    _showOnlineMenu() {
        this.menuScreen.classList.add('hidden');
        this.onlineScreen.classList.remove('hidden');
    }

    _hideOnlineScreens() {
        this.onlineScreen?.classList.add('hidden');
        this.onlineHostScreen?.classList.add('hidden');
        this.onlineJoinScreen?.classList.add('hidden');
    }

    _showOnlineScreen(id) {
        this._hideOnlineScreens();
        document.getElementById(id).classList.remove('hidden');
    }

    async _onHostClick() {
        this._showOnlineScreen('online-host-screen');
        const codeEl = document.getElementById('online-host-code');
        const statusEl = document.getElementById('online-host-status');
        codeEl.textContent = '————';
        statusEl.innerHTML = '<div class="net-spinner" style="margin:0 auto 8px"></div>Инициализация...';

        this.net = new Net();
        this._wireNetCallbacks();

        try {
            const code = await this.net.hostGame();
            codeEl.textContent = code;
            statusEl.innerHTML = '<div class="net-spinner" style="margin:0 auto 8px"></div>Ожидаем соперника...';
        } catch (e) {
            statusEl.classList.add('error');
            statusEl.textContent = e.message || 'Ошибка создания игры';
            this.net?.disconnect();
            this.net = null;
        }
    }

    _onJoinClick() {
        this._showOnlineScreen('online-join-screen');
        const input = document.getElementById('online-join-input');
        const statusEl = document.getElementById('online-join-status');
        input.value = '';
        statusEl.textContent = '';
        statusEl.classList.remove('error');
        document.getElementById('btn-online-join-confirm').disabled = true;
        setTimeout(() => input.focus(), 100);
    }

    async _onJoinConfirm() {
        const input = document.getElementById('online-join-input');
        const statusEl = document.getElementById('online-join-status');
        const confirmBtn = document.getElementById('btn-online-join-confirm');
        const code = input.value.trim().toUpperCase();
        if (code.length !== 4) return;

        statusEl.classList.remove('error');
        statusEl.innerHTML = '<div class="net-spinner" style="margin:0 auto 8px"></div>Подключение...';
        confirmBtn.disabled = true;

        this.net = new Net();
        this._wireNetCallbacks();

        try {
            await this.net.joinGame(code);
            // Подключились — старт гостевой оболочки, ждём snapshot
            this._startGame(2, { role: 'guest', localPI: 1 });
            statusEl.textContent = 'Синхронизация...';
        } catch (e) {
            statusEl.classList.add('error');
            statusEl.textContent = e.message || 'Не удалось подключиться';
            confirmBtn.disabled = false;
            this.net?.disconnect();
            this.net = null;
        }
    }

    _cancelOnline() {
        if (this.net) { this.net.disconnect(); this.net = null; }
        this._hideOnlineScreens();
        this._showMenu();
    }

    _exitOnlineGame() {
        if (this.net) { this.net.disconnect(); this.net = null; }
        document.getElementById('net-overlay').classList.add('hidden');
        document.getElementById('net-turn-indicator').classList.add('hidden');
        this.netMode = null;
        this._showMenu();
    }

    _wireNetCallbacks() {
        const net = this.net;

        net.onPeerConnected = () => {
            if (net.role === 'host') {
                // Гость подключился — стартуем игру
                this._startGame(2, { role: 'host', localPI: 0 });
                // Первый snapshot отправится через onStateChanged после replenish()
            }
        };

        net.onReconnect = () => {
            document.getElementById('net-overlay').classList.add('hidden');
            if (net.role === 'host' && this.state) {
                this._hostSendState();  // пере-синк
            }
        };

        net.onDisconnect = () => {
            const overlay = document.getElementById('net-overlay');
            document.getElementById('net-overlay-title').textContent = 'Связь потеряна';
            document.getElementById('net-overlay-text').textContent = 'Пытаемся переподключиться...';
            overlay.classList.remove('hidden');
        };

        net.onError = (e) => {
            console.warn('[Net] error:', e);
        };

        net.onMessage = (msg) => {
            if (net.role === 'host') this._hostHandleMessage(msg);
            else this._guestHandleMessage(msg);
        };
    }

    // ── HOST side ──────────────────────────────────────────────

    _hostSendState() {
        if (!this.net || this.net.role !== 'host') return;
        // Маскируем руку хоста от гостя (localPI=0)
        const snap = serializeGameState(this.state, this.localPI);
        this.net.send({ type: 'state', snapshot: snap });
    }

    _hostSendGameOver(winner) {
        if (!this.net || this.net.role !== 'host') return;
        this._hostSendState();
        this.net.send({ type: 'game-over', winner });
    }

    _hostHandleMessage(msg) {
        if (msg.type === 'hello') {
            // Гость представился. Если есть state — отправим свежий snapshot
            if (this.state) this._hostSendState();
            return;
        }
        if (msg.type === 'action') {
            this._hostHandleAction(msg);
            return;
        }
        // input-res обрабатывается внутри Net через _pendingRequests
    }

    _hostHandleAction(msg) {
        if (!this.tm) return;
        const { name, args = [] } = msg;
        // В онлайне разрешаем действие только если currentPI совпадает с ролью отправителя.
        // Гость = pi 1. (Защита от мухлежа и рассинхрона.)
        const allowedPI = 1;
        if (this.state.currentPI !== allowedPI &&
            !['playCard', 'utilizeCard', 'synthesis'].includes(name)) {
            // Разрешаем только если ход гостя. Карточные действия на открытых картах
            // в будущем могут происходить в чужой ход, но сейчас — строго.
            if (this.state.currentPI !== allowedPI) return;
        }
        const cardsById = this.cardsById;
        try {
            switch (name) {
                case 'placeChip':   this.tm.placeChip(args[0], args[1]); break;
                case 'returnPiece': this.tm.returnPiece(args[0], args[1]); break;
                case 'undoChip':    this.tm.undoChip(args[0], args[1]); break;
                case 'endAction':   this.tm.endAction(); break;
                case 'endTurn':
                    if (this.tm.endTurn() && this.state.phase === Phase.Replenish) {
                        this.tm.replenish();
                    }
                    break;
                case 'replenish':   this.tm.replenish(); break;
                case 'playCard': {
                    const card = cardsById.get(args[0]);
                    if (card) this.tm.playCard(card, { chipPositions: args[1] });
                    break;
                }
                case 'utilizeCard': {
                    const card = cardsById.get(args[0]);
                    if (card) this.tm.utilizeCard(card);
                    break;
                }
                case 'synthesis': {
                    const cardA = cardsById.get(args[0]);
                    const cardB = cardsById.get(args[1]);
                    if (cardA && cardB) {
                        this.tm.synthesis(cardA, cardB,
                            { chipPositions: args[2] },
                            { chipPositions: args[3] },
                            args[4]);
                    }
                    break;
                }
                default: console.warn('[Host] unknown action:', name);
            }
        } catch (e) {
            console.warn('[Host] action error:', e);
        }
    }

    // ── GUEST side ─────────────────────────────────────────────

    _guestHandleMessage(msg) {
        if (msg.type === 'state') {
            this._guestApplyState(msg.snapshot);
            return;
        }
        if (msg.type === 'input-req') {
            this._guestHandleInputReq(msg);
            return;
        }
        if (msg.type === 'game-over') {
            this._netGameOverShown = true;
            this._onGameOver(msg.winner);
            return;
        }
    }

    _guestApplyState(snap) {
        const firstTime = !this.state;
        if (firstTime) {
            this.state = buildShadowStateFromSnapshot(snap, this.cardsById);
            this.tm = this._createGuestTM();
            // Привязываем input для случая когда гость сам инициирует эффекты
            // (фактически input не используется на guest — только для совместимости)
            this.input = { sourceCard: null, sourceMode: null, actionKind: null };
        } else {
            applySnapshotTo(this.state, snap, this.cardsById);
        }
        this._render();
        this._updatePhaseHint();
        if (snap.phase === Phase.Action && snap.currentPI === this.localPI) {
            this._highlightEmptyNodes();
        } else {
            this._clearHighlights();
        }
        this._updateNetTurnIndicator();
    }

    _guestHandleInputReq(msg) {
        const { reqId, kind, pi, ctx, payload } = msg;
        if (kind === 'chooseCards') {
            const cards = (payload.cardIds || []).map(id => this.cardsById.get(id)).filter(Boolean);
            this._showCardPick(pi, cards, payload.count, chosen => {
                this.net.respondToRequest(reqId, chosen.map(c => c.id));
            }, ctx);
        } else if (kind === 'chooseNodes') {
            this._startNodePick(payload.nodes || [], payload.count, chosen => {
                this.net.respondToRequest(reqId, chosen);
            });
        }
    }

    // Прокси над TurnManager для гостя: мутации уходят в сеть,
    // read-only (getValidPlacements) работает локально против shadow state.
    _createGuestTM() {
        const realTM = new TurnManager(this.state, null);
        const sendAction = (name, args) => {
            this.net?.send({ type: 'action', name, args });
        };
        const mutations = {
            placeChip:   (r, c) => { sendAction('placeChip',   [r, c]); return 'ok'; },
            returnPiece: (r, c) => { sendAction('returnPiece', [r, c]); return 'ok'; },
            undoChip:    (r, c) => { sendAction('undoChip',    [r, c]); return 'ok'; },
            endAction:   ()     => { sendAction('endAction',   []); return true; },
            endTurn:     ()     => { sendAction('endTurn',     []); return true; },
            replenish:   ()     => { sendAction('replenish',   []); return true; },
            playCard:    (card, placement, onDone) => {
                sendAction('playCard', [card.id, placement.chipPositions]);
                onDone?.('ok');
            },
            utilizeCard: (card, onDone) => {
                sendAction('utilizeCard', [card.id]);
                onDone?.('ok');
            },
            synthesis: (cardA, cardB, matchA, matchB, aFirst, onDone) => {
                sendAction('synthesis',
                    [cardA.id, cardB.id, matchA.chipPositions, matchB.chipPositions, aFirst]);
                onDone?.('ok');
            },
        };
        return new Proxy(realTM, {
            get: (t, prop) => {
                if (prop in mutations) return mutations[prop];
                const val = t[prop];
                return typeof val === 'function' ? val.bind(t) : val;
            }
        });
    }

    _updateNetTurnIndicator() {
        const ind = this.netTurnIndicator;
        if (!ind) return;
        if (!this.netMode || !this.state) {
            ind.classList.add('hidden');
            return;
        }
        const myTurn = this.state.currentPI === this.localPI;
        if (myTurn) {
            ind.classList.add('hidden');
        } else {
            const phaseNames = { Replenish: 'восполнение', Action: 'действия', Task: 'задача' };
            const phase = phaseNames[this.state.phase] || this.state.phase;
            ind.textContent = `⏳ Ход соперника · ${phase}`;
            ind.classList.remove('hidden');
        }
    }
}

// ── Bootstrap ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    window.ui = new GameUI();
    // Show menu on first load; _startGame() called by menu buttons
});
