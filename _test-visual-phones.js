// Скриншоты ключевых экранов на разных мобильных viewport'ах
// Запуск: node _test-visual-phones.js
// Результат: screenshots/<device>/{menu,rules,game,hand-zoom,menu-ingame}.png
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:8765/';
const OUT_DIR = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEVICES = [
    { name: 'iPhone-SE',      w: 375, h: 667,  dpr: 2 },
    { name: 'iPhone-14',      w: 390, h: 844,  dpr: 3 },
    { name: 'iPhone-14-Pro-Max', w: 430, h: 932, dpr: 3 },
    { name: 'Pixel-5',        w: 393, h: 851,  dpr: 2.75 },
    { name: 'Galaxy-S20',     w: 360, h: 800,  dpr: 3 },
    { name: 'Galaxy-Fold',    w: 280, h: 653,  dpr: 3 },     // extreme narrow
    { name: 'iPhone-5',       w: 320, h: 568,  dpr: 2 },     // extreme small
];

async function shot(page, device, name) {
    const dir = path.join(OUT_DIR, device.name);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${name}.png`);
    await page.screenshot({ path: p, fullPage: false });
    return p;
}

async function testDevice(browser, device) {
    const ctx = await browser.newContext({
        viewport: { width: device.w, height: device.h },
        deviceScaleFactor: device.dpr,
        isMobile: true,
        hasTouch: true,
    });
    const page = await ctx.newPage();
    const issues = [];
    page.on('pageerror', e => issues.push(`PE: ${e.message}`));

    await page.goto(URL);
    await page.waitForFunction(() => !!window.ui);
    await sleep(300);

    // 1. Главное меню
    await shot(page, device, '01-menu');

    // Анимация радара мешает Playwright stable check — используем force
    const click = sel => page.evaluate(s => document.querySelector(s)?.click(), sel);

    // 2. Правила
    await click('#btn-show-rules');
    await sleep(400);
    await shot(page, device, '02-rules');
    await click('#btn-rules-close');
    await sleep(300);

    // 3. Онлайн-экран
    await click('#btn-mode-online');
    await sleep(300);
    await shot(page, device, '03-online');
    await click('#btn-online-back');
    await sleep(300);

    // 4. Hard mode + 3p
    await click('#btn-hard-mode');
    await click('#btn-mode-3p');
    await sleep(200);
    await shot(page, device, '04-menu-3p-hard');

    // вернём 2p+easy
    await click('#btn-hard-mode');
    await click('#btn-mode-2p');
    await sleep(200);

    // 5. В игре: запускаем партию 2p
    await click('#btn-initiate');
    // hot-seat handoff оверлей
    await sleep(600);
    // Если есть handoff-overlay, кликаем чтобы пройти
    const handoff = await page.$('#handoff-overlay:not(.hidden)');
    if (handoff) { await handoff.click(); await sleep(800); }

    await page.waitForFunction(() => {
        const el = document.getElementById('menu-screen');
        return el && el.classList.contains('hidden');
    }, { timeout: 5000 }).catch(() => {});
    await sleep(400);

    await shot(page, device, '05-game-board');

    // 6. Поставим 2 фишки чтобы перейти в фазу Задача
    // берём первые 2 пустых узла
    const nodes = await page.$$('.node');
    if (nodes.length >= 2) {
        try { await nodes[Math.floor(nodes.length * 0.3)].click(); } catch (_) {}
        await sleep(200);
        try { await nodes[Math.floor(nodes.length * 0.6)].click(); } catch (_) {}
        await sleep(400);
    }
    await shot(page, device, '06-game-after-chips');

    // 7. Зум карты — long-press на первую карту в руке
    const cards = await page.$$('#hand-cards .card');
    if (cards.length > 0) {
        const box = await cards[0].boundingBox();
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await sleep(700);
            await shot(page, device, '07-card-zoom');
            await page.mouse.up();
            await sleep(200);
        }
    }

    // 8. In-game меню (пауза)
    const pauseBtn = await page.$('#btn-ingame-menu, #btn-menu, [data-action="menu"]');
    if (pauseBtn) {
        await pauseBtn.click();
        await sleep(400);
        await shot(page, device, '08-ingame-menu');
    }

    // Общие проверки верстки
    const overflow = await page.evaluate(() => {
        const issues = [];
        const docW = document.documentElement.clientWidth;
        const docH = document.documentElement.clientHeight;
        // горизонтальный скролл — красный флаг на мобилках
        if (document.documentElement.scrollWidth > docW + 1) {
            issues.push(`h-scroll: scrollW=${document.documentElement.scrollWidth} > viewport=${docW}`);
        }
        // элементы за правой границей
        const all = document.querySelectorAll('button, .card, .node, .modal, .overlay:not(.hidden)');
        const off = [];
        for (const el of all) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right > docW + 2) off.push(`${el.id || el.className.split(' ')[0]} right=${Math.round(r.right)}`);
        }
        if (off.length > 0) issues.push('off-right: ' + off.slice(0, 5).join(', '));
        return issues;
    });

    await ctx.close();
    return { device: device.name, issues: [...issues, ...overflow] };
}

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
    const browser = await chromium.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
    });
    console.log('═══ VISUAL PHONE TEST ═══\n');
    const results = [];
    try {
        for (const d of DEVICES) {
            process.stdout.write(`▸ ${d.name.padEnd(20)} ${d.w}×${d.h}@${d.dpr}x ... `);
            const t0 = Date.now();
            const r = await testDevice(browser, d);
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            const status = r.issues.length === 0 ? '✓' : `⚠ ${r.issues.length}`;
            console.log(`${status} (${dt}s)`);
            if (r.issues.length > 0) r.issues.forEach(i => console.log(`    - ${i}`));
            results.push(r);
        }
    } finally {
        await browser.close();
    }
    console.log(`\nСкриншоты: ${OUT_DIR}`);
    const bad = results.filter(r => r.issues.length > 0);
    console.log(`\nИтог: ${results.length - bad.length}/${results.length} OK, ${bad.length} с замечаниями`);
}
main().catch(e => { console.error(e); process.exit(1); });
