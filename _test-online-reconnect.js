// E2E: принудительно закрываем conn у гостя в середине игры и проверяем
// что автореконнект восстанавливает соединение и синхронизирует state.
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

    await click(H, '#btn-mode-online'); await sleep(200); await click(H, '#btn-online-host');
    await H.waitForFunction(() => {
        const t = document.getElementById('online-host-code')?.textContent?.trim();
        return t && t.length === 4 && t !== '————';
    }, { timeout: 15000 });
    const code = await H.$eval('#online-host-code', e => e.textContent.trim());

    await click(G, '#btn-mode-online'); await sleep(200); await click(G, '#btn-online-join'); await sleep(200);
    await G.fill('#online-join-input', code); await sleep(100); await click(G, '#btn-online-join-confirm');
    await G.waitForFunction(() => !!window.ui?.state?.board, { timeout: 15000 });
    await H.waitForFunction(() => window.ui?.net?.connected === true, { timeout: 15000 });
    await sleep(500);

    // Запомним state до обрыва
    const before = await G.evaluate(() => ({
        currentPI: window.ui.state.currentPI,
        phase: window.ui.state.phase,
        deckCount: window.ui.state.deck.count,
        scores: window.ui.state.players.map(p => p.score),
        handLen: window.ui.state.players[1].hand.length,
    }));
    console.log('[before] ' + JSON.stringify(before));

    // Принудительно рвём conn у гостя (имитация network drop / tab suspend)
    await G.evaluate(() => window.ui.net.conn.close());

    // Ждём что overlay появится
    await G.waitForSelector('#net-overlay:not(.hidden)', { timeout: 5000 });
    const overlayTitleDrop = await G.$eval('#net-overlay-title', e => e.textContent);
    console.log(`[drop] overlay title="${overlayTitleDrop}"`);

    // Ждём автореконнект (цикл каждые 3с) — максимум ~12с
    await G.waitForFunction(() => window.ui?.net?.connected === true, { timeout: 15000 });
    await sleep(500);
    await G.waitForFunction(
        () => document.getElementById('net-overlay').classList.contains('hidden'),
        { timeout: 5000 }
    );

    // Проверяем что state восстановился
    const after = await G.evaluate(() => ({
        currentPI: window.ui.state.currentPI,
        phase: window.ui.state.phase,
        deckCount: window.ui.state.deck.count,
        scores: window.ui.state.players.map(p => p.score),
        handLen: window.ui.state.players[1].hand.length,
    }));
    console.log('[after]  ' + JSON.stringify(after));

    const stateOk = before.currentPI === after.currentPI
        && before.phase === after.phase
        && before.deckCount === after.deckCount
        && JSON.stringify(before.scores) === JSON.stringify(after.scores)
        && before.handLen === after.handLen;

    // Проверяем что хост тоже считает connected
    const hostConnected = await H.evaluate(() => window.ui?.net?.connected === true);

    const ok = stateOk && hostConnected;
    console.log(`reconnect: state preserved=${stateOk}, host.connected=${hostConnected} → ${ok ? '✓' : '✗'}`);
    console.log(ok ? '═══ ✓ PASS' : '═══ ✗ FAIL');

    await ctxH.close(); await ctxG.close(); await browser.close();
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
