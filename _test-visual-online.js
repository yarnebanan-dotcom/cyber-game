// Визуальный тест онлайн-режима на 7 viewport'ах — host+guest параллельно.
// Скриншоты: screenshots-online/<device>/
//   01-host-menu   02-host-code-waiting   03-guest-menu   04-guest-join-input
//   05-host-connected   06-guest-connected   07-host-after-chips   08-guest-after-chips
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:8765/';
const OUT_DIR = path.join(__dirname, 'screenshots-online');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEVICES = [
    { name: 'iPhone-SE',         w: 375, h: 667, dpr: 2 },
    { name: 'iPhone-14',         w: 390, h: 844, dpr: 3 },
    { name: 'iPhone-14-Pro-Max', w: 430, h: 932, dpr: 3 },
    { name: 'Pixel-5',           w: 393, h: 851, dpr: 2.75 },
    { name: 'Galaxy-S20',        w: 360, h: 800, dpr: 3 },
    { name: 'Galaxy-Fold',       w: 280, h: 653, dpr: 3 },
    { name: 'iPhone-5',          w: 320, h: 568, dpr: 2 },
];

async function shot(page, device, name) {
    const dir = path.join(OUT_DIR, device.name);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

async function makePage(browser, device, label) {
    const ctx = await browser.newContext({
        viewport: { width: device.w, height: device.h },
        deviceScaleFactor: device.dpr,
        isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log(`  ⚠ [${label}] PE: ${e.message}`));
    await page.goto(URL);
    await page.waitForFunction(() => !!window.ui);
    await sleep(300);
    return { ctx, page };
}

async function testDevice(browser, device) {
    const H = await makePage(browser, device, 'HOST');
    const G = await makePage(browser, device, 'GUEST');
    const click = (p, sel) => p.evaluate(s => document.querySelector(s)?.click(), sel);
    const issues = [];

    // 1. HOST: меню → онлайн-хост
    await click(H.page, '#btn-mode-online');
    await sleep(300);
    await shot(H.page, device, '01-host-online-menu');
    await click(H.page, '#btn-online-host');

    // Ждём код
    await H.page.waitForFunction(() => {
        const t = document.getElementById('online-host-code')?.textContent?.trim();
        return t && t.length === 4 && t !== '————';
    }, { timeout: 15000 });
    const code = await H.page.$eval('#online-host-code', e => e.textContent.trim());
    await shot(H.page, device, '02-host-code-waiting');

    // 2. GUEST: меню → онлайн-джоин
    await click(G.page, '#btn-mode-online');
    await sleep(300);
    await shot(G.page, device, '03-guest-online-menu');
    await click(G.page, '#btn-online-join');
    await sleep(300);
    // Ввод кода
    await G.page.fill('#online-join-input', code);
    await sleep(200);
    await shot(G.page, device, '04-guest-join-input');
    await click(G.page, '#btn-online-join-confirm');

    // Ждём коннект с обеих сторон
    await G.page.waitForFunction(() => !!window.ui?.state?.board, { timeout: 15000 });
    await H.page.waitForFunction(() => window.ui?.net?.connected === true, { timeout: 15000 });
    await sleep(600);

    await shot(H.page, device, '05-host-connected');
    await shot(G.page, device, '06-guest-connected');

    // 3. HOST ставит 2 фишки — полный state после хода
    await H.page.click('.node[data-r="1"][data-c="1"]').catch(() => {});
    await sleep(200);
    await H.page.click('.node[data-r="2"][data-c="2"]').catch(() => {});
    await sleep(500);

    await shot(H.page, device, '07-host-after-chips');
    await shot(G.page, device, '08-guest-after-chips');

    // Проверки overflow на всех 8 шотах через live-инспекцию обоих
    for (const [label, page] of [['HOST', H.page], ['GUEST', G.page]]) {
        const ov = await page.evaluate(() => {
            const w = document.documentElement.clientWidth;
            const off = [];
            for (const el of document.querySelectorAll('button, input, .card, .node, .online-code-display, .online-code-input, .overlay:not(.hidden)')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.right > w + 2) off.push(`${el.id || el.className.split(' ')[0]}:right=${Math.round(r.right)}`);
            }
            const hScroll = document.documentElement.scrollWidth > w + 1;
            return { hScroll, off: off.slice(0, 5), scrollW: document.documentElement.scrollWidth, docW: w };
        });
        if (ov.hScroll) issues.push(`${label}: h-scroll ${ov.scrollW} > ${ov.docW}`);
        if (ov.off.length) issues.push(`${label}: off-right ${ov.off.join(', ')}`);
    }

    await H.ctx.close();
    await G.ctx.close();
    return issues;
}

async function main() {
    if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(OUT_DIR);
    const browser = await chromium.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
    });
    console.log('═══ VISUAL ONLINE TEST (host+guest) ═══\n');
    const results = [];
    try {
        for (const d of DEVICES) {
            process.stdout.write(`▸ ${d.name.padEnd(20)} ${d.w}×${d.h}@${d.dpr}x ... `);
            const t0 = Date.now();
            try {
                const issues = await testDevice(browser, d);
                const dt = ((Date.now() - t0) / 1000).toFixed(1);
                const status = issues.length === 0 ? '✓' : `⚠ ${issues.length}`;
                console.log(`${status} (${dt}s)`);
                if (issues.length > 0) issues.forEach(i => console.log(`    - ${i}`));
                results.push({ device: d.name, issues });
            } catch (e) {
                console.log(`✗ ERROR: ${e.message}`);
                results.push({ device: d.name, issues: [`ERROR: ${e.message}`] });
            }
        }
    } finally {
        await browser.close();
    }
    const bad = results.filter(r => r.issues.length > 0);
    console.log(`\nСкриншоты: ${OUT_DIR}`);
    console.log(`Итог: ${results.length - bad.length}/${results.length} OK, ${bad.length} с замечаниями`);
}
main().catch(e => { console.error(e); process.exit(1); });
