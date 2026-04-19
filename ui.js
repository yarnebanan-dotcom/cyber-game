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

        // Synthesis state
        // null | { step: 'selectB'|'placeB'|'chooseOrder', cardA, matchA, cardB?, matchB? }
        this.synth = null;

        // Node picking
        this.nodePickAllowed = null;
        this.nodePickRemaining = 0;
        this.nodePickResult = [];
        this.nodePickDone = null;

        // Позиции только что разыгранной комбинации — скрываем визуально
        // пока идёт эффект (поставить фишки и т.п.), хотя в state они ещё есть.
        this._consumedPattern = null;  // Set<"r,c"> | null

        // Last turn summary for handoff screen
        this._lastTurnSummary = null;

        // Card pattern rotations (card.id → degrees)
        this._cardRotations = new Map();

        // Карта с показанным описанием под рукой (toggle по тапу)
        this._descCard = null;

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
        this.revealedWrap = document.getElementById('revealed-wrap');
        this.cardDescTopEl = document.getElementById('card-desc-top');
        this.cardDescBotEl = document.getElementById('card-desc-bot');

        // Buttons
        document.getElementById('btn-utilize').onclick = () => this._onUtilize();
        document.getElementById('btn-draw-three').onclick = () => this._onDrawThree();
        document.getElementById('btn-skip').onclick = () => this._onEndTurn();

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
        document.getElementById('btn-show-rules').onclick = () => {
            this._populateRulesDeck();
            document.getElementById('rules-screen').classList.remove('hidden');
        };
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
        this._menuHard = false;
        const btn2p = document.getElementById('btn-mode-2p');
        const btn3p = document.getElementById('btn-mode-3p');
        const setMenuMode = (n) => {
            this._menuMode = n;
            btn2p.classList.toggle('active', n === 2);
            btn3p.classList.toggle('active', n === 3);
        };
        btn2p.onclick = () => setMenuMode(2);
        btn3p.onclick = () => setMenuMode(3);
        const btnHard = document.getElementById('btn-hard-mode');
        if (btnHard) {
            btnHard.onclick = () => {
                this._menuHard = !this._menuHard;
                btnHard.classList.toggle('active', this._menuHard);
            };
        }
        document.getElementById('btn-initiate').onclick = () => this._startGame(this._menuMode, null, this._menuHard);
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

        // Steal pick modal (кража из раскрытых / вслепую)
        this.stealPickModal = document.getElementById('steal-pick-modal');
        this.stealPickTitle = document.getElementById('steal-pick-title');
        this.stealPickRevealed = document.getElementById('steal-pick-revealed');
        this.stealPickBlind = document.getElementById('steal-pick-blind');

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

    _startGame(playerCount = 2, netOpts = null, hardMode = this._menuHard || false) {
        this._playerCount = playerCount;
        this._hardMode = hardMode;
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

        this.state = new GameState(boardSize, winScore, playerCount, hardMode);
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
            chooseStealSource(actorPI, ctx, done) {
                // Hot-seat: вор всегда активный игрок — показываем модал сразу.
                // Online host: если actor не локальный, запрашиваем выбор у гостя по сети.
                if (self.netMode === 'host' && actorPI !== self.localPI) {
                    const payload = {
                        revealedPool: ctx.revealedPool.map(({ card, ownerPI }) => ({ cardId: card.id, ownerPI })),
                        opponents: ctx.opponents.map(({ pi, handCount }) => ({ pi, handCount })),
                        remaining: ctx.remaining,
                        total: ctx.total,
                    };
                    self.net.request('chooseStealSource', actorPI, null, payload).then(resp => {
                        if (!resp || typeof resp !== 'object') { done(null); return; }
                        if (resp.type === 'revealed') {
                            const entry = ctx.revealedPool.find(p => p.card.id === resp.cardId && p.ownerPI === resp.ownerPI);
                            if (entry) { done({ type: 'revealed', card: entry.card, ownerPI: entry.ownerPI }); return; }
                            // Карта могла исчезнуть из пула — fallback на первый доступный источник
                        }
                        if (resp.type === 'blind') {
                            const o = ctx.opponents.find(x => x.pi === resp.ownerPI);
                            if (o) { done({ type: 'blind', ownerPI: o.pi }); return; }
                        }
                        // Невалидный ответ — fallback
                        const p = ctx.revealedPool[0];
                        if (p) { done({ type: 'revealed', card: p.card, ownerPI: p.ownerPI }); return; }
                        const o = ctx.opponents[0];
                        if (o) { done({ type: 'blind', ownerPI: o.pi }); return; }
                        done(null);
                    });
                    return;
                }
                self._showStealPick(actorPI, ctx, done);
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
        // Стартовая раздача: каждый игрок должен начать с полной рукой (supply),
        // иначе неактивные игроки до своего первого хода сидят с пустой рукой —
        // ни увидеть свои карты, ни прочитать описание не могут.
        for (const pl of this.state.players) {
            const need = Math.max(0, pl.supply - pl.hand.length);
            if (need > 0) pl.hand.push(...this.state.deck.draw(need));
        }
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
            // Смена игрока — сбрасываем описание карты
            this._descCard = null;
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
        // Tier-2: три независимых счётчика действий в фазе Ход
        const phaseInfoEl = document.getElementById('hud-phase-info');
        if (phaseInfoEl) {
            const phaseName = st.phase === Phase.Replenish ? 'ВОСПОЛН'
                : st.phase === Phase.Turn ? `● ${st.chipsPlaced}/${st.chipsAllowed} · ▶ ${st.tasksThisTurn || 0}/2 · ✦ ${st.utilizesThisTurn || 0}/2`
                : 'КОНЕЦ';
            phaseInfoEl.textContent = phaseName;
        }
        // Opponent score chips (+ EXPERIMENTAL debt badge)
        if (this.oppScoresEl) {
            const chips = [];
            for (let i = 0; i < st.players.length; i++) {
                if (i === activePI) continue;
                const p = st.players[i];
                const debt = (p.pendingActions || []).reduce((a, x) => a + (x.count || 0), 0);
                const badge = debt > 0 ? ` <span class="opp-debt" title="Долг: решить в свой ход">✕${debt}</span>` : '';
                chips.push(`<span class="p${i+1}">P${i+1}:${p.score}${badge}</span>`);
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

        // Phase stepper — map Replenish→0, Turn→1 (END=2 only during summary)
        const phaseIdx = st.phase === Phase.Replenish ? 0 : st.phase === Phase.Turn ? 1 : 2;
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
        // UI-10: мета-строка с подсказкой справа
        const supply = st.players[this.netMode ? viewPI : st.currentPI].supply;
        this.handLabelEl.textContent = `РУКА · ${handSize}/${supply}`;
        this.handLabelEl.style.color = playerColor;

        // Phase hint
        this._updatePhaseHint();

        // Buttons visibility
        const inTurn = st.phase === Phase.Turn;
        const inSynth = !!this.synth;
        const inNodePick = !!this.nodePickDone;
        const endActionBtn = document.getElementById('btn-end-action');
        const skipBtn = document.getElementById('btn-skip');
        if (endActionBtn) endActionBtn.style.display = 'none';  // удалён, алиас на всякий случай
        document.getElementById('btn-utilize').style.display = (inTurn && !inSynth && !inNodePick) ? '' : 'none';
        // Завершить ход — видна всю фазу хода; при активном sub-flow клик даст предупреждение
        skipBtn.style.display = inTurn ? '' : 'none';

        // Hard-mode: кнопка "＋3 Добор" — только если в этом ходу ещё не ставили фишки
        // и не использовали альтернативу, в колоде+сбросе есть хотя бы 1 карта.
        const drawThreeBtn = document.getElementById('btn-draw-three');
        const deckHas = (st.deck?.cards?.length ?? st.deck?.count ?? 0) + (st.discard?.length ?? 0) > 0;
        const canDrawThree = inTurn && !inSynth && !inNodePick
            && st.hardMode
            && !st.drewThreeThisTurn
            && st.chipsPlaced === 0
            && deckHas;
        drawThreeBtn.style.display = canDrawThree ? '' : 'none';

        // Кнопка всегда primary, без подсказок о наличии розыгрышей
        skipBtn.textContent = '⏭ Завершить ход';
        skipBtn.classList.add('btn-primary');
        skipBtn.classList.remove('btn-ghost');

        // Labels now rendered per-lane in _renderRevealed (FIX-21)
        this._renderBoard();
        this._renderHand();
        this._renderRevealed();
        this._renderCardDesc();
        this._updateNetTurnIndicator();
    }

    _updatePhaseHint() {
        const st = this.state;
        let text = '';
        let tone = 'replenish';
        let counter = '';

        if (this.nodePickDone) {
            const n = this.nodePickRemaining;
            if (this._consumedPattern) {
                text = `Поставь ${n} фишк${n === 1 ? 'у' : n < 5 ? 'и' : 'ек'} на доске`;
            } else {
                text = `Выбери ${n} узел${n === 1 ? '' : n < 5 ? 'а' : 'ов'} на доске`;
            }
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
        } else if (st.phase === Phase.Turn) {
            const chipsLeft = st.chipsAllowed - st.chipsPlaced;
            const t = st.tasksThisTurn, u = st.utilizesThisTurn;
            if (this.pendingCard) {
                // pendingCard выбран — направляем на доску искать паттерн
                text = `Найди паттерн на поле · тапай фишки`;
                tone = 'action';
            } else {
                const allCards = [...st.cp.hand, ...st.players.flatMap(p => p.revealed)];
                const hasPlayable = allCards.some(c => this.tm.getValidPlacements(c).length > 0);
                const hasHand = st.cp.hand.length > 0 || st.cp.revealed.length > 0;
                const canPlace = chipsLeft > 0 && st.cp.reserve > 0 && st.board.emptyNodes().length > 0;
                const drewThree = !!st.drewThreeThisTurn;
                const bonusChip = st.chipsAllowed > 2;
                if (!hasHand && !canPlace) {
                    text = `Ходов нет · завершай ход`;
                    tone = 'replenish';
                } else if (drewThree && hasPlayable) {
                    text = `Добор использован · разыгрывай карты`;
                    tone = 'task';
                    counter = `▶${t}/2 · ✦${u}/2`;
                } else if (drewThree) {
                    text = `Добор использован · завершай ход`;
                    tone = 'replenish';
                } else if (canPlace && !hasPlayable && hasHand) {
                    text = bonusChip ? `Ставь фишки · бонус +1 за пропуск` : `Ставь фишки · розыгрыш невозможен`;
                    tone = 'action';
                    counter = `●${chipsLeft}/${st.chipsAllowed}`;
                } else if (canPlace && hasPlayable) {
                    text = bonusChip ? `Ставь фишки (бонус +1) или разыгрывай карты` : `Ставь фишки или разыгрывай карты`;
                    tone = 'task';
                    counter = `●${chipsLeft}/${st.chipsAllowed} · ▶${t}/2 · ✦${u}/2`;
                } else if (!canPlace && hasPlayable) {
                    text = `Выбери карту · ▶ разыграй или ✦ утилизируй`;
                    tone = 'task';
                    counter = `▶${t}/2 · ✦${u}/2`;
                } else {
                    text = `Розыгрыш невозможен · ✦ утилизируй или завершай ход`;
                    tone = 'action';
                }
            }
        }

        // Render hint bar with arrow + text + optional counter (kit proto pattern)
        const counterHTML = counter ? `<span class="hint-counter">${counter}</span>` : '';
        // UI-10: первое слово (повелительный глагол) выделяем как .hint-verb
        const m = text.match(/^([\p{Lu}][\p{L}]+)\s+/u);
        const verbHtml = m
            ? `<span class="hint-verb">${m[1]}</span>${text.slice(m[0].length)}`
            : text;
        this.phaseHintEl.innerHTML = `<span class="hint-arrow">&gt;</span><span class="hint-text">${verbHtml}</span>${counterHTML}`;
        this.phaseHintEl.className = 'tone-' + tone;
    }

    _renderBoard() {
        const st = this.state;
        const occClass = ['empty', 'p1', 'p2', 'p3'];
        const cells = this.boardEl.querySelectorAll('.node');
        // FIX-26: сохраняем .tapped из pendingNodes, чтобы крест-accent переживал ре-рендер
        const tappedSet = new Set((this.pendingNodes || []).map(([r, c]) => `${r},${c}`));
        const consumed = this._consumedPattern;
        // Переживание подсветки (node pick) через ре-рендер
        const allowedSet = new Set((this.nodePickAllowed || []).map(([r, c]) => `${r},${c}`));
        const selectedSet = new Set((this.nodePickResult || []).map(([r, c]) => `${r},${c}`));
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r), c = parseInt(cell.dataset.c);
            const occ = st.board.nodes[r][c];
            let cn = 'node ' + (occClass[occ] ?? 'empty');
            if (tappedSet.has(`${r},${c}`)) cn += ' tapped';
            if (consumed && consumed.has(`${r},${c}`)) cn += ' consumed';
            if (allowedSet.has(`${r},${c}`)) cn += ' highlighted';
            if (selectedSet.has(`${r},${c}`)) cn += ' selected-node';
            cell.className = cn;
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

    // FIX-26: .tapped — крест-accent на тапнутых фишках паттерна (V3 focus-mode)
    _applyTapped(positions) {
        this._clearTapped();
        for (const [r, c] of positions) {
            const cell = this.boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
            if (cell) cell.classList.add('tapped');
        }
    }
    _clearTapped() {
        this.boardEl.querySelectorAll('.node.tapped').forEach(n => n.classList.remove('tapped'));
    }
    _updateFocusCount(tapped, total) {
        const cnt = this.handEl?.querySelector('.focus-info .fi-cnt');
        if (!cnt) return;
        cnt.textContent = `${tapped}/${total}`;
        cnt.classList.toggle('full', tapped === total && total > 0);
    }

    // Переключатель карты с показанным описанием. Повторный тап по той же карте — скрыть.
    _setDescCard(card) {
        this._descCard = (this._descCard === card) ? null : card;
        this._renderCardDesc();
    }

    _renderCardDesc() {
        const top = this.cardDescTopEl;
        const bot = this.cardDescBotEl;
        if (!top || !bot) return;
        // Top slot больше не используется — всё описание идёт в нижний фиксированный слот.
        top.classList.remove('placeholder');
        top.classList.add('empty');
        top.innerHTML = '';
        const card = this._descCard;
        if (!card) {
            bot.classList.remove('empty');
            bot.classList.add('placeholder');
            bot.innerHTML = '— выбери карту · описание эффекта —';
            return;
        }
        const el = bot;
        el.classList.remove('empty');
        el.classList.remove('placeholder');
        const rows = [];
        if (card.playEffect && card.playEffect.hasEffects) {
            rows.push(`<span class="cd-row fx-play"><span class="cd-kind">▶ Розыгрыш</span><span class="cd-text">${this._fxLongText(card.playEffect)}</span></span>`);
        }
        if (card.utilizeEffect && card.utilizeEffect.hasEffects) {
            rows.push(`<span class="cd-row fx-util"><span class="cd-kind">✦ Утилизация</span><span class="cd-text">${this._fxLongText(card.utilizeEffect)}</span></span>`);
        }
        if (card.synthesisEffect && card.synthesisEffect.hasEffects) {
            rows.push(`<span class="cd-row fx-synth"><span class="cd-kind">⊕ Синтез</span><span class="cd-text">${this._fxLongText(card.synthesisEffect)}</span></span>`);
        }
        const body = rows.length ? rows.join('') : '<span class="cd-row"><span class="cd-empty">Без эффектов</span></span>';
        const costStr = (card.cost >= 0 ? '' : '−') + Math.abs(card.cost);
        el.innerHTML = `<div class="cd-head"><span class="cd-name">${card.name}</span><span class="cd-cost">СТ · ${costStr}</span></div>${body}`;
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
        this._syncFocusMode();
    }

    // Focus-mode отключён — при выборе карты меняется только цвет рамки.
    _syncFocusMode() {
        this.handEl.classList.remove('focus-mode');
        this.handEl.querySelectorAll('.card.hiding').forEach(el => el.classList.remove('hiding'));
        const fi = this.handEl.querySelector('.focus-info');
        if (fi) fi.remove();
        this.handLabelEl.classList.remove('focus-hidden');
        this.revealedWrap.classList.remove('focus-hidden');
    }

    _fillFocusInfo(fi) {
        const card = this.pendingCard;
        if (!card) return;
        const patternLen = card.pattern.length;
        const tapped = this.pendingNodes.length;
        const fx = card.playEffect;
        const hasFx = fx && fx.hasEffects;
        const fxText = hasFx ? `▶ ${this._fxText(fx)}` : '▶ эффекта розыгрыша нет';

        const inSynthB = this.synth?.step === 'placeB';
        const canSynth = !inSynthB
            && !this.synth
            && this.state.hardMode
            && this.state.tasksThisTurn < 2
            && this._hasSynthPartner(card);

        fi.innerHTML = `
            <div class="fi-name">${card.name}</div>
            <div class="fi-eff${hasFx ? '' : ' empty'}">${fxText}</div>
            <div class="fi-bottom">
                <span class="fi-cnt${tapped === patternLen && patternLen > 0 ? ' full' : ''}">${tapped}/${patternLen}</span>
                <div class="fi-actions">
                    ${canSynth ? '<button class="fi-btn synth" id="fi-synth">⊕ СИНТ</button>' : ''}
                </div>
            </div>
            <button class="fi-cancel" id="fi-cancel" aria-label="Отменить выбор">✕</button>
        `;
        const cancelBtn = fi.querySelector('#fi-cancel');
        if (cancelBtn) cancelBtn.onclick = () => {
            if (this.synth) this._cancelSynth();
            else this._cancelPendingCard();
        };
        const synthBtn = fi.querySelector('#fi-synth');
        if (synthBtn) synthBtn.onclick = () => this._onSynthNext();
    }

    _cancelPendingCard() {
        this.pendingCard = null;
        this.pendingNodes = [];
        this._clearHighlights();
        this._clearTapped();
        this._render();
    }

    // Анимированный вылет карты из руки/раскрытых перед тем как state её уберёт.
    // Вызывается СИНХРОННО до tm.playCard / tm.utilizeCard. Клон карты переводится
    // в position:fixed c текущими координатами, оригинал удаляется; клон убирается
    // после окончания keyframes.
    _animateCardFlyOut(cardId) {
        const src = document.querySelector(`.card[data-card-id="${cardId}"]`);
        if (!src) return;
        const rect = src.getBoundingClientRect();
        const clone = src.cloneNode(true);
        clone.classList.remove('selected', 'playable', 'unplayable');
        clone.classList.add('card-flying-out');
        clone.style.left = rect.left + 'px';
        clone.style.top  = rect.top  + 'px';
        clone.style.width  = rect.width  + 'px';
        clone.style.height = rect.height + 'px';
        // Отталкиваемся вбок от центра экрана — карты с левой стороны улетают влево, с правой вправо.
        const centerX = window.innerWidth / 2;
        const cardCx = rect.left + rect.width / 2;
        clone.style.setProperty('--fly-dx', `${(cardCx - centerX) * 0.3}px`);
        document.body.appendChild(clone);
        // Убираем оригинал, чтобы _render() не наткнулся на дубликат
        src.style.visibility = 'hidden';
        setTimeout(() => { try { clone.remove(); } catch (_) {} }, 600);
    }

    _renderRevealed() {
        const st = this.state;
        const vpi = this._viewPI();
        const vp = st.players[vpi];
        // Общая зона раскрытых: карточки всех игроков в одном ряду
        const allRevealed = st.players.flatMap((p, i) => p.revealed.map(c => ({ card: c, ownerPI: i })));
        const playable = new Set();
        const canAct = !this.netMode || st.currentPI === this.localPI;
        if (canAct) {
            const allCards = [...vp.hand, ...allRevealed.map(x => x.card)];
            allCards.forEach(c => {
                if (this.tm.getValidPlacements(c).length > 0) playable.add(c);
            });
        }

        this.revealedWrap.innerHTML = '';
        this.revealedWrap.classList.remove('collapsed');
        const lane = this._makeRevealedLane(allRevealed, playable);
        this.revealedWrap.appendChild(lane);
    }

    _makeRevealedLane(entries, playable) {
        const count = `${entries.length} ${this._cardWord(entries.length)}`;
        const lane = document.createElement('div');
        lane.className = 'rev-lane' + (entries.length === 0 ? ' empty' : '');
        lane.style.setProperty('--lane-tint', 'rgba(170,204,255,0.05)');
        lane.innerHTML = `
            <div class="rev-lane-label">РАСКРЫТО · ОБЩАЯ ЗОНА</div>
            <div class="rev-lane-count">${count}</div>
            <div class="rev-lane-row"></div>
        `;
        const row = lane.querySelector('.rev-lane-row');
        if (entries.length === 0) {
            row.innerHTML = '<div class="rev-lane-placeholder">— пусто —</div>';
        } else {
            entries.forEach(({ card, ownerPI }) => {
                const el = this._makeCardEl(card, playable.has(card), true, ownerPI);
                row.appendChild(el);
            });
        }
        return lane;
    }

    _playerTint(pi) {
        return [
            'rgba(63,208,230,0.06)',  // p1 cyan
            'rgba(255,106,43,0.06)',  // p2 orange
            'rgba(183,108,255,0.06)'  // p3 violet
        ][pi] ?? 'rgba(170,204,255,0.06)';
    }

    _cardWord(n) {
        const mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 14) return 'КАРТ';
        const mod10 = n % 10;
        if (mod10 === 1) return 'КАРТА';
        if (mod10 >= 2 && mod10 <= 4) return 'КАРТЫ';
        return 'КАРТ';
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
        el.dataset.cardId = card.id;
        if (typeof ownerPI === 'number') el.dataset.player = `p${ownerPI + 1}`;
        if (card === this.pendingCard) el.classList.add('selected');

        const storedRot = this._cardRotations.get(card.id) || 0;
        const cornerText = storedRot ? `↻${storedRot}°` : '↻';
        const cornerClass = storedRot ? 'card-corner rot' : 'card-corner';
        el.innerHTML = `
            <div class="card-header">
                <div class="card-cost">${card.cost}</div>
                <div class="${cornerClass}">${cornerText}</div>
            </div>
            <div class="card-pattern">${this._patternGridHTML(card)}</div>
            <div class="card-name">${card.name}</div>
        `;

        // Apply stored rotation to pattern grid
        if (storedRot) {
            const grid = el.querySelector('.card-pattern-grid');
            if (grid) grid.style.transform = `rotate(${storedRot}deg)`;
        }

        // Клик: TASK = выбор, иначе = поворот паттерна
        const rotate = () => {
            const next = ((this._cardRotations.get(card.id) || 0) + 90) % 360;
            this._cardRotations.set(card.id, next);
            const grid = el.querySelector('.card-pattern-grid');
            if (grid) grid.style.transform = next ? `rotate(${next}deg)` : '';
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

        // Долгое нажатие — анимированное вращение паттерна (пока держим)
        let holdTimer = null;
        let holdInterval = null;
        let didHoldRotate = false;
        let startX = 0, startY = 0;
        const endHold = () => {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
        };
        el.addEventListener('pointerdown', (e) => {
            startX = e.clientX; startY = e.clientY;
            didHoldRotate = false;
            endHold();
            holdTimer = setTimeout(() => {
                didHoldRotate = true;
                rotate();
                holdInterval = setInterval(rotate, 450);
            }, 350);
        });
        el.addEventListener('pointermove', (e) => {
            if (!holdTimer && !holdInterval) return;
            if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) endHold();
        });
        el.addEventListener('pointerup', endHold);
        el.addEventListener('pointerleave', endHold);
        el.addEventListener('pointercancel', endHold);

        el.addEventListener('click', () => {
            if (didHoldRotate) { didHoldRotate = false; return; }
            this._setDescCard(card);
            if (this.state && this.state.phase === Phase.Turn) {
                this._onCardTap(card, isPlayable);
                return;
            }
            rotate();
        });

        el.addEventListener('selectstart', e => e.preventDefault());
        el.addEventListener('contextmenu', e => e.preventDefault());

        return el;
    }

    // Если паттерн помещается в 3×3 — показываем 3×3, иначе минимальную квадратную сетку,
    // в которую он влезает. Паттерн центрируется внутри.
    _normalizedPattern(card) {
        const pattern = card.pattern || [];
        if (!pattern.length) return { cells: [], gw: 3, gh: 3 };
        let rMin = Infinity, rMax = -Infinity, cMin = Infinity, cMax = -Infinity;
        for (const p of pattern) {
            if (p.row < rMin) rMin = p.row; if (p.row > rMax) rMax = p.row;
            if (p.col < cMin) cMin = p.col; if (p.col > cMax) cMax = p.col;
        }
        const bbW = cMax - cMin + 1;
        const bbH = rMax - rMin + 1;
        const dim = Math.max(3, bbW, bbH);
        const offC = Math.floor((dim - bbW) / 2);
        const offR = Math.floor((dim - bbH) / 2);
        const cells = pattern.map(p => ({
            row: p.row - rMin + offR,
            col: p.col - cMin + offC,
            type: p.type,
        }));
        return { cells, gw: dim, gh: dim };
    }

    _patternGridHTML(card) {
        const { cells, gw, gh } = this._normalizedPattern(card);
        let html = `<div class="card-pattern-grid" style="grid-template-columns:repeat(${gw},1fr);grid-template-rows:repeat(${gh},1fr);aspect-ratio:${gw}/${gh};">`;
        for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
            const cd = cells.find(p => p.row === r && p.col === c);
            let cls = 'empty';
            if (cd) cls = cd.type === CellType.W ? 'w' : 'g';
            html += `<div class="card-pattern-cell ${cls}"></div>`;
        }
        html += '</div>';
        return html;
    }

    _patternSVG(card, size = 48, ownerPI) {
        const { cells, gw, gh } = this._normalizedPattern(card);
        const gap = 1;
        const maxDim = Math.max(gw, gh, 1);
        const cell = Math.floor((size - 8) / maxDim - gap);
        const ownerColor = (typeof ownerPI === 'number') ? this._playerColor(ownerPI) : '#ff6a2b';
        const enemyColor = '#8a95a2';
        const gridW_px = gw * cell + (gw - 1) * gap;
        const gridH_px = gh * cell + (gh - 1) * gap;
        const offX = (size - gridW_px) / 2;
        const offY = (size - gridH_px) / 2;
        let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
        svg += `<rect width="${size}" height="${size}" fill="transparent"/>`;
        for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
            const x = offX + c * (cell + gap), y = offY + r * (cell + gap);
            const cd = cells.find(p => p.row === r && p.col === c);
            if (cd) {
                const fill = cd.type === CellType.W ? ownerColor : enemyColor;
                svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`;
            } else {
                svg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="transparent" stroke="#0e3542" stroke-width="0.5" stroke-dasharray="1.5 1.5"/>`;
            }
        }
        svg += '</svg>';
        return svg;
    }

    _populateRulesDeck() {
        const box = document.getElementById('rules-deck-list');
        if (!box || box.dataset.filled === '1') return;
        const deck = CardDatabase.create();
        // Dedup by name+cost (одинаковые копии вместе)
        const seen = new Map();
        for (const c of deck) {
            const k = `${c.name}|${c.cost}`;
            if (!seen.has(k)) seen.set(k, { card: c, count: 1 });
            else seen.get(k).count++;
        }
        const rows = [...seen.values()].sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name, 'ru'));
        let html = '';
        for (const { card, count } of rows) {
            const costLabel = card.cost === 0 ? '0' : (card.cost > 0 ? `+${card.cost}` : `${card.cost}`);
            const copies = count > 1 ? ` <span style="color:var(--text-ghost);font-weight:400">×${count}</span>` : '';
            html += `<div class="rules-deck-row">`
                + `<div class="rd-cost">${costLabel}</div>`
                + `<div class="rd-pattern">${this._patternSVG(card, 48, undefined)}</div>`
                + `<div class="rd-body">`
                    + `<div class="rd-name">${card.name}${copies}</div>`
                    + `<div class="rd-fx">${this._describeEffects(card)}</div>`
                + `</div>`
                + `</div>`;
        }
        box.innerHTML = html;
        box.dataset.filled = '1';
    }

    _describeEffects(card) {
        const parts = [];
        if (card.playEffect.hasEffects) parts.push(`<span class="fx-play">▶ ${this._fxText(card.playEffect)}</span>`);
        if (card.utilizeEffect.hasEffects) parts.push(`<span class="fx-util">✦ ${this._fxText(card.utilizeEffect)}</span>`);
        if (card.synthesisEffect.hasEffects) parts.push(`<span class="fx-synth">⊕ ${this._fxText(card.synthesisEffect)}</span>`);
        return parts.join('<br>') || '<span class="fx-none">—</span>';
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
            const cardsWord = c => c === 1 ? 'у' : c < 5 ? 'ы' : '';
            const chipsWord = c => c === 1 ? 'у' : c < 5 ? 'и' : 'ек';
            switch (fx.constructor.name) {
                case 'DrawCardsEffect':
                    return self ? `Возьми ${n} карт${cardsWord(n)}.` : `Противник берёт ${n} карт${cardsWord(n)}.`;
                case 'DigCardsEffect':
                    return `Раскопай ${n}: возьми ${n + 2} верхних, оставь ${n} в руке, остаток — в сброс.`;
                case 'PlaceChipsEffect':
                    return `Поставь ${n} фишк${chipsWord(n)} на свободные узлы.`;
                case 'RevealCardsEffect':
                    if (inf) return self ? `Выложи ВСЮ руку в раскрытые.` : `Противник выкладывает ВСЮ руку.`;
                    return self ? `Выложи ${n} карт${cardsWord(n)} в раскрытые.` : `Противник выкладывает ${n} карт${cardsWord(n)} в раскрытые.`;
                case 'DiscardCardsEffect':
                    if (inf) return self ? `Сбрось ВСЮ руку.` : `Противник сбрасывает ВСЮ руку.`;
                    return self ? `Сбрось ${n} карт${cardsWord(n)}.` : `Противник сбрасывает ${n} карт${cardsWord(n)}.`;
                case 'StealCardsEffect':
                    return `Возьми ${n} случайн${n===1?'ую':'ых'} карт${cardsWord(n)} из руки противника.`;
                case 'ModifySupplyEffect': {
                    const sign = fx.delta > 0 ? '+' : '';
                    return self ? `Твой запас ${sign}${fx.delta}.` : `Запас противника ${sign}${fx.delta}.`;
                }
                case 'SetSupplyEffect':
                    return self ? `Твой запас = ${fx.val}.` : `Запас противника = ${fx.val}.`;
                case 'CopyOpponentSupplyEffect':
                    return `Твой запас = запас противника.`;
                case 'ResetFieldEffect':
                    return `Все фишки уходят с поля.`;
                default: return '';
            }
        }).filter(Boolean).join(' ');
    }

    // ── Board building ─────────────────────────────────────────

    _buildBoard(size = 4) {
        this.boardEl.innerHTML = '';
        this.boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        this.boardEl.style.gridTemplateRows = `repeat(${size}, 1fr)`;
        // UI-09: класс для CSS-переопределения при 5×5
        this.boardEl.classList.toggle('size-5', size === 5);
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
        // Подсветку пустых узлов НЕ включаем — игрок и так видит, что узлы пустые.
        // Остаётся только подсветка при выборе узлов для эффекта (allowedSet в _renderBoard).
        this._clearHighlights();
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

        if (this.state.phase !== Phase.Turn) return;

        // Если выбрана карта/идёт синтез — тап по фишке = паттерн
        if (this.pendingCard || this.synth?.step === 'placeA' || this.synth?.step === 'placeB') {
            this._onPatternNodeTap(r, c);
            return;
        }

        const st = this.state;
        const selfOcc = st.board.occOf(st.currentPI);

        // Тап по своей фишке, поставленной в этот ход — отменить
        if (st.board.nodes[r][c] === selfOcc) {
            const placedThisTurn = st.placedThisTurn || [];
            if (placedThisTurn.some(([pr, pc]) => pr === r && pc === c)) {
                const result = this.tm.undoChip(r, c);
                if (result === 'ok') {
                    this._haptic(14);
                    this._renderBoard();
                    this._updatePhaseHint();
                    this._render();
                }
            }
            return;
        }

        // Пустой узел — разместить фишку (если лимит ещё позволяет)
        const result = this.tm.placeChip(r, c);
        if (result === 'ok') {
            this._haptic(14);
            this._playSound('chip');
            this._renderBoard();
            this._updatePhaseHint();
            this._render();
        }
    }

    _onCardTap(card, isPlayable) {
        if (this.state.phase !== Phase.Turn) return;
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
            this._render();
            this._showMessage(`Тапни позицию для ${card.name} на доске`);
            return;
        }

        // ── Обычный выбор карты ──────────────────────────────────
        if (this.pendingCard === card) {
            this.pendingCard = null;
            this.pendingNodes = [];
            this._clearHighlights();
            this._clearTapped();
            this._render();
            return;
        }

        this.pendingCard = card;
        this.pendingNodes = [];
        this._clearHighlights();
        this._clearTapped();
        this._render();

        if (isPlayable) {
            const placements = this.tm.getValidPlacements(card);
            if (placements.length > 0) {
                this.currentPlacements = placements;
            }
        }
    }

    // Позиции для второй карты синтеза: только те, что делят хотя бы одну фишку с matchA
    _getSynthPlacements(cardB, matchA) {
        const all = this.tm.getValidPlacements(cardB);
        const posA = new Set(matchA.chipPositions.map(([r, c]) => `${r},${c}`));
        return all.filter(p => p.chipPositions.some(([r, c]) => posA.has(`${r},${c}`)));
    }

    // Hard-mode альтернатива: берём 3 карты вместо размещения в этом ходу.
    _onDrawThree() {
        if (this.nodePickDone) return;
        if (this.netMode && this.state.currentPI !== this.localPI) return;
        const st = this.state;
        if (!st.hardMode) return;
        if (st.drewThreeThisTurn) { this._showMessage('Добор уже использован в этом ходу'); return; }
        if (st.chipsPlaced > 0)   { this._showMessage('Фишка уже поставлена — добор недоступен'); return; }
        const result = this.tm.drawThree();
        if (result === 'ok') {
            this._haptic([18, 8, 18]);
            this._playSound('card');
            this._render();
        } else if (result === 'invalidAction' || result === 'invalidPhase') {
            this._showMessage('Добор недоступен');
        }
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
        this._animateCardFlyOut(this.pendingCard.id);
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
        this._clearHighlights();
        this._render();
        this._showMessage(`Тапни позицию ${this.synth.cardA.name} на доске`);
    }

    _cancelSynth() {
        this.synth = null;
        this.pendingCard = null;
        this.pendingNodes = [];
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
        this._animateCardFlyOut(cardA.id);
        this._animateCardFlyOut(cardB.id);
        this.tm.synthesis(cardA, cardB, matchA, matchB, aFirst, result => {
            this._render();
            if (result === 'limitReached') this._showMessage('Лимит задач (2) исчерпан');
            if (result === 'invalidAction') this._showMessage('Синтез невозможен: нет общей фишки');
        });
    }

    _onEndTurn() {
        if (this.nodePickDone) { this._showMessage('Сначала заверши текущее действие'); return; }
        if (this.synth) { this._showMessage('Сначала заверши синтез'); return; }
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

        // FIX-26: крест-accent на тапнутых фишках (вместо dashed-рамки), обновить счётчик в focus-info
        this._applyTapped(this.pendingNodes);
        this._updateFocusCount(this.pendingNodes.length, patternLen);

        // Ещё не набрали все — ждём
        if (this.pendingNodes.length < patternLen) return;

        // Проверяем совпадение с валидной позицией
        const selSet = new Set(this.pendingNodes.map(([nr, nc]) => `${nr},${nc}`));
        const matchPos = placements => placements?.find(p => {
            const pos = new Set(p.chipPositions.map(([pr, pc]) => `${pr},${pc}`));
            return pos.size === selSet.size && [...pos].every(k => selSet.has(k));
        });

        const reset = () => { this.pendingNodes = []; this._clearTapped(); this._updateFocusCount(0, patternLen); };
        // FIX-07: вместо тихого сброса — откат последнего тапа + shake + toast
        const rollbackLast = () => {
            const last = this.pendingNodes.pop();
            this._applyTapped(this.pendingNodes);
            this._updateFocusCount(this.pendingNodes.length, patternLen);
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
            this._syncFocusMode();
            this._showSynthOrderPanel();
            return;
        }

        // Обычный розыгрыш
        const match = matchPos(this.currentPlacements);
        if (!match) { rollbackLast(); return; }
        reset();
        const card = this.pendingCard;
        this.pendingCard = null;
        this._syncFocusMode();
        // Визуально «гасим» только что разыгранную комбинацию на время эффекта
        this._consumedPattern = new Set(match.chipPositions.map(([r, c]) => `${r},${c}`));
        this._animateCardFlyOut(card.id);
        this.tm.playCard(card, match, result => {
            if (!result) { this._haptic(26); this._playSound('play'); }
            this._consumedPattern = null;
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
            const done = this.nodePickDone;
            const result = this.nodePickResult;
            this.nodePickDone = null;
            this.nodePickAllowed = [];
            this.nodePickResult = [];
            this._clearHighlights();
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

        // Режим end-of-turn: показать end-panel/stats, скрыть summary
        document.getElementById('handoff-end-panel').classList.remove('hidden');
        document.getElementById('handoff-stats').classList.remove('hidden');
        document.getElementById('handoff-summary').classList.add('hidden');

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
            // EXPERIMENTAL: сначала отдать «долги» (отложенные выборы от противника),
            // потом обычное восполнение. См. PlayerState.pendingActions.
            this._resolvePendingActions(() => this.tm.replenish());
        }
    }

    // EXPERIMENTAL: резолв отложенных эффектов противника в начале хода
    _resolvePendingActions(onDone) {
        const st = this.state;
        const pl = st.cp;
        const next = () => {
            if (!pl.pendingActions.length) { onDone?.(); return; }
            const action = pl.pendingActions.shift();
            const all = action.kind === 'discard'
                ? [...pl.hand, ...pl.revealed]
                : [...pl.hand];
            const cnt = Math.min(action.count, all.length);
            if (cnt <= 0) { next(); return; }

            // Контекст для модала — как будто kind='discard'/'reveal'
            this.input.actionKind = action.kind;
            this.input.actionCount = cnt;
            this.input.actionTargetSelf = false;
            this.input.sourceCard = { name: action.sourceCardName, cost: null };
            this.input.sourceMode = 'play';

            if (all.length <= cnt) {
                // выбора нет — применить всё сразу
                this._applyPendingChoice(action.kind, all);
                next();
                return;
            }
            const ctx = this._buildChoiceContext(st.currentPI, cnt);
            // Override actorPI: долг оставил предыдущий игрок, а не текущий
            ctx.actorPI = action.actorPI;
            ctx.targetIsActor = false;
            this._showCardPick(st.currentPI, all, cnt, chosen => {
                this._applyPendingChoice(action.kind, chosen);
                this._notify && this._notify();
                this._render();
                next();
            }, ctx);
        };
        next();
    }

    _applyPendingChoice(kind, chosen) {
        const st = this.state;
        const pl = st.cp;
        chosen.forEach(c => {
            let i = pl.hand.indexOf(c);
            if (i >= 0) pl.hand.splice(i, 1);
            else { i = pl.revealed.indexOf(c); if (i >= 0) pl.revealed.splice(i, 1); }
            if (kind === 'discard') st.discard.push(c);
            else if (kind === 'reveal') pl.revealed.push(c);
        });
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
            const step = inp.digStep;
            const stepSuffix = (step && step.total > 1) ? ` · шаг ${step.current}/${step.total}` : '';
            actionLabel = `выбрать 1 из 2${stepSuffix}`;
            instruction = `Выбери 1 карту чтобы оставить себе · другая уйдёт в сброс`;
            consequence = `✓ Выбранная карта попадёт в руку · другая в сброс`;
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

        // Режим choice: скрыть end-panel/stats, показать summary
        document.getElementById('handoff-end-panel').classList.add('hidden');
        document.getElementById('handoff-stats').classList.add('hidden');
        document.getElementById('handoff-summary').classList.remove('hidden');

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
                `<div class="pick-item-pattern">${this._patternSVG(card, 48, pi)}</div>` +
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

    // ── Steal pick modal ───────────────────────────────────────
    // ctx: { revealedPool: [{card, ownerPI}], opponents: [{pi, handCount}], remaining, total }

    _showStealPick(actorPI, ctx, done) {
        const step = ctx.total - ctx.remaining + 1;
        this.stealPickModal.dataset.player = `p${actorPI + 1}`;
        this.stealPickTitle.innerHTML =
            `<div class="sp-sub"><span class="player-title" data-player="p${actorPI + 1}" style="display:inline">ИГРОК ${actorPI + 1}</span> · КРАЖА ${step}/${ctx.total}</div>` +
            `<div class="sp-main">ВЫБЕРИ ИСТОЧНИК</div>`;

        // Раскрытые: одна карточка = один клик = мгновенный выбор
        this.stealPickRevealed.innerHTML = '';
        if (ctx.revealedPool.length === 0) {
            this.stealPickRevealed.innerHTML = `<div class="sp-empty">В общей зоне пусто</div>`;
        } else {
            ctx.revealedPool.forEach(({ card, ownerPI }) => {
                const item = document.createElement('div');
                item.className = 'sp-rev-item';
                item.dataset.player = `p${ownerPI + 1}`;
                item.innerHTML =
                    `<div class="sp-rev-pattern">${this._patternSVG(card, 44, ownerPI)}</div>` +
                    `<div class="sp-rev-info">` +
                      `<div class="sp-rev-name">${card.name}</div>` +
                      `<div class="sp-rev-owner">ИГРОК ${ownerPI + 1}${ownerPI === actorPI ? ' · СВОЯ' : ''}</div>` +
                    `</div>`;
                item.addEventListener('click', () => this._finishStealPick({ type: 'revealed', card, ownerPI }));
                this.stealPickRevealed.appendChild(item);
            });
        }

        // Вслепую: одна кнопка на противника
        this.stealPickBlind.innerHTML = '';
        if (ctx.opponents.length === 0) {
            this.stealPickBlind.innerHTML = `<div class="sp-empty">У противников пустые руки</div>`;
        } else {
            ctx.opponents.forEach(({ pi, handCount }) => {
                const btn = document.createElement('button');
                btn.className = 'sp-blind-btn';
                btn.dataset.player = `p${pi + 1}`;
                btn.innerHTML =
                    `<span class="sp-blind-label">РУКА ИГРОКА ${pi + 1}</span>` +
                    `<span class="sp-blind-count">🎲 ${handCount} карт · случайная</span>`;
                btn.addEventListener('click', () => this._finishStealPick({ type: 'blind', ownerPI: pi }));
                this.stealPickBlind.appendChild(btn);
            });
        }

        this._stealPickDone = done;
        if (this.stealPickModal.parentElement !== document.body) {
            document.body.appendChild(this.stealPickModal);
        }
        this.stealPickModal.classList.remove('hidden');
    }

    _finishStealPick(selection) {
        this.stealPickModal.classList.add('hidden');
        const done = this._stealPickDone;
        this._stealPickDone = null;
        done?.(selection);
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
        document.getElementById('detail-pattern').innerHTML = this._patternSVG(card, 48, ownerPI);

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
                : st.phase === Phase.Turn ? `ХОД ● ${st.chipsPlaced}/${st.chipsAllowed} · ▶ ${st.tasksThisTurn || 0}/2 · ✦ ${st.utilizesThisTurn || 0}/2`
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
            document.getElementById('net-overlay-text').textContent = 'Пытаемся переподключиться…';
            overlay.classList.remove('hidden');
            if (net.role === 'guest') {
                net.startReconnectLoop(
                    (n, max) => {
                        document.getElementById('net-overlay-text').textContent =
                            `Пытаемся переподключиться… (${n}/${max})`;
                    },
                    () => {
                        document.getElementById('net-overlay-title').textContent = 'Не удалось переподключиться';
                        document.getElementById('net-overlay-text').textContent =
                            'Хост не отвечает. Вернись в меню и попробуй снова.';
                    }
                );
            }
            // host ждёт пока гость сам постучит на его peerId (on('connection'))
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
                case 'undoChip':    this.tm.undoChip(args[0], args[1]); break;
                case 'endTurn':
                    if (this.tm.endTurn() && this.state.phase === Phase.Replenish) {
                        this.tm.replenish();
                    }
                    break;
                case 'drawThree':   this.tm.drawThree(); break;
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
        this._clearHighlights();
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
        } else if (kind === 'chooseStealSource') {
            const ctx = {
                revealedPool: (payload.revealedPool || [])
                    .map(({ cardId, ownerPI }) => ({ card: this.cardsById.get(cardId), ownerPI }))
                    .filter(x => x.card),
                opponents: payload.opponents || [],
                remaining: payload.remaining,
                total: payload.total,
            };
            this._showStealPick(pi, ctx, choice => {
                if (!choice) { this.net.respondToRequest(reqId, null); return; }
                if (choice.type === 'revealed') {
                    this.net.respondToRequest(reqId, { type: 'revealed', cardId: choice.card.id, ownerPI: choice.ownerPI });
                } else {
                    this.net.respondToRequest(reqId, { type: 'blind', ownerPI: choice.ownerPI });
                }
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
            undoChip:    (r, c) => { sendAction('undoChip',    [r, c]); return 'ok'; },
            endTurn:     ()     => { sendAction('endTurn',     []); return true; },
            drawThree:   ()     => { sendAction('drawThree',   []); return 'ok'; },
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
            const phaseNames = { Replenish: 'восполнение', Turn: 'ход', Action: 'действия', Task: 'задача' };
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
