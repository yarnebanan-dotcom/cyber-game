// ═══════════════════════════════════════════════════════════
//  КИБЕР — Network layer (PeerJS / WebRTC)
// ═══════════════════════════════════════════════════════════
//
//  Хост авторитативен: держит GameState + TurnManager.
//  Гость — тонкий клиент: отображает snapshot и шлёт действия.
//
//  Протокол сообщений:
//    { type: 'hello', role: 'guest' }                     guest → host
//    { type: 'state', snapshot }                          host → guest
//    { type: 'action', name, args }                       guest → host
//    { type: 'input-req', reqId, kind, pi, ctx, payload } host → guest
//    { type: 'input-res', reqId, chosen }                 guest → host
//    { type: 'game-over', winner }                        host → guest
//    { type: 'ping' } / { type: 'pong' }                  keepalive
//
// ═══════════════════════════════════════════════════════════

class Net {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.role = null;        // 'host' | 'guest'
        this.code = null;
        this.connected = false;

        // Callbacks (назначаются извне)
        this.onMessage = null;       // (msg) => void
        this.onPeerConnected = null; // () => void
        this.onDisconnect = null;    // () => void
        this.onReconnect = null;     // () => void
        this.onError = null;         // (err) => void

        // Внутреннее
        this._pendingRequests = new Map();  // reqId → resolve
        this._reqCounter = 0;
        this._lastPingTs = 0;
        this._pingInterval = null;
        this._reconnectTimer = null;
        this._reconnectAttempts = 0;
    }

    static _genCode() {
        // 4 символа, только буквы и цифры 2-9 (без I/O/0/1 для читаемости)
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
        return s;
    }

    static _peerIdFor(code) { return 'cyber-game-' + code.toLowerCase(); }

    // Единый PeerJS cloud — host и guest ОБЯЗАНЫ быть на одном signalling сервере,
    // иначе они друг друга не увидят (peer-unavailable). Fallback между серверами ломает это.
    static _peerOpts() {
        return {
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' },
                ],
            },
        };
    }

    // ── Host ────────────────────────────────────────────────────
    async hostGame(retry = 0) {
        if (retry > 8) throw new Error('Не удалось создать игру — попробуй ещё раз (сервер перегружен)');
        this.role = 'host';
        this.code = Net._genCode();
        const peerId = Net._peerIdFor(this.code);

        return new Promise((resolve, reject) => {
            console.log('[NET host] peerId=%s', peerId);
            this.peer = new Peer(peerId, Net._peerOpts());
            let settled = false;

            const openTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                console.warn('[NET host] таймаут open — retry %d', retry);
                try { this.peer.destroy(); } catch (_) {}
                this.peer = null;
                setTimeout(() => this.hostGame(retry + 1).then(resolve, reject), 1000);
            }, 15000);

            this.peer.on('open', () => {
                if (settled) return;
                settled = true;
                clearTimeout(openTimer);
                console.log('[NET host] открыт, code=%s', this.code);
                resolve(this.code);
            });

            this.peer.on('error', (e) => {
                console.warn('[NET host] error type=%s, msg=%s', e.type, e.message);
                if (settled) { this.onError?.(e); return; }
                if (e.type === 'unavailable-id') {
                    settled = true;
                    clearTimeout(openTimer);
                    try { this.peer.destroy(); } catch (_) {}
                    this.peer = null;
                    this.hostGame(retry + 1).then(resolve, reject);
                } else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') {
                    settled = true;
                    clearTimeout(openTimer);
                    try { this.peer.destroy(); } catch (_) {}
                    this.peer = null;
                    setTimeout(() => this.hostGame(retry + 1).then(resolve, reject), 1500);
                } else {
                    settled = true;
                    clearTimeout(openTimer);
                    this.onError?.(e);
                    reject(new Error(`Ошибка сервера: ${e.type || 'unknown'}`));
                }
            });

            this.peer.on('connection', (conn) => {
                if (this.conn) {
                    try { this.conn.close(); } catch (_) {}
                }
                this._bindConn(conn, /*isReconnect*/ this.connected);
            });

            this.peer.on('disconnected', () => {
                try { this.peer.reconnect(); } catch (_) {}
            });
        });
    }

    // ── Guest ───────────────────────────────────────────────────
    // retry 0..5: на peer-unavailable и network пробуем ещё несколько раз с задержкой —
    // signalling сервер иногда «теряет» только что зарегистрированного host-а.
    async joinGame(code, retry = 0) {
        this.role = 'guest';
        this.code = code.trim().toUpperCase();
        const targetPeerId = Net._peerIdFor(this.code);

        return new Promise((resolve, reject) => {
            console.log('[NET guest] target=%s, retry=%d', targetPeerId, retry);
            this.peer = new Peer(Net._peerOpts());
            let resolved = false;

            const retryOrFail = (errMsg, delayMs = 1500) => {
                if (resolved) return;
                resolved = true;
                try { this.peer.destroy(); } catch (_) {}
                this.peer = null;
                if (retry < 5) {
                    console.warn('[NET guest] retry %d через %dмс (%s)', retry + 1, delayMs, errMsg);
                    setTimeout(() => this.joinGame(code, retry + 1).then(resolve, reject), delayMs);
                } else {
                    reject(new Error(errMsg));
                }
            };

            this.peer.on('open', () => {
                console.log('[NET guest] peer open, connecting к %s...', targetPeerId);
                const conn = this.peer.connect(targetPeerId, { reliable: true });
                this._bindConn(conn, false);

                conn.on('open', () => {
                    if (resolved) return;
                    resolved = true;
                    console.log('[NET guest] conn open ✓');
                    conn.send({ type: 'hello', role: 'guest' });
                    resolve();
                });

                setTimeout(() => {
                    if (resolved) return;
                    console.warn('[NET guest] таймаут подключения (retry=%d)', retry);
                    retryOrFail('Хост не найден. Проверь код или попроси создать игру заново.', 2000);
                }, 20000);
            });

            this.peer.on('error', (e) => {
                console.warn('[NET guest] error type=%s, msg=%s', e.type, e.message);
                if (e.type === 'peer-unavailable') {
                    retryOrFail('Хост не найден. Проверь код или попроси создать игру заново.', 2000);
                    return;
                }
                if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') {
                    retryOrFail('Ошибка сети. Проверь интернет.', 1500);
                    return;
                }
                if (!resolved) {
                    resolved = true;
                    try { this.peer.destroy(); } catch (_) {}
                    reject(new Error(`Ошибка: ${e.type || e.message || 'неизвестно'}`));
                } else {
                    this.onError?.(e);
                }
            });

            this.peer.on('disconnected', () => {
                try { this.peer.reconnect(); } catch (_) {}
            });
        });
    }

    // ── Переподключение от гостя (тот же код) ──────────────────
    reconnectGuest() {
        if (this.role !== 'guest' || !this.code || !this.peer) return;
        try { this.conn?.close(); } catch (_) {}
        const targetPeerId = Net._peerIdFor(this.code);
        const conn = this.peer.connect(targetPeerId, { reliable: true });
        this._bindConn(conn, true);
        conn.on('open', () => conn.send({ type: 'hello', role: 'guest', reconnect: true }));
    }

    // Запускает цикл попыток реконнекта у гостя.
    // maxAttempts=20, интервал=3с → ~1 минута. onGiveUp вызывается если все попытки провалились.
    startReconnectLoop(onAttempt, onGiveUp, maxAttempts = 20) {
        if (this.role !== 'guest') return;
        this._stopReconnectLoop();
        this._reconnectAttempts = 0;
        const tick = () => {
            if (this.connected) { this._stopReconnectLoop(); return; }
            this._reconnectAttempts++;
            onAttempt?.(this._reconnectAttempts, maxAttempts);
            if (this._reconnectAttempts > maxAttempts) {
                this._stopReconnectLoop();
                onGiveUp?.();
                return;
            }
            try { this.reconnectGuest(); } catch (_) {}
        };
        tick();
        this._reconnectTimer = setInterval(tick, 3000);
    }
    _stopReconnectLoop() {
        if (this._reconnectTimer) { clearInterval(this._reconnectTimer); this._reconnectTimer = null; }
        this._reconnectAttempts = 0;
    }

    // ── Общие ───────────────────────────────────────────────────
    _bindConn(conn, isReconnect) {
        this.conn = conn;

        conn.on('open', () => {
            this.connected = true;
            if (isReconnect) this.onReconnect?.();
            else this.onPeerConnected?.();
            this._startKeepalive();
        });

        conn.on('data', (msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'pong') { this._lastPingTs = Date.now(); return; }
            if (msg.type === 'ping') { try { conn.send({ type: 'pong' }); } catch (_) {} return; }
            if (msg.type === 'input-res') {
                const resolver = this._pendingRequests.get(msg.reqId);
                if (resolver) { this._pendingRequests.delete(msg.reqId); resolver(msg.chosen); }
                return;
            }
            this.onMessage?.(msg);
        });

        conn.on('close', () => {
            this.connected = false;
            this._stopKeepalive();
            this.onDisconnect?.();
        });

        conn.on('error', (e) => {
            this.onError?.(e);
        });
    }

    _startKeepalive() {
        this._stopKeepalive();
        this._lastPingTs = Date.now();
        this._pingInterval = setInterval(() => {
            if (!this.conn?.open) return;
            try { this.conn.send({ type: 'ping' }); } catch (_) {}
            // Watchdog: нет pong дольше 15с → считаем conn мёртвым, закрываем
            if (Date.now() - this._lastPingTs > 15000) {
                try { this.conn.close(); } catch (_) {}
            }
        }, 5000);
    }
    _stopKeepalive() {
        if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    }

    // ── Отправка ───────────────────────────────────────────────
    send(msg) {
        if (!this.conn?.open) return false;
        try { this.conn.send(msg); return true; } catch (_) { return false; }
    }

    // RPC: host → guest input request. Возвращает Promise<выбранные id>
    request(kind, pi, ctx, payload) {
        return new Promise((resolve) => {
            const reqId = ++this._reqCounter;
            this._pendingRequests.set(reqId, resolve);
            const ok = this.send({ type: 'input-req', reqId, kind, pi, ctx, payload });
            if (!ok) {
                // Нет соединения — не вешаемся, вернём пусто (хост сам решит что делать)
                this._pendingRequests.delete(reqId);
                resolve(null);
            }
        });
    }

    respondToRequest(reqId, chosen) {
        this.send({ type: 'input-res', reqId, chosen });
    }

    // ── Завершение ──────────────────────────────────────────────
    disconnect() {
        this._stopKeepalive();
        this._stopReconnectLoop();
        this._pendingRequests.clear();
        try { this.conn?.close(); } catch (_) {}
        try { this.peer?.destroy(); } catch (_) {}
        this.conn = null;
        this.peer = null;
        this.connected = false;
    }
}

// ═══════════════════════════════════════════════════════════
//  STATE SERIALIZATION
// ═══════════════════════════════════════════════════════════

// Сериализуем полное состояние игры, с опциональной маской руки хоста.
function serializeGameState(st, maskHandForPI = -1) {
    const players = st.players.map((p) => ({
        idx: p.idx,
        // Маскируем только указанную руку (скрываем от гостя); руку гостя оставляем как есть
        hand: (p.idx === maskHandForPI)
            ? new Array(p.hand.length).fill(-1)
            : p.hand.map(c => c.id),
        revealed: p.revealed.map(c => c.id),
        supply: p.supply,
        score: p.score,
        chipsOnBoard: p.chipsOnBoard,
        totalChips: p.totalChips,
        bonusChipsNextTurn: p.bonusChipsNextTurn || 0,
    }));

    return {
        boardSize: st.board.size,
        nodes: st.board.nodes.map(row => [...row]),
        playerCount: st.playerCount,
        winScore: st.winScore,
        players,
        discardIds: st.discard.map(c => c.id),
        deckCount: st.deck.count,
        currentPI: st.currentPI,
        phase: st.phase,
        chipsPlaced: st.chipsPlaced,
        chipsAllowed: st.chipsAllowed,
        tasksThisTurn: st.tasksThisTurn,
        utilizesThisTurn: st.utilizesThisTurn,
        mainActionDone: st.mainActionDone,
        placedThisTurn: (st.placedThisTurn || []).map(([r, c]) => [r, c]),
        drewThreeThisTurn: !!st.drewThreeThisTurn,
        hardMode: !!st.hardMode,
    };
}

// Восстанавливаем "shadow" GameState из снимка. cardsById — Map<id, cardObj>.
function buildShadowStateFromSnapshot(snap, cardsById) {
    const st = new GameState(snap.boardSize, snap.winScore, snap.playerCount);
    applySnapshotTo(st, snap, cardsById);
    // Подменяем deck на лёгкий объект с count-геттером
    st.deck = { count: snap.deckCount, cards: [] };
    return st;
}

function applySnapshotTo(st, snap, cardsById) {
    // Доска
    st.board.size = snap.boardSize;
    st.board.nodes = snap.nodes.map(row => [...row]);

    // Игроки
    st.playerCount = snap.playerCount;
    st.winScore = snap.winScore;
    st.players = snap.players.map((p) => {
        const pl = new PlayerState(p.idx);
        pl.hand = p.hand.map(id => id === -1 ? { id: -1, name: '?', cost: 0, pattern: [], playEffect: CardEffect.None, utilizeEffect: CardEffect.None, synthesisEffect: CardEffect.None } : cardsById.get(id)).filter(Boolean);
        pl.revealed = p.revealed.map(id => cardsById.get(id)).filter(Boolean);
        pl.supply = p.supply;
        pl.score = p.score;
        pl.chipsOnBoard = p.chipsOnBoard;
        pl.totalChips = p.totalChips;
        pl.bonusChipsNextTurn = p.bonusChipsNextTurn || 0;
        return pl;
    });

    st.discard = snap.discardIds.map(id => cardsById.get(id)).filter(Boolean);
    if (st.deck) { st.deck.count = snap.deckCount; st.deck.cards = []; }

    st.currentPI = snap.currentPI;
    st.phase = snap.phase;
    st.chipsPlaced = snap.chipsPlaced;
    st.chipsAllowed = snap.chipsAllowed;
    st.tasksThisTurn = snap.tasksThisTurn;
    st.utilizesThisTurn = snap.utilizesThisTurn;
    st.mainActionDone = snap.mainActionDone;
    st.placedThisTurn = snap.placedThisTurn.map(([r, c]) => [r, c]);
    st.drewThreeThisTurn = !!snap.drewThreeThisTurn;
    st.hardMode = !!snap.hardMode;
}

// Собираем Map<id, cardObj> из единой колоды
function buildCardsById(_playerCount) {
    const cards = CardDatabase.create();
    const map = new Map();
    for (const c of cards) map.set(c.id, c);
    return map;
}

// ═══════════════════════════════════════════════════════════
//  ACTION / MATCH SERIALIZATION
// ═══════════════════════════════════════════════════════════

function serializeMatch(match) {
    if (!match) return null;
    return { chipPositions: match.chipPositions.map(([r, c]) => [r, c]) };
}
function deserializeMatch(obj) {
    if (!obj) return null;
    return { chipPositions: obj.chipPositions.map(([r, c]) => [r, c]) };
}
