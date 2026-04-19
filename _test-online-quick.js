// Быстрый e2e тест: два браузера, host создаёт → guest подключается.
// Только проверяет установление соединения, без полной игры.

const { chromium } = require('playwright');

const URL = 'http://localhost:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const browser = await chromium.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
    });

    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    // Прокидываем console логи обоих в stdout
    host.on('console', m => console.log('[HOST]', m.text().slice(0, 200)));
    guest.on('console', m => console.log('[GUEST]', m.text().slice(0, 200)));
    host.on('pageerror', e => console.log('[HOST:ERR]', e.message));
    guest.on('pageerror', e => console.log('[GUEST:ERR]', e.message));

    console.log('\n─── 1. Host открывает игру и создаёт партию ───');
    await host.goto(URL);
    await host.waitForFunction(() => typeof Peer === 'function', { timeout: 10000 });
    await host.click('button:has-text("ОНЛАЙН")');
    await sleep(300);
    await host.click('text=Создать игру');

    // Ждём пока появится код (4 символа)
    const code = await host.waitForFunction(() => {
        const el = document.getElementById('online-host-code');
        const t = el?.textContent?.trim();
        return t && t.length === 4 && !t.includes('—') ? t : null;
    }, { timeout: 30000 }).then(h => h.jsonValue());

    console.log('[test] HOST code:', code);
    const hostLog = await host.evaluate(() => document.getElementById('online-host-log')?.textContent);
    console.log('[test] host log:\n' + hostLog);

    console.log('\n─── 2. Guest вводит код и подключается ───');
    await guest.goto(URL);
    await guest.waitForFunction(() => typeof Peer === 'function', { timeout: 10000 });
    await guest.click('button:has-text("ОНЛАЙН")');
    await sleep(300);
    await guest.click('text=Подключиться');
    await sleep(300);
    await guest.fill('#online-join-input', code);
    await sleep(100);
    await guest.click('#btn-online-join-confirm');

    // Ждём установления соединения (gameBoard видим или status != ошибка)
    const result = await Promise.race([
        guest.waitForFunction(() => {
            const ui = window.ui;
            return ui?.state?.board && ui.netMode === 'guest';
        }, { timeout: 60000 }).then(() => 'connected'),
        guest.waitForFunction(() => {
            const st = document.getElementById('online-join-status');
            return st?.classList.contains('error');
        }, { timeout: 60000 }).then(() => 'error'),
    ]).catch(e => 'timeout: ' + e.message.slice(0, 100));

    console.log('[test] guest result:', result);
    const guestLog = await guest.evaluate(() => document.getElementById('online-join-log')?.textContent);
    const guestStatus = await guest.evaluate(() => document.getElementById('online-join-status')?.textContent);
    console.log('[test] guest status:', guestStatus);
    console.log('[test] guest log:\n' + guestLog);

    // Дамп состояния обоих
    const hostNet = await host.evaluate(() => ({
        netMode: window.ui?.netMode,
        connected: window.ui?.net?.connected,
        hasState: !!window.ui?.state,
    }));
    const guestNet = await guest.evaluate(() => ({
        netMode: window.ui?.netMode,
        connected: window.ui?.net?.connected,
        hasState: !!window.ui?.state,
    }));
    console.log('[test] host netState:', JSON.stringify(hostNet));
    console.log('[test] guest netState:', JSON.stringify(guestNet));

    await browser.close();

    const ok = result === 'connected' && hostNet.connected && guestNet.connected;
    console.log(ok ? '\n═══ ✓ PASS ═══' : '\n═══ ✕ FAIL ═══');
    process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
