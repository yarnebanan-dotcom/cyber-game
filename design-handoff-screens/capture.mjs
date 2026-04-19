// Скрипт: делает 5 эталонных скринов для передачи дизайнеру.
// Запуск: cd Web && npx playwright install chromium && node design-handoff-screens/capture.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_ = 'http://localhost:8765';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function startGame(page, { players, hard }) {
    await page.goto(URL_, { waitUntil: 'load' });
    await sleep(400);
    await page.locator(`#btn-mode-${players}p`).click();
    if (hard) await page.locator('#btn-hard-mode').click();
    await page.locator('#btn-initiate').click();
    await sleep(500);
    await page.locator('#btn-handoff-ok').click().catch(() => {});
    await sleep(400);
}

const shots = [
    { name: '01-menu.png',            w: 375, h: 667, setup: async (p) => { await p.goto(URL_); await sleep(400); } },
    { name: '02-2p-idle.png',         w: 375, h: 667, setup: (p) => startGame(p, { players: 2 }) },
    { name: '03-2p-card-selected.png',w: 375, h: 667, setup: async (p) => {
        await startGame(p, { players: 2 });
        await p.locator('#hand-cards .card').first().click();
        await sleep(200);
    }},
    { name: '04-2p-revealed.png',     w: 375, h: 667, setup: async (p) => {
        await startGame(p, { players: 2 });
        await p.evaluate(() => {
            const st = window.ui?.state;
            if (!st) return;
            const h0 = st.players[0].hand;
            const h1 = st.players[1].hand;
            if (h0.length) st.players[0].revealed.push(h0.shift(), h0.shift());
            if (h1.length) st.players[1].revealed.push(h1.shift());
            window.ui._render?.();
        });
        await sleep(200);
    }},
    { name: '05-3p-hard-worst.png',   w: 360, h: 640, setup: (p) => startGame(p, { players: 3, hard: true }) },
];

(async () => {
    const browser = await chromium.launch();
    for (const s of shots) {
        const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        await s.setup(page);
        const out = path.join(HERE, s.name);
        await page.screenshot({ path: out, fullPage: false });
        console.log(`✓ ${s.name} (${s.w}×${s.h})`);
        await ctx.close();
    }
    await browser.close();
})();
