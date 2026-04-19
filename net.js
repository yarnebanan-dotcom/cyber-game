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
    }

    static _genCode() {
        // 4 символа, только буквы и цифры 2-9 (без I/O/0/1 для читаемости)
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
        return s;
    }

    static _peerIdFor(code) { return 'cyber-game-' + code.toLowerCase(); }

    // ── Host ────────────────────────────────────────────────────
    async hostGame(retry = 0) {
        if (retry > 8) throw new Error('Не удалось создать игру — попробуй ещё раз');
        this.role = 'host';
        this.code = Net._genCode();
        const peerId = Net._peerIdFor(this.code);

        return new Promise((resolve, reject) => {
            this.peer = new Peer(peerId, { debug: 1 });

            this.peer.on('open', () => resolve(this.code));

            this.peer.on('error', (e) => {
                if (e.type === 'unavailable-id' || e.type === 'network') {
                    // Код занят — пробуем другой
                    try { this.peer.destroy(); } catch (_) {}
                    this.peer = null;
                    this.hostGame(retry + 1).then(resolve, reject);
                } else {
                    this.onError?.(e);
                    reject(e);
                }
            });

            this.peer.on('connection', (conn) => {
                // Только одно активное соединение; предыдущий гость может переподключаться
                if (this.conn) {
                    try { this.conn.close(); } catch (_) {}
                }
                this._bindConn(conn, /*isReconnect*/ this.connected);
            });

            this.peer.on('disconnected', () => {
                // Потеряли связь с сигнальным сервером — попробуем реконнект
                try { this.peer.reconnect(); } catch (_) {}
            });
        });
    }

    // ── Guest ───────────────────────────────────────────────────
    async joinGame(code) {
        this.role = 'guest';
        this.code = code.trim().toUpperCase();
        const targetPeerId = Net._peerIdFor(this.code);

        return new Promise((resolve, reject) => {
            this.peer = new Peer({ debug: 1 });
            let resolved = false;

            this.peer.on('open', () => {
                const conn = this.peer.connect(targetPeerId, { reliable: true });
                this._bindConn(conn, false);

                conn.on('open', () => {
                    if (!resolved) { resolved = true; resolve(); }
                    conn.send({ type: 'hello', role: 'guest' });
                });

                // Таймаут на подключение
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        try { this.peer.destroy(); } catch (_) {}
                        reject(new Error('Хост не найден. Проверь код.'));
                    }
                }, 12000);
            });

            this.peer.on('error', (e) => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error(
                        e.type === 'peer-unavailable' ? 'Хост не найден. Проверь код.' :
                        e.type === 'network' ? 'Нет сети' :
                        `Ошибка: ${e.type || e.message}`
                    ));
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
    async reconnectGuest() {
        if (this.role !== 'guest' || !this.code) return;
        try { this.conn?.close(); } catch (_) {}
        const targetPeerId = Net._peerIdFor(this.code);
        const conn = this.peer.connect(targetPeerId, { reliable: true });
        this._bindConn(conn, true);
        conn.on('open', () => conn.send({ type: 'hello', role: 'guest', reconnect: true }));
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

// Собираем Map<id, cardObj> из колоды нужного режима (2p или 3p)
function buildCardsById(playerCount) {
    const cards = playerCount === 3 ? CardDatabase.create3() : CardDatabase.create();
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
