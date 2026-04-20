// ═══════════════════════════════════════════════════════════
//  КИБЕР — E2E online game: host+guest, симметричный агент
// ═══════════════════════════════════════════════════════════
//
//  Цель: верифицировать что партия host↔guest идёт через net.js
//  без десинхронов и крашей. Действия — через ui.tm.* (на guest
//  это прокси, уходит в net как {type:'action', name, args}).
//
//  Запуск:
//    node _test-online-game.js
//    MODE=2ph MAX_TURNS=40 node _test-online-game.js
//    HEADED=1 node _test-online-game.js
//
//  Критерий успеха: 0 крашей, 0 десинхов. Game-over не обязателен.
// ═══════════════════════════════════════════════════════════

const { chromium } = require('playwright');

const URL       = 'http://localhost:8765/';
const MODE      = (process.env.MODE || '2p').toLowerCase();
const HEADED    = !!process.env.HEADED;
const MAX_TURNS = parseInt(process.env.MAX_TURNS || '30', 10);
const HARD_CAP_MS = parseInt(process.env.HARD_CAP_MS || '120000', 10);

const log = (...a) => console.log('[e2e]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitUI(page) {
    await page.waitForFunction(() => !!window.ui, { timeout: 15000 });
}

async function setupClient(browser, label) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => log(`[${label}] PAGE ERROR:`, e.message));
    page.on('console', msg => {
        if (msg.type() === 'error') {
            const t = msg.text();
            if (!t.includes('Failed to load resource')) log(`[${label}] err:`, t);
        }
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitUI(page);
    return { ctx, page, label };
}

async function hostCreate(page, hard) {
    if (hard) await page.evaluate(() => document.getElementById('btn-hard-mode').click());
    await page.evaluate(() => document.getElementById('btn-mode-online').click());
    await sleep(250);
    await page.evaluate(() => document.getElementById('btn-online-host').click());
    await page.waitForFunction(() => {
        const t = document.getElementById('online-host-code')?.textContent?.trim();
        return t && t.length === 4 && t !== '————';
    }, { timeout: 15000 });
    return page.$eval('#online-host-code', el => el.textContent.trim());
}

async function guestJoin(page, code) {
    await page.evaluate(() => document.getElementById('btn-mode-online').click());
    await sleep(250);
    await page.evaluate(() => document.getElementById('btn-online-join').click());
    await sleep(200);
    await page.fill('#online-join-input', code);
    await page.click('#btn-online-join-confirm');
    await page.waitForFunction(() => !!window.ui?.state?.board, { timeout: 15000 });
}

async function readState(page) {
    return page.evaluate(() => {
        const ui = window.ui;
        if (!ui?.state) return null;
        const st = ui.state;
        return {
            currentPI: st.currentPI,
            phase: st.phase,
            chipsPlaced: st.chipsPlaced,
            chipsAllowed: st.chipsAllowed,
            tasksThisTurn: st.tasksThisTurn,
            utilizesThisTurn: st.utilizesThisTurn,
            deckCount: st.deck?.count ?? 0,
            discardCount: st.discard?.length ?? 0,
            scores: st.players.map(p => p.score),
            supplies: st.players.map(p => p.supply),
            chipsOnBoard: st.players.map(p => p.chipsOnBoard),
            hands: st.players.map(p => p.hand.length),
            revealed: st.players.map(p => p.revealed.length),
            pending: st.players.map(p => p.pendingActions?.length || 0),
            isGameOver: !!ui.tm?.isGameOver,
            winner: ui.tm?.winner ?? -1,
            localPI: ui.localPI ?? null,
        };
    }).catch(() => null);
}

function diffState(a, b) {
    if (!a || !b) return 'null-state';
    const keys = ['currentPI', 'phase', 'deckCount', 'discardCount'];
    for (const k of keys) if (a[k] !== b[k]) return `${k}: ${a[k]}!=${b[k]}`;
    for (let i = 0; i < a.scores.length; i++) {
        if (a.scores[i] !== b.scores[i]) return `p${i}.score ${a.scores[i]}!=${b.scores[i]}`;
        if (a.supplies[i] !== b.supplies[i]) return `p${i}.supply ${a.supplies[i]}!=${b.supplies[i]}`;
        if (a.chipsOnBoard[i] !== b.chipsOnBoard[i]) return `p${i}.chips ${a.chipsOnBoard[i]}!=${b.chipsOnBoard[i]}`;
        if (a.revealed[i] !== b.revealed[i]) return `p${i}.revealed ${a.revealed[i]}!=${b.revealed[i]}`;
    }
    return null;
}

async function syncCheck(hostP, guestP, attempts = 8, delay = 180) {
    let last = 'init', sH = null, sG = null;
    for (let i = 0; i < attempts; i++) {
        [sH, sG] = await Promise.all([readState(hostP), readState(guestP)]);
        last = diffState(sH, sG);
        if (!last) return { ok: true, sH, sG };
        await sleep(delay);
    }
    return { ok: false, sH, sG, diff: last };
}

// ── Обработка модалов (host или guest могут получить) ─────────
async function handleModalOnce(page) {
    return page.evaluate(() => {
        const cpm = document.getElementById('card-pick-modal');
        if (cpm && !cpm.classList.contains('hidden')) {
            const items = cpm.querySelectorAll('#card-pick-list .pick-item');
            const countTxt = cpm.querySelector('#card-pick-count')?.textContent || '';
            const m = countTxt.match(/(\d+)\s*\/\s*(\d+)/);
            const need = m ? parseInt(m[2], 10) : items.length;
            const chosen = cpm.querySelectorAll('#card-pick-list .pick-item.selected').length;
            if (chosen < need) {
                const u = [...items].filter(c => !c.classList.contains('selected'));
                if (!u.length) return { kind: 'cp-stall' };
                u[Math.floor(Math.random() * u.length)].click();
                return { kind: 'cp-select' };
            }
            const btn = cpm.querySelector('#card-pick-confirm');
            if (btn && !btn.disabled) { btn.click(); return { kind: 'cp-confirm' }; }
            return { kind: 'cp-wait' };
        }
        const spm = document.getElementById('steal-pick-modal');
        if (spm && !spm.classList.contains('hidden')) {
            const pool = [...spm.querySelectorAll('.sp-rev-item'), ...spm.querySelectorAll('.sp-blind-btn')];
            if (pool.length) { pool[Math.floor(Math.random() * pool.length)].click(); return { kind: 'steal' }; }
            return { kind: 'steal-empty' };
        }
        const ui = window.ui;
        if (ui?.nodePickDone && ui.nodePickAllowed?.length) {
            const [r, c] = ui.nodePickAllowed[Math.floor(Math.random() * ui.nodePickAllowed.length)];
            document.querySelector(`.node[data-r="${r}"][data-c="${c}"]`)?.click();
            return { kind: 'node-pick' };
        }
        const synth = document.getElementById('synth-order-panel');
        if (synth && !synth.classList.contains('hidden')) {
            synth.querySelector('.synth-order-btn')?.click();
            return { kind: 'synth' };
        }
        return null;
    }).catch(() => null);
}

async function drainModals(page, rounds = 20) {
    const out = [];
    for (let i = 0; i < rounds; i++) {
        const r = await handleModalOnce(page);
        if (!r) break;
        out.push(r.kind);
        await sleep(120);
    }
    return out;
}

// ── Ход игрока через ui.tm.* (guest: прокси → net) ────────────
async function playerTurn(page) {
    // 0. Закрыть что осталось
    await drainModals(page);

    // 1. Replenish → Turn (если ещё не перешли). На host для PI=0 при
    //    старте игры replenish не вызывается автоматически — делаем вручную.
    //    На guest replenish уходит через прокси в net; дождёмся snapshot.
    for (let i = 0; i < 5; i++) {
        const s = await readState(page);
        if (!s) break;
        if (s.phase !== 'Replenish') break;
        await page.evaluate(() => window.ui.tm.replenish()).catch(() => {});
        await sleep(250);
    }

    // 2. Разместить фишки
    for (let i = 0; i < 10; i++) {
        const s = await readState(page);
        if (!s || s.phase !== 'Turn') break;
        if (s.chipsPlaced >= s.chipsAllowed) break;
        const placed = await page.evaluate(() => {
            const st = window.ui.state;
            const size = st.board.size;
            const empties = [];
            for (let r = 0; r < size; r++)
                for (let c = 0; c < size; c++)
                    if (st.board.nodes[r][c] === 0) empties.push([r, c]);
            if (!empties.length) return false;
            const [r, c] = empties[Math.floor(Math.random() * empties.length)];
            window.ui.tm.placeChip(r, c);
            return true;
        }).catch(() => false);
        if (!placed) break;
        await sleep(180);
    }

    // 2. Розыгрыш (до 2 задач)
    for (let tryIdx = 0; tryIdx < 2; tryIdx++) {
        await drainModals(page);
        const s = await readState(page);
        if (!s || s.isGameOver || s.phase !== 'Turn') break;
        if (s.tasksThisTurn >= 2) break;

        const played = await page.evaluate(() => {
            const ui = window.ui;
            const st = ui.state;
            const pi = st.currentPI;
            const own = st.players[pi];
            // Ищем playable карту в своей руке
            for (let idx = 0; idx < own.hand.length; idx++) {
                const card = own.hand[idx];
                const places = ui.tm.getValidPlacements(card);
                if (places && places.length) {
                    const placement = places[Math.floor(Math.random() * places.length)];
                    ui.tm.playCard(card, placement);
                    return { name: card.name, handIdx: idx };
                }
            }
            return null;
        }).catch(() => null);

        if (!played) break;
        await sleep(250);
        await drainModals(page);
        await sleep(200);
    }

    // 3. Утилизация (до 2)
    for (let tryIdx = 0; tryIdx < 2; tryIdx++) {
        await drainModals(page);
        const s = await readState(page);
        if (!s || s.isGameOver || s.phase !== 'Turn') break;
        if (s.utilizesThisTurn >= 2) break;

        const utilized = await page.evaluate(() => {
            const ui = window.ui;
            const st = ui.state;
            const pi = st.currentPI;
            const hand = st.players[pi].hand;
            const idx = hand.findIndex(c => c.utilizeEffect?.hasEffects);
            if (idx === -1) return null;
            ui.tm.utilizeCard(hand[idx]);
            return { name: hand[idx].name, idx };
        }).catch(() => null);

        if (!utilized) break;
        await sleep(250);
        await drainModals(page);
        await sleep(200);
    }

    // 4. Hard-mode: если 0/0/0 — draw three
    const sPre = await readState(page);
    if (sPre && sPre.chipsPlaced === 0 && sPre.tasksThisTurn === 0 && sPre.utilizesThisTurn === 0) {
        await page.evaluate(() => window.ui.tm.drawThree?.()).catch(() => {});
        await sleep(180);
    }

    // 5. endTurn
    await drainModals(page);
    await page.evaluate(() => window.ui.tm.endTurn()).catch(() => {});
    await sleep(300);
}

async function run() {
    const isHard = MODE.endsWith('h');
    log(`═══ online-game ═══ MODE=${MODE} (hard=${isHard}) MAX_TURNS=${MAX_TURNS} cap=${HARD_CAP_MS}ms`);

    const browser = await chromium.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: !HEADED,
    });

    const hardCap = setTimeout(() => {
        log('FATAL: hard cap hit, forcing exit');
        process.exit(3);
    }, HARD_CAP_MS);

    const t0 = Date.now();
    let crashed = false;
    let crashMsg = '';
    let desyncs = 0;
    let turns = 0;
    let lastState = null;
    try {
        const host = await setupClient(browser, 'HOST');
        const guest = await setupClient(browser, 'GUEST');

        const code = await hostCreate(host.page, isHard);
        log(`code=${code}`);
        await guestJoin(guest.page, code);
        await host.page.waitForFunction(() => window.ui?.net?.connected === true, { timeout: 15000 });
        log('connected');

        await sleep(500);

        while (turns < MAX_TURNS) {
            const s = await readState(host.page);
            if (!s) { log(`T${turns}: null state`); break; }
            if (s.isGameOver) { log(`gameOver winner=${s.winner} scores=${s.scores}`); break; }

            const pi = s.currentPI;
            const side = pi === 0 ? host : guest;
            await playerTurn(side.page);

            await sleep(300);
            await drainModals(host.page);
            await drainModals(guest.page);

            const res = await syncCheck(host.page, guest.page, 8, 180);
            if (!res.ok) {
                desyncs++;
                log(`⚠ T${turns} P${pi}: DESYNC ${res.diff}`);
                log(`  HOST:  ${JSON.stringify(res.sH)}`);
                log(`  GUEST: ${JSON.stringify(res.sG)}`);
            }
            lastState = res.sH;
            turns++;

            if (turns % 5 === 0 && res.sH) {
                log(`T${turns} scores=[${res.sH.scores}] deck=${res.sH.deckCount} disc=${res.sH.discardCount} hands=[${res.sH.hands}]`);
            }
            if (res.sH?.isGameOver) {
                log(`gameOver winner=${res.sH.winner} scores=${res.sH.scores}`);
                break;
            }
        }

        await host.ctx.close();
        await guest.ctx.close();
    } catch (e) {
        crashed = true;
        crashMsg = e.message + '\n' + (e.stack?.split('\n').slice(0, 6).join('\n') || '');
        log('CRASH:', crashMsg);
    } finally {
        clearTimeout(hardCap);
        await browser.close().catch(() => {});
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    log(`\n═══ ИТОГИ ═══ ${dt}s`);
    log(`turns=${turns} desyncs=${desyncs} crashed=${crashed}`);
    if (lastState) log(`final: scores=[${lastState.scores}] gameOver=${lastState.isGameOver} winner=${lastState.winner}`);

    if (crashed) process.exit(1);
    if (desyncs > 0) process.exit(2);
    log('═══ ✓ PASS ═══');
    process.exit(0);
}

run().catch(e => { log('FATAL:', e); process.exit(2); });
