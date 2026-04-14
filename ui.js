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

        // Node picking
        this.nodePickAllowed = null;
        this.nodePickRemaining = 0;
        this.nodePickResult = [];
        this.nodePickDone = null;

        this._bindElements();
    }

    _bindElements() {
        this.boardEl = document.getElementById('board');
        this.p1ScoreEl = document.getElementById('p1-score');
        this.p2ScoreEl = document.getElementById('p2-score');
        this.p1SupplyEl = document.getElementById('p1-supply');
        this.p2SupplyEl = document.getElementById('p2-supply');
        this.p1ChipsEl = document.getElementById('p1-chips');
        this.p2ChipsEl = document.getElementById('p2-chips');
        this.deckCountEl = document.getElementById('deck-count');
        this.discardCountEl = document.getElementById('discard-count');
        this.phaseEl = document.getElementById('phase-label');
        this.turnEl = document.getElementById('turn-label');
        this.handEl = document.getElementById('hand-cards');
        this.ownRevealedEl = document.getElementById('own-revealed');
        this.oppRevealedEl = document.getElementById('opp-revealed');
        this.chipsLeftEl = document.getElementById('chips-left');

        // Buttons
        document.getElementById('btn-end-action').onclick = () => this._onEndAction();
        document.getElementById('btn-utilize').onclick = () => this._onUtilize();
        document.getElementById('btn-skip').onclick = () => this._onSkip();

        // Placement panel
        this.placementPanel = document.getElementById('placement-panel');
        this.placementCount = document.getElementById('placement-count');
        document.getElementById('btn-prev').onclick = () => this._prevPlacement();
        document.getElementById('btn-next').onclick = () => this._nextPlacement();
        document.getElementById('btn-confirm').onclick = () => this._confirmPlacement();

        // Handoff screen
        this.handoffScreen = document.getElementById('handoff-screen');
        this.handoffText = document.getElementById('handoff-text');
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
        this.pendingCard = null;
        this.currentPlacements = [];
        this.nodePickDone = null;
        this.handoffScreen.classList.add('hidden');
        this.gameOverScreen.classList.add('hidden');
        this.placementPanel.classList.add('hidden');
        this.cardPickModal.classList.add('hidden');

        this.tm.replenish();
    }

    // ── Rendering ─────────────────────────────────────────────

    _render() {
        const st = this.state;
        const p1 = st.players[0], p2 = st.players[1];

        this.p1ScoreEl.textContent = `${p1.score} / ${st.winScore}`;
        this.p2ScoreEl.textContent = `${p2.score} / ${st.winScore}`;
        this.p1SupplyEl.textContent = `Запас: ${p1.supply}`;
        this.p2SupplyEl.textContent = `Запас: ${p2.supply}`;
        this.p1ChipsEl.textContent = `Фишки: ${p1.chipsOnBoard}`;
        this.p2ChipsEl.textContent = `Фишки: ${p2.chipsOnBoard}`;
        this.deckCountEl.textContent = `Колода: ${st.deck.count}`;
        this.discardCountEl.textContent = `Сброс: ${st.discard.length}`;

        const phaseNames = { Replenish: 'Восполнение', Action: 'Действия', Task: 'Задача' };
        this.phaseEl.textContent = phaseNames[st.phase] || st.phase;
        this.turnEl.textContent = `Ход Игрока ${st.currentPI + 1}`;

        // Active player highlight
        document.getElementById('p1-panel').classList.toggle('active-player', st.currentPI === 0);
        document.getElementById('p2-panel').classList.toggle('active-player', st.currentPI === 1);

        // Chips left indicator
        const inAction = st.phase === Phase.Action;
        const chipsLeft = st.chipsAllowed - st.chipsPlaced;
        this.chipsLeftEl.textContent = inAction ? `Фишек для расстановки: ${chipsLeft}` : '';
        this.chipsLeftEl.style.display = inAction ? '' : 'none';

        // Buttons visibility
        document.getElementById('btn-end-action').style.display = inAction ? '' : 'none';
        document.getElementById('btn-utilize').style.display = st.phase === Phase.Task ? '' : 'none';
        document.getElementById('btn-skip').style.display = st.phase === Phase.Task ? '' : 'none';

        // Dynamic revealed labels
        const oppIdx = 1 - st.currentPI;
        document.querySelector('#opp-revealed').previousElementSibling.textContent =
            `Раскрытые карты Игрока ${oppIdx + 1}`;

        this._renderBoard();
        this._renderHand();
        this._renderRevealed();
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

        const costColor = card.cost < 0 ? '#f66' : card.cost >= 3 ? '#fc6' : '#adf';
        el.innerHTML = `
            <div class="card-cost" style="background:${costColor}">${card.cost}</div>
            <div class="card-name">${card.name}</div>
            <div class="card-pattern">${this._patternSVG(card.pattern)}</div>
            <div class="card-fx">${this._describeEffects(card)}</div>
        `;

        if (interactive) {
            el.addEventListener('click', () => this._onCardTap(card, isPlayable));
        } else {
            // Opponent's revealed — show detail on tap, but can also be played
            el.addEventListener('click', () => this._onCardTap(card, isPlayable));
        }

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
        // Background
        svg += `<rect width="${size}" height="${size}" fill="transparent"/>`;
        // Grid dots
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
            const t = fx.constructor.name.replace('Effect', '');
            const n = fx.n || fx.count || '';
            const tgt = fx.target === Target.Self ? '' : fx.target === Target.Opp ? '(пр)' : '';
            return `${t}${n}${tgt}`;
        }).join(' + ');
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
        const result = this.tm.placeChip(r, c);
        if (result === 'ok') {
            this._renderBoard();
            if (this.state.phase === Phase.Action) this._highlightEmptyNodes();
        }
    }

    _onCardTap(card, isPlayable) {
        if (this.state.phase !== Phase.Task) return;

        // Deselect if same card
        if (this.pendingCard === card) {
            this.pendingCard = null;
            this._render();
            return;
        }

        this.pendingCard = card;
        this._render();

        // If playable, show placement selector
        if (isPlayable) {
            const placements = this.tm.getValidPlacements(card);
            if (placements.length > 0) {
                this.currentPlacements = placements;
                this.placementIndex = 0;
                this._showPlacementPanel();
            }
        }
    }

    _onEndAction() {
        this.tm.endAction();
    }

    _onUtilize() {
        if (!this.pendingCard) {
            this._showMessage('Сначала выберите карту');
            return;
        }
        this.tm.utilizeCard(this.pendingCard, result => {
            this.pendingCard = null;
            this._render();
            if (result === 'ok') this._showHandoff();
        });
    }

    _onSkip() {
        const ok = this.tm.skipTask();
        if (ok) {
            this.pendingCard = null;
            this._render();
            this._showHandoff();
        }
    }

    // ── Placement panel ────────────────────────────────────────

    _showPlacementPanel() {
        this.placementPanel.classList.remove('hidden');
        this._updatePlacementHighlight();
    }

    _updatePlacementHighlight() {
        const placement = this.currentPlacements[this.placementIndex];
        this._highlightNodes(placement.chipPositions);
        this.placementCount.textContent = `${this.placementIndex + 1} / ${this.currentPlacements.length}`;
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
        this.placementPanel.classList.add('hidden');
        this._clearHighlights();
        const card = this.pendingCard;
        const placement = this.currentPlacements[this.placementIndex];
        this.pendingCard = null;
        this.tm.playCard(card, placement, result => {
            this._render();
            if (result === 'ok') this._showHandoff();
        });
    }

    // ── Node picking ───────────────────────────────────────────

    _startNodePick(allowed, count, done) {
        this.nodePickAllowed = [...allowed];
        this.nodePickRemaining = count;
        this.nodePickResult = [];
        this.nodePickDone = done;
        this._highlightNodes(this.nodePickAllowed);
        this._showMessage(`Выберите ${count} узел(а) на доске`);
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
            done(result);
        } else {
            this._highlightNodes(this.nodePickAllowed);
        }
    }

    // ── Handoff screen ─────────────────────────────────────────

    _showHandoff() {
        const nextPlayer = this.state.currentPI + 1;
        this.handoffText.textContent = `Передайте устройство Игроку ${nextPlayer}`;
        this.handoffScreen.classList.remove('hidden');
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
            item.innerHTML = `<strong>${card.name}</strong> [${card.cost}]`;
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
