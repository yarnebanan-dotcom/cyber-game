// ═══════════════════════════════════════════════════════════
//  КИБЕР — E2E full game: host+guest через Playwright до победы
// ═══════════════════════════════════════════════════════════
//
//  Что делает:
//    · Поднимает 2 браузерных контекста (host/guest)
//    · Играет полноценными картами (без инъекций) через настоящий UI
//    · Обрабатывает ВСЕ RPC-модалы: card-pick (Dig/Reveal/Discard),
//      steal-pick, node-pick (PlaceChips effect)
//    · После каждого хода проверяет синхронность состояний host↔guest
//    · Идёт до game-over или MAX_TURNS
//
//  Запуск:
//    node _test-e2e-full.js                        # 2p easy, 1 партия
//    N=3 MODE=2p  node _test-e2e-full.js
//    MODE=2ph     node _test-e2e-full.js           # hard
//    HEADED=1     node _test-e2e-full.js           # видеть
//    MAX_TURNS=200 VIEWPORT=360x640 node ...
//
// ═══════════════════════════════════════════════════════════

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL      = 'http://localhost:8765/';
const OUT      = '/tmp/cyber-e2e-full';
const N_GAMES  = parseInt(process.env.N || '1', 10);
const MODE     = (process.env.MODE || '2p').toLowerCase();    // 2p | 2ph
const HEADED   = !!process.env.HEADED;
const MAX_TURNS= parseInt(process.env.MAX_TURNS || '150', 10);
const [VW, VH] = (process.env.VIEWPORT || '375x800').split('x').map(s => parseInt(s, 10));
const VIEWPORT = { width: VW, height: VH };

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[e2e]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Базовые хелперы UI ───────────────────────────────────────
async function waitUI(page) { await page.waitForFunction(() => !!window.ui, { timeout: 15000 }); }

async function setupClient(browser, label) {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    page.on('pageerror', e => log(`[${label}] PAGE ERROR:`, e.message));
    page.on('console', msg => {
        const t = msg.type();
        if (t === 'error') log(`[${label}] console.error:`, msg.text());
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitUI(page);
    return { ctx, page, label };
}

async function hostCreate(page, hard) {
    if (hard) await page.evaluate(() => document.getElementById('btn-hard-mode').click());
    await page.evaluate(() => document.getElementById('btn-mode-online').click());
    await sleep(300);
    await page.evaluate(() => document.getElementById('btn-online-host').click());
    await page.waitForFunction(() => {
        const t = document.getElementById('online-host-code')?.textContent?.trim();
        return t && t.length === 4 && t !== '————';
    }, { timeout: 15000 });
    return page.$eval('#online-host-code', el => el.textContent.trim());
}

async function guestJoin(page, code) {
    await page.evaluate(() => document.getElementById('btn-mode-online').click());
    await sleep(300);
    await page.evaluate(() => document.getElementById('btn-online-join').click());
    await sleep(200);
    await page.fill('#online-join-input', code);
    await page.click('#btn-online-join-confirm');
    await page.waitForFunction(() => !!window.ui?.state?.board, { timeout: 15000 });
}

async function waitConnected(hostPage) {
    await hostPage.waitForFunction(() => window.ui?.net?.connected === true, { timeout: 15000 });
}

// ── Чтение состояния ─────────────────────────────────────────
async function readState(page) {
    return page.evaluate(() => {
        const ui = window.ui;
        if (!ui?.state) return null;
        const st = ui.state;
        return {
            currentPI: st.currentPI, phase: st.phase,
            chipsPlaced: st.chipsPlaced, chipsAllowed: st.chipsAllowed,
            tasksThisTurn: st.tasksThisTurn, utilizesThisTurn: st.utilizesThisTurn,
            deckCount: st.deck?.count ?? 0,
            discardCount: st.discard?.length ?? 0,
            boardSize: st.board.size,
            players: st.players.map(p => ({
                idx: p.idx,
                score: p.score, supply: p.supply,
                hand: p.hand.length, revealed: p.revealed.length,
                chipsOnBoard: p.chipsOnBoard, reserve: p.totalChips - p.chipsOnBoard,
                pending: p.pendingActions?.length ?? 0,
            })),
            isGameOver: !!ui.tm?.isGameOver,
            winner: ui.tm?.winner ?? -1,
            localPI: ui.localPI ?? null,
        };
    });
}

function stateEqDiff(a, b) {
    if (!a || !b) return 'null';
    if (a.currentPI !== b.currentPI) return `currentPI ${a.currentPI}!=${b.currentPI}`;
    if (a.phase !== b.phase) return `phase ${a.phase}!=${b.phase}`;
    if (a.deckCount !== b.deckCount) return `deck ${a.deckCount}!=${b.deckCount}`;
    if (a.discardCount !== b.discardCount) return `discard ${a.discardCount}!=${b.discardCount}`;
    if (a.players.length !== b.players.length) return 'playersLen';
    for (let i = 0; i < a.players.length; i++) {
        const pa = a.players[i], pb = b.players[i];
        if (pa.score !== pb.score) return `p${i}.score ${pa.score}!=${pb.score}`;
        if (pa.supply !== pb.supply) return `p${i}.supply ${pa.supply}!=${pb.supply}`;
        if (pa.chipsOnBoard !== pb.chipsOnBoard) return `p${i}.chips ${pa.chipsOnBoard}!=${pb.chipsOnBoard}`;
        if (pa.revealed !== pb.revealed) return `p${i}.revealed ${pa.revealed}!=${pb.revealed}`;
    }
    return null;
}

// Открыт ли хоть один модал / ждёт ли клиент ввода?
async function isBusy(page) {
    return page.evaluate(() => {
        const open = id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
        };
        if (open('card-pick-modal') || open('steal-pick-modal') || open('synth-order-panel') || open('handoff-overlay')) return true;
        const ui = window.ui;
        if (ui?.nodePickDone) return true;
        // host ещё не прокачал pending-очередь?
        const st = ui?.state;
        if (st?.players?.some(p => (p.pendingActions?.length || 0) > 0)) return true;
        return false;
    });
}

async function waitQuiescent(hostPage, guestPage, timeout = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        const [bh, bg] = await Promise.all([isBusy(hostPage), isBusy(guestPage)]);
        if (!bh && !bg) return true;
        await sleep(80);
    }
    return false;
}

async function stateEqRetry(hostPage, guestPage, attempts = 8, delay = 150) {
    let lastDiff = 'init', sH = null, sG = null;
    for (let i = 0; i < attempts; i++) {
        [sH, sG] = await Promise.all([readState(hostPage), readState(guestPage)]);
        lastDiff = stateEqDiff(sH, sG);
        if (!lastDiff) return { ok: true, sH, sG };
        await sleep(delay);
    }
    return { ok: false, sH, sG, diff: lastDiff };
}

// ── Обработка модалов (общая) ────────────────────────────────
// Возвращает true если что-то закрыли (повторяем пока true)
async function handleAnyModalOnce(page, rng) {
    return page.evaluate((r) => {
        const rand = () => r;   // примитивный «рандом» из Node

        // 1. card-pick-modal (items have class .pick-item)
        const cpm = document.getElementById('card-pick-modal');
        if (cpm && !cpm.classList.contains('hidden')) {
            const list = cpm.querySelectorAll('#card-pick-list .pick-item');
            const countTxt = cpm.querySelector('#card-pick-count')?.textContent || '';
            const m = countTxt.match(/(\d+)\s*\/\s*(\d+)/);
            const need = m ? parseInt(m[2], 10) : list.length;
            const chosen = cpm.querySelectorAll('#card-pick-list .pick-item.selected').length;
            if (chosen < need) {
                const unselected = [...list].filter(c => !c.classList.contains('selected'));
                if (!unselected.length) return { kind: 'card-pick-empty', need, chosen };
                const pick = unselected[Math.floor(Math.random() * unselected.length)];
                pick.click();
                return { kind: 'card-pick-select', need, chosen: chosen + 1 };
            }
            const btn = cpm.querySelector('#card-pick-confirm');
            if (btn && !btn.disabled) {
                btn.click();
                return { kind: 'card-pick-confirm' };
            }
            return { kind: 'card-pick-waiting', need, chosen };
        }

        // 2. steal-pick-modal
        const spm = document.getElementById('steal-pick-modal');
        if (spm && !spm.classList.contains('hidden')) {
            const revealed = spm.querySelectorAll('.sp-rev-item');
            const blind = spm.querySelectorAll('.sp-blind-btn');
            const pool = [...revealed, ...blind];
            if (pool.length) {
                const pick = pool[Math.floor(Math.random() * pool.length)];
                pick.click();
                return { kind: 'steal-pick' };
            }
            return { kind: 'steal-pick-empty' };
        }

        // 3. node-pick state (PlaceChipsEffect)
        const ui = window.ui;
        if (ui?.nodePickDone && ui.nodePickAllowed?.length) {
            const [r, c] = ui.nodePickAllowed[Math.floor(Math.random() * ui.nodePickAllowed.length)];
            const cell = document.querySelector(`.node[data-r="${r}"][data-c="${c}"]`);
            cell?.click();
            return { kind: 'node-pick', r, c };
        }

        // 4. synth order panel (id=synth-order-panel, кнопки .synth-order-btn)
        const synth = document.getElementById('synth-order-panel');
        if (synth && !synth.classList.contains('hidden')) {
            const btns = synth.querySelectorAll('.synth-order-btn');
            btns[0]?.click();
            return { kind: 'synth-order' };
        }

        // 5. handoff overlay (hot-seat) — не должно быть в онлайне
        const ho = document.getElementById('handoff-overlay');
        if (ho && !ho.classList.contains('hidden')) {
            const btn = ho.querySelector('button');
            btn?.click();
            return { kind: 'handoff' };
        }

        return null;
    }, Math.random());
}

async function drainModals(page, maxRounds = 25) {
    let drained = [];
    for (let i = 0; i < maxRounds; i++) {
        const r = await handleAnyModalOnce(page);
        if (!r) break;
        drained.push(r.kind);
        await sleep(120);
    }
    return drained;
}

// ── Агент: сделать ход на своей page ─────────────────────────
async function agentMove(page, turnLabel) {
    // 1. Если modal открыт (pending с прошлого хода / replenish input) — закрыть
    await drainModals(page);

    // 1b. Replenish → Turn (для PI=0 при старте партии не вызывается автоматически)
    for (let i = 0; i < 5; i++) {
        const s = await readState(page);
        if (!s || s.phase !== 'Replenish') break;
        await page.evaluate(() => window.ui?.tm?.replenish?.()).catch(() => {});
        await sleep(250);
    }

    // 2. Поставить фишки (до chipsAllowed)
    let guard = 8;
    while (guard-- > 0) {
        const s = await readState(page);
        if (!s || s.phase !== 'Turn') break;
        if (s.chipsPlaced >= s.chipsAllowed) break;
        if (s.players[s.currentPI].reserve <= 0) break;
        const empties = await page.evaluate(() => {
            const st = window.ui.state;
            const out = [];
            for (let r = 0; r < st.board.size; r++)
                for (let c = 0; c < st.board.size; c++)
                    if (st.board.nodes[r][c] === 0) out.push([r, c]);
            return out;
        });
        if (!empties.length) break;
        const [r, c] = empties[Math.floor(Math.random() * empties.length)];
        await page.click(`.node[data-r="${r}"][data-c="${c}"]`, { timeout: 3000 }).catch(() => {});
        await sleep(100);
    }

    // 3. Попытаться разыграть playable карты (до 2 task + 2 util)
    guard = 10;
    while (guard-- > 0) {
        await drainModals(page);
        const s = await readState(page);
        if (!s || s.isGameOver) return;
        if (s.tasksThisTurn >= 2 && s.utilizesThisTurn >= 2) break;

        const info = await page.evaluate(() => {
            const cards = document.querySelectorAll('#hand-cards .card');
            return [...cards].map((el, i) => ({
                i, playable: el.classList.contains('playable'),
                unplayable: el.classList.contains('unplayable'),
                name: el.querySelector('.card-name')?.textContent?.trim() || '?',
            }));
        });
        const playableIdx = info.findIndex(c => c.playable);
        if (playableIdx === -1) break;

        // Клик по карте: активирует armedPlayState → currentPlacements
        await page.evaluate((idx) => {
            document.querySelectorAll('#hand-cards .card')[idx]?.click();
        }, playableIdx);
        await sleep(250);

        // Armed state: узнаём placements
        const arm = await page.evaluate(() => ({
            armed: !!window.ui.pendingCard,
            name: window.ui.pendingCard?.name,
            placements: (window.ui.currentPlacements || []).length,
            firstChips: window.ui.currentPlacements?.[0]?.chipPositions || null,
        }));

        if (!arm.armed) break;
        if (!arm.firstChips) break;

        // Тап по фишкам паттерна — запускает эффект и playCard
        for (const [r, c] of arm.firstChips) {
            await page.click(`.node[data-r="${r}"][data-c="${c}"]`, { timeout: 3000 }).catch(() => {});
            await sleep(100);
        }
        // После этого могут открыться модалы (Dig/Reveal/Discard/Steal/Place)
        await sleep(250);
        await drainModals(page);
        await sleep(200);
    }

    // 3b. Утилизация: если ничего не сыграли — попробовать утилизировать карту с utilizeEffect
    guard = 6;
    while (guard-- > 0) {
        await drainModals(page);
        const s = await readState(page);
        if (!s || s.isGameOver) return;
        if (s.utilizesThisTurn >= 2) break;

        const utilInfo = await page.evaluate(() => {
            const st = window.ui.state;
            const pi = st.currentPI;
            return st.players[pi].hand.map((c, i) => ({
                i, name: c.name,
                hasUtil: !!c.utilizeEffect?.hasEffects,
            }));
        });
        const utilIdx = utilInfo.findIndex(c => c.hasUtil);
        if (utilIdx === -1) break;

        // Клик по карте → pendingCard, затем #btn-utilize
        await page.evaluate(i => document.querySelectorAll('#hand-cards .card')[i]?.click(), utilIdx);
        await sleep(150);
        const armed = await page.evaluate(() => !!window.ui.pendingCard);
        if (!armed) break;
        const utilBtn = await page.$('#btn-utilize');
        if (!utilBtn) { await page.evaluate(i => document.querySelectorAll('#hand-cards .card')[i]?.click(), utilIdx); break; }
        try { await utilBtn.click({ timeout: 2000 }); } catch (_) { break; }
        await sleep(250);
        await drainModals(page);
        await sleep(200);
    }

    // 3c. Hard-mode fallback: если ни одной фишки не поставлено и ничего не сыграно — взять +3
    const sPre = await readState(page);
    if (sPre && sPre.chipsPlaced === 0 && sPre.tasksThisTurn === 0 && sPre.utilizesThisTurn === 0) {
        const drawBtn = await page.$('#btn-draw-three:not([disabled])');
        if (drawBtn) { try { await drawBtn.click({ timeout: 2000 }); } catch (_) {} await sleep(200); }
    }

    // 4. endTurn
    await drainModals(page);
    const btn = await page.$('#btn-skip');
    if (btn) {
        try { await btn.click({ timeout: 3000 }); } catch (_) {}
    } else {
        // fallback: прямой вызов
        await page.evaluate(() => window.ui?.tm?.endTurn?.());
    }
    await sleep(300);
}

async function isGameOverUI(page) {
    return page.evaluate(() => {
        const go = document.getElementById('gameover-screen');
        return !!go && !go.classList.contains('hidden');
    });
}

async function waitTurnFor(page, pi, timeout = 10000) {
    await page.waitForFunction(
        (expected) => window.ui?.state?.currentPI === expected,
        pi, { timeout }
    );
}

// ── Один матч ────────────────────────────────────────────────
async function playOneGame(host, guest, gameIdx) {
    log(`── Game #${gameIdx} ──`);

    const code = await hostCreate(host.page, MODE.endsWith('h'));
    log(`  code=${code}`);
    await guestJoin(guest.page, code);
    await waitConnected(host.page);
    log(`  connected`);

    let turns = 0;
    let syncMismatches = 0;
    const playedCards = { host: [], guest: [] };

    while (turns < MAX_TURNS) {
        // Чей ход?
        const s = await readState(host.page);
        if (!s) break;
        if (s.isGameOver) break;

        const piToMove = s.currentPI;
        const side = piToMove === 0 ? host : guest;
        const other = piToMove === 0 ? guest : host;
        const label = piToMove === 0 ? 'HOST' : 'GUEST';

        // Side играет, но в это время other тоже может получить RPC-модал — крутим оба
        // (простая стратегия: параллельный drain на other всё время хода)
        const otherDrainer = (async () => {
            while (true) {
                const sA = await readState(host.page).catch(() => null);
                if (!sA || sA.currentPI !== piToMove) return;
                await drainModals(other.page);
                await sleep(150);
            }
        })();

        const sidePreTurn = await readState(side.page);
        await agentMove(side.page, `T${turns} ${label}`);
        // дадим other закрыть последние модалы
        await sleep(400);
        await drainModals(other.page);
        await sleep(200);

        turns++;

        // Дождёмся "тишины" (никто не ждёт ввода, pendingActions пустые), потом синк
        await waitQuiescent(host.page, guest.page, 1500);
        const res = await stateEqRetry(host.page, guest.page, 6, 120);
        const sH = res.sH, sG = res.sG;
        if (!res.ok) {
            syncMismatches++;
            log(`  ⚠ T${turns} ${label}: host/guest DESYNC (${res.diff})`);
            log(`    HOST: ${JSON.stringify(sH)}`);
            log(`    GUEST: ${JSON.stringify(sG)}`);
        }

        // Логируем разыгранные карты — по приросту discard
        // (упрощённо: просто фиксируем delta)
        if (turns % 10 === 0) {
            log(`  T${turns} ${label} score=[${sH.players.map(p => p.score)}] deck=${sH.deckCount} disc=${sH.discardCount} hands=[${sH.players.map(p => p.hand)}]`);
        }

        if (sH.isGameOver) break;
        // Дождёмся otherDrainer cleanup
        await Promise.race([otherDrainer, sleep(100)]);
    }

    const finalH = await readState(host.page);
    const finalG = await readState(guest.page);
    const gover = await isGameOverUI(host.page);

    await host.page.screenshot({ path: path.join(OUT, `game${gameIdx}-host-final.png`) });
    await guest.page.screenshot({ path: path.join(OUT, `game${gameIdx}-guest-final.png`) });

    const res = {
        game: gameIdx,
        turns,
        done: finalH?.isGameOver,
        winner: finalH?.winner,
        scores: finalH?.players.map(p => p.score),
        syncMismatches,
        gameOverOverlay: gover,
        timedOut: !finalH?.isGameOver,
    };
    log(`  → ${JSON.stringify(res)}`);
    return res;
}

// ── MAIN ─────────────────────────────────────────────────────
async function main() {
    log(`═══ E2E FULL ═══ N=${N_GAMES} MODE=${MODE} VP=${VW}x${VH} MAX_TURNS=${MAX_TURNS}`);
    const browser = await chromium.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: !HEADED,
    });
    const t0 = Date.now();
    const results = [];
    try {
        for (let g = 1; g <= N_GAMES; g++) {
            const host = await setupClient(browser, 'HOST');
            const guest = await setupClient(browser, 'GUEST');
            try {
                const r = await playOneGame(host, guest, g);
                results.push(r);
            } catch (e) {
                log(`Game #${g} CRASH:`, e.message, e.stack?.split('\n').slice(0, 5).join('\n'));
                results.push({ game: g, crashed: true, error: e.message });
            } finally {
                await host.ctx.close();
                await guest.ctx.close();
            }
        }
    } finally {
        await browser.close();
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);

    // Сводка
    log(`\n═══ ИТОГИ ═══ ${dt}s`);
    let wins = 0, timeouts = 0, crashes = 0, desyncs = 0;
    for (const r of results) {
        if (r.crashed) crashes++;
        else if (r.done) wins++;
        else if (r.timedOut) timeouts++;
        desyncs += r.syncMismatches || 0;
    }
    log(`Всего: ${results.length}  Выигран до конца: ${wins}  Тайм-аут: ${timeouts}  Краш: ${crashes}`);
    log(`Десинхронизаций host↔guest за все матчи: ${desyncs}`);
    for (const r of results) log(`  ${JSON.stringify(r)}`);
    process.exit(crashes > 0 ? 1 : 0);
}

main().catch(e => { log('FATAL:', e); process.exit(2); });
