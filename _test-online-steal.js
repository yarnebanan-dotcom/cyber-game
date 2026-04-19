// E2E-проверка сетевого chooseStealSource: host вызывает input.chooseStealSource
// с actorPI=1 (гость), ожидаем что на guest всплыл _showStealPick, гость кликает
// blind-кнопку, host получает корректный response.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const browser = await chromium.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
    });
    const ctxH = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxG = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const H = await ctxH.newPage(); const G = await ctxG.newPage();
    H.on('pageerror', e => console.log(`[HOST] PE: ${e.message}`));
    G.on('pageerror', e => console.log(`[GUEST] PE: ${e.message}`));
    await H.goto('http://localhost:8765/'); await G.goto('http://localhost:8765/');
    await H.waitForFunction(() => !!window.ui); await G.waitForFunction(() => !!window.ui);
    await sleep(300);
    const click = (p, s) => p.evaluate(x => document.querySelector(x)?.click(), s);

    // Установить онлайн: host
    await click(H, '#btn-mode-online'); await sleep(200); await click(H, '#btn-online-host');
    await H.waitForFunction(() => {
        const t = document.getElementById('online-host-code')?.textContent?.trim();
        return t && t.length === 4 && t !== '————';
    }, { timeout: 15000 });
    const code = await H.$eval('#online-host-code', e => e.textContent.trim());

    // Guest: join
    await click(G, '#btn-mode-online'); await sleep(200); await click(G, '#btn-online-join'); await sleep(200);
    await G.fill('#online-join-input', code); await sleep(100); await click(G, '#btn-online-join-confirm');
    await G.waitForFunction(() => !!window.ui?.state?.board, { timeout: 15000 });
    await H.waitForFunction(() => window.ui?.net?.connected === true, { timeout: 15000 });
    await sleep(500);

    // ── Сценарий A: blind steal ──────────────────────────────
    let hostResult = H.evaluate(() => new Promise(resolve => {
        const ctx = { revealedPool: [], opponents: [{ pi: 0, handCount: 3 }], remaining: 1, total: 1 };
        window.ui.input.chooseStealSource(1, ctx, choice => {
            resolve({ type: choice?.type, ownerPI: choice?.ownerPI, hasCard: !!choice?.card });
        });
    }));
    await G.waitForSelector('#steal-pick-modal:not(.hidden)', { timeout: 5000 });
    const blindBtnCount = await G.$$eval('.sp-blind-btn', els => els.length);
    await G.click('.sp-blind-btn');
    let result = await Promise.race([hostResult, sleep(5000).then(() => ({ timeout: true }))]);
    const okA = result.type === 'blind' && result.ownerPI === 0;
    console.log(`[A] blind: blind-btns=${blindBtnCount}, result=${JSON.stringify(result)} → ${okA ? '✓' : '✗'}`);
    await sleep(300);

    // ── Сценарий B: revealed steal ──────────────────────────
    // Передаём cardId который есть в cardsById (карта УЯЗВИМОСТЬ — id=2 в 2p колоде)
    const revealedCardId = await H.evaluate(() => {
        for (const [id, c] of window.ui.cardsById) {
            if (c.name === 'УЯЗВИМОСТЬ') return id;
        }
        return null;
    });
    hostResult = H.evaluate((cid) => new Promise(resolve => {
        const card = window.ui.cardsById.get(cid);
        const ctx = { revealedPool: [{ card, ownerPI: 0 }], opponents: [], remaining: 1, total: 1 };
        window.ui.input.chooseStealSource(1, ctx, choice => {
            resolve({ type: choice?.type, ownerPI: choice?.ownerPI, cardId: choice?.card?.id, cardName: choice?.card?.name });
        });
    }), revealedCardId);
    await G.waitForSelector('#steal-pick-modal:not(.hidden)', { timeout: 5000 });
    const revCount = await G.$$eval('.sp-rev-item', els => els.length);
    await G.click('.sp-rev-item');
    result = await Promise.race([hostResult, sleep(5000).then(() => ({ timeout: true }))]);
    const okB = result.type === 'revealed' && result.cardId === revealedCardId && result.ownerPI === 0;
    console.log(`[B] revealed: rev-items=${revCount}, result=${JSON.stringify(result)} → ${okB ? '✓' : '✗'}`);

    const ok = okA && okB;
    console.log(ok ? '═══ ✓ PASS' : '═══ ✗ FAIL');

    await ctxH.close(); await ctxG.close(); await browser.close();
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
