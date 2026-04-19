// Полный e2e-тест онлайна: два браузерных контекста через Playwright.
// Покрывает: layout оверлапы, подсветку, разыгрыш карты гостем.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:8765/';
const OUT = '/tmp/cyber-online-test';
fs.mkdirSync(OUT, { recursive: true });

const log = (...args) => console.log('[test]', ...args);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dumpPageState(page, label) {
  const state = await page.evaluate(() => {
    const ui = window.ui;
    if (!ui || !ui.state) return { noState: true };
    const st = ui.state;
    const hl = document.querySelectorAll('.node.highlighted').length;
    return {
      netMode: ui.netMode || null,
      localPI: ui.localPI ?? null,
      currentPI: st.currentPI,
      phase: st.phase,
      chipsPlaced: st.chipsPlaced,
      chipsAllowed: st.chipsAllowed,
      highlighted: hl,
      boardSize: st.board?.size ?? st.boardSize,
      p0: st.players[0] ? { hand: st.players[0].hand?.length, revealed: st.players[0].revealed?.length, reserve: st.players[0].reserve, score: st.players[0].score, chipsOnBoard: st.players[0].chipsOnBoard } : null,
      p1: st.players[1] ? { hand: st.players[1].hand?.length, revealed: st.players[1].revealed?.length, reserve: st.players[1].reserve, score: st.players[1].score, chipsOnBoard: st.players[1].chipsOnBoard } : null,
    };
  });
  log(label, JSON.stringify(state));
  return state;
}

async function screenshot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function getPlayableCards(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('#hand-cards .card');
    return [...cards].map((el, i) => ({
      idx: i,
      playable: el.classList.contains('playable'),
      name: el.querySelector('.card-name')?.textContent?.trim() || el.textContent.slice(0, 40),
      cls: el.className,
    }));
  });
}

async function getLayout(page) {
  return page.evaluate(() => {
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) };
    };
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      boardWrap: rect(document.getElementById('board-wrap')),
      board: rect(document.getElementById('board')),
      handWrap: rect(document.getElementById('hand-wrap')),
      handCards: rect(document.getElementById('hand-cards')),
      revealedWrap: rect(document.getElementById('revealed-wrap')),
      hud: rect(document.getElementById('hud')),
      endTurnBtn: rect(document.getElementById('btn-skip')),
      utilizeBtn: rect(document.getElementById('btn-utilize')),
      phaseHint: rect(document.getElementById('phase-hint')),
      firstHandCard: rect(document.querySelector('#hand-cards .card')),
      lastNode: rect(document.querySelector('#board .node:last-child')),
      firstNode: rect(document.querySelector('#board .node')),
    };
  });
}

async function waitUI(page) {
  await page.waitForFunction(() => !!window.ui, { timeout: 10000 });
}

const VIEWPORT = { width: parseInt(process.env.VW || 375), height: parseInt(process.env.VH || 800) };
async function setupClient(browser, label) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  page.on('pageerror', e => log(`[${label}] PAGE ERROR:`, e.message));
  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') log(`[${label}] console.${t}:`, msg.text());
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitUI(page);
  return { ctx, page };
}

async function hostCreateGame(page) {
  await page.evaluate(() => document.getElementById('btn-mode-online').click());
  await sleep(300);
  await page.evaluate(() => document.getElementById('btn-online-host').click());
  await page.waitForFunction(() => {
    const el = document.getElementById('online-host-code');
    const t = el?.textContent?.trim();
    return t && t !== '————' && t.length === 4;
  }, { timeout: 15000 });
  return page.$eval('#online-host-code', el => el.textContent.trim());
}

async function guestJoinGame(page, code) {
  await page.evaluate(() => document.getElementById('btn-mode-online').click());
  await sleep(300);
  await page.evaluate(() => document.getElementById('btn-online-join').click());
  await sleep(200);
  await page.fill('#online-join-input', code);
  await page.click('#btn-online-join-confirm');
  await page.waitForFunction(() => {
    return !!window.ui?.state?.board;
  }, { timeout: 15000 });
}

async function waitConnected(hostPage) {
  await hostPage.waitForFunction(() => window.ui?.net?.connected === true, { timeout: 15000 });
}

async function findEmptyNodes(page) {
  return page.evaluate(() => {
    const st = window.ui.state;
    const size = st.board.size;
    const empties = [];
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (st.board.nodes[r][c] === 0) empties.push([r, c]);
    return empties;
  });
}

async function tapNode(page, r, c) {
  const sel = `.node[data-r="${r}"][data-c="${c}"]`;
  const hit = await page.$(sel);
  if (!hit) throw new Error(`node ${r},${c} not found`);
  await hit.click();
  await sleep(150);
}

async function clickEndTurn(page) {
  // Если открыт card-pick модал — закрыть выбором первых N карт
  await dismissModals(page);
  await page.click('#btn-skip');
  await sleep(300);
}

// Закрываем возможные модалы/node-pick
async function dismissModals(page) {
  // 1. Card-pick модал — выбрать первые N и подтвердить
  const hasCardModal = await page.evaluate(() => {
    const m = document.getElementById('card-pick-modal');
    return m && !m.classList.contains('hidden');
  });
  if (hasCardModal) {
    await page.evaluate(() => {
      const modal = document.getElementById('card-pick-modal');
      const cards = modal.querySelectorAll('.card');
      if (cards.length) cards[0].click();
      const ok = modal.querySelector('#card-pick-confirm, .cp-confirm, .confirm-btn, button');
      if (ok) ok.click();
    });
    await sleep(500);
  }
  // 2. Node-pick состояние — nodePickDone != null. Тапаем один из разрешённых узлов.
  const nodePick = await page.evaluate(() => {
    const ui = window.ui;
    if (!ui?.nodePickDone) return null;
    return ui.nodePickAllowed?.map(([r, c]) => [r, c]) || [];
  });
  if (nodePick && nodePick.length > 0) {
    const [r, c] = nodePick[0];
    await tapNode(page, r, c);
    await sleep(400);
  }
}

async function waitTurn(page, pi, timeout = 8000) {
  await page.waitForFunction(
    (expectedPI) => window.ui?.state?.currentPI === expectedPI && window.ui?.state?.phase === 'Turn',
    pi,
    { timeout }
  );
}

function describeLayout(lay, label) {
  const boardBot = lay.board?.bottom;
  const handTop  = lay.handWrap?.y;
  const handBot  = lay.handWrap?.bottom;
  const revTop   = lay.revealedWrap?.y;
  const revBot   = lay.revealedWrap?.bottom;
  const boardTop = lay.board?.y;
  const overlap = (boardBot && handTop) ? (boardBot - handTop) : 'n/a';
  log(`${label} layout: vw=${lay.vw} vh=${lay.vh}`);
  log(`  board: y=${boardTop} bot=${boardBot} (w=${lay.board?.w} h=${lay.board?.h})`);
  log(`  revealed: y=${revTop} bot=${revBot}`);
  log(`  hand: y=${handTop} bot=${handBot}`);
  log(`  → board_bot - hand_top = ${overlap} (>0 = board лезет под руку!)`);
  if (lay.firstHandCard && lay.lastNode) {
    log(`  firstHandCard: y=${lay.firstHandCard.y} bot=${lay.firstHandCard.bottom}`);
    log(`  lastNode: y=${lay.lastNode.y} bot=${lay.lastNode.bottom}`);
    const nodeOverCard = lay.lastNode.bottom - lay.firstHandCard.y;
    log(`  → lastNode_bot - firstHandCard_top = ${nodeOverCard} (>0 = узел НАКРЫТ карточкой)`);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    log('=== Launching 2 contexts ===');
    const host = await setupClient(browser, 'HOST');
    const guest = await setupClient(browser, 'GUEST');

    log('=== Host creates game ===');
    const code = await hostCreateGame(host.page);
    log('host code =', code);

    log('=== Guest joins ===');
    await guestJoinGame(guest.page, code);
    await waitConnected(host.page);
    log('connected');

    await dumpPageState(host.page, 'HOST initial');
    await dumpPageState(guest.page, 'GUEST initial');
    await screenshot(host.page, '01-host-initial');
    await screenshot(guest.page, '01-guest-initial');

    // === LAYOUT CHECK BOTH SIDES ===
    const hostLay1 = await getLayout(host.page);
    const guestLay1 = await getLayout(guest.page);
    describeLayout(hostLay1, 'HOST @ own turn (P0)');
    describeLayout(guestLay1, 'GUEST @ opp turn (P0)');

    // === TURN 1: хост ходит ===
    log('=== TURN 1: P0 places 2 chips, endTurn ===');
    await waitTurn(host.page, 0);
    let empties = await findEmptyNodes(host.page);
    await tapNode(host.page, empties[0][0], empties[0][1]);
    await tapNode(host.page, empties[1][0], empties[1][1]);
    await clickEndTurn(host.page);
    await sleep(600);

    await dumpPageState(host.page, 'HOST after endTurn');
    await dumpPageState(guest.page, 'GUEST got turn');
    await screenshot(host.page, '02-host-after-turn1');
    await screenshot(guest.page, '02-guest-got-turn1');

    // === ПРОВЕРКА ПОДСВЕТКИ (должно быть 0 на guest'е) ===
    const guestHighlightCount = await guest.page.$$eval('.node.highlighted', nodes => nodes.length);
    log('GUEST @ own turn: highlighted nodes =', guestHighlightCount, '(ожидаем 0)');

    // === LAYOUT GUEST @ OWN TURN ===
    const guestLayOwn = await getLayout(guest.page);
    describeLayout(guestLayOwn, 'GUEST @ own turn (P1) — ЭТО КРИТИЧНАЯ ПРОВЕРКА');

    // === FORCE ПРОСТУЮ КАРТУ: инъекция в руку гостя на хосте (host authoritative) ===
    // Берём карту БИТ: 1 клетка W, play effect = null (завершается мгновенно, без модалов)
    const injectResult = await host.page.evaluate(() => {
      const st = window.ui.state;
      const lib = window.ui.cardsById ? [...window.ui.cardsById.values()] : [];
      const candidates = lib.filter(c =>
        c.pattern.length === 1 &&
        c.pattern[0].type === 'W' &&
        (!c.playEffect || !c.playEffect.hasEffects)
      );
      if (!candidates.length) return { ok: false, why: 'no simple-no-effect candidate' };
      const card = candidates[0];
      st.players[1].hand.push(card);
      window.ui._hostSendState();
      return { ok: true, name: card.name, id: card.id, cost: card.cost, pattern: card.pattern };
    });
    log('Injected into guest hand:', JSON.stringify(injectResult));
    await sleep(500);

    // У гостя должна появиться playable карта (паттерн — 1 фишка; гость может разыграть если есть одна своя фишка на доске)
    await dumpPageState(guest.page, 'GUEST after injection');

    // Гость ставит 2 фишки
    empties = await findEmptyNodes(guest.page);
    await tapNode(guest.page, empties[0][0], empties[0][1]);
    await tapNode(guest.page, empties[1][0], empties[1][1]);
    await sleep(400);

    const playable = await getPlayableCards(guest.page);
    log('GUEST playable cards after chips:', JSON.stringify(playable));
    await screenshot(guest.page, '03-guest-after-chips-inject');

    // Ищем именно инъецированный БИТ (последняя карта, без play-эффекта)
    const injectedName = injectResult.ok ? injectResult.name : null;
    const playableIdx = injectedName
      ? playable.findIndex(c => c.playable && c.name === injectedName)
      : playable.findIndex(c => c.playable);
    if (playableIdx === -1) {
      log('WARN: нет playable после инъекции — что-то не так с синхронизацией');
    } else {
      log('GUEST clicking playable card idx', playableIdx, playable[playableIdx].name);
      await guest.page.evaluate((idx) => {
        const cards = document.querySelectorAll('#hand-cards .card');
        cards[idx]?.click();
      }, playableIdx);
      await sleep(500);
      await screenshot(guest.page, '04-guest-card-selected');

      const armState = await guest.page.evaluate(() => ({
        pendingCard: window.ui.pendingCard?.name,
        placements: window.ui.currentPlacements?.length || 0,
        firstPlacementChips: window.ui.currentPlacements?.[0]?.chipPositions || null,
      }));
      log('GUEST arm state:', JSON.stringify(armState));

      if (armState.firstPlacementChips) {
        log(`GUEST tapping chips: ${JSON.stringify(armState.firstPlacementChips)}`);
        const scoreBefore = await guest.page.evaluate(() => window.ui.state.players[1].score);
        const handBefore = await guest.page.evaluate(() => window.ui.state.players[1].hand.length);
        for (const [r, c] of armState.firstPlacementChips) {
          await tapNode(guest.page, r, c);
        }
        await sleep(1000);
        await screenshot(guest.page, '05-guest-after-play');
        const scoreAfter = await guest.page.evaluate(() => window.ui.state.players[1].score);
        const handAfter = await guest.page.evaluate(() => window.ui.state.players[1].hand.length);
        const discard = await guest.page.evaluate(() => window.ui.state.discard?.length ?? 0);
        log(`GUEST score: ${scoreBefore} → ${scoreAfter}, hand: ${handBefore} → ${handAfter}, discard=${discard}`);
        if (scoreAfter > scoreBefore || handAfter < handBefore) {
          log('✓ GUEST успешно разыграл карту');
        } else {
          log('✗ GUEST не смог разыграть — баг онлайна');
        }
      }
    }

    // === Гость заканчивает ход ===
    await clickEndTurn(guest.page);
    await sleep(600);

    // === КОРОТКИЙ ЦИКЛ: 4 раунда для общей проверки ===
    log('=== LOOP: 4 more rounds ===');
    for (let round = 1; round <= 4; round++) {
      const who = await host.page.evaluate(() => window.ui.state.currentPI);
      const page = who === 0 ? host.page : guest.page;
      const label = who === 0 ? 'HOST' : 'GUEST';
      try {
        await waitTurn(page, who, 6000);
      } catch (e) {
        log(`round ${round}: waitTurn timeout for P${who}`);
        break;
      }
      const state = await page.evaluate(() => ({
        pi: window.ui.state.currentPI,
        phase: window.ui.state.phase,
        chipsPlaced: window.ui.state.chipsPlaced,
        chipsAllowed: window.ui.state.chipsAllowed,
      }));
      log(`round ${round}: ${label} (P${who}) turn, chips=${state.chipsPlaced}/${state.chipsAllowed}`);

      if (state.chipsAllowed > state.chipsPlaced) {
        const empties = await findEmptyNodes(page);
        const n = Math.min(state.chipsAllowed - state.chipsPlaced, empties.length);
        for (let i = 0; i < n; i++) await tapNode(page, empties[i][0], empties[i][1]);
      }

      const playable = await getPlayableCards(page);
      const fp = playable.findIndex(c => c.playable);
      if (fp >= 0) {
        log(`  ${label} plays ${playable[fp].name}`);
        const scoreBefore = await page.evaluate((pi) => window.ui.state.players[pi].score, who);
        await page.evaluate((idx) => {
          document.querySelectorAll('#hand-cards .card')[idx]?.click();
        }, fp);
        await sleep(400);
        const arm = await page.evaluate(() => ({
          armed: !!window.ui.pendingCard,
          placements: window.ui.currentPlacements?.length || 0,
          firstChips: window.ui.currentPlacements?.[0]?.chipPositions || null,
        }));
        log(`    arm: ${JSON.stringify(arm)}`);
        if (arm.firstChips) {
          for (const [r, c] of arm.firstChips) {
            await tapNode(page, r, c);
          }
          await sleep(800);
        }
        const scoreAfter = await page.evaluate((pi) => window.ui.state.players[pi].score, who);
        log(`    score: ${scoreBefore} → ${scoreAfter}`);
      }
      await clickEndTurn(page);
      await sleep(400);
    }

    await screenshot(host.page, '99-host-after-loop');
    await screenshot(guest.page, '99-guest-after-loop');

    await dumpPageState(host.page, 'HOST FINAL');
    await dumpPageState(guest.page, 'GUEST FINAL');

    log('=== DONE. Screenshots in', OUT);
  } catch (e) {
    log('FATAL:', e.message, e.stack);
  } finally {
    await browser.close();
  }
}

main();
