// 2026-11-13 分科生物自寫解析顯示檢查：390／320／1440 作答後解析＋「稜線編輯撰寫，非官方解析」標示、收藏清單、非選 115 參考答案、不橫向捲動、無 JS 例外。
// 用法：node _tools/expl_tests.mjs [截圖資料夾]（不給就存到系統暫存資料夾）。需要 04_管理工具/09_體驗評分/node_modules 的 puppeteer-core。
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire('C:/Users/c0787/Desktop/App專案/04_管理工具/09_體驗評分/package.json');
const puppeteer = require('puppeteer-core');
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const OUT = process.argv[2] || tmpdir();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const srv = createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (rel.endsWith('/')) rel += 'index.html';
  try { const b = await readFile(path.join(ROOT, rel)); res.writeHead(200, { 'content-type': types[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(8941);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-first-run'] });
const results = []; const errs = [];
const ok = (n, c, d = '') => { results.push([c ? 'ok  ' : 'FAIL', n, d]); };
for (const w of [390, 320, 1440]) {
  const page = await browser.newPage(); page.on('pageerror', e => errs.push(w + ': ' + e.message));
  await page.setViewport({ width: w, height: w === 1440 ? 900 : 844, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { try { for (const k of ['wc.fenke-qbank','wc_seen_fenke-qbank','wc.fenke-qbank.seen']) localStorage.setItem(k,'1'); } catch (e) {} });
  await page.goto('http://127.0.0.1:8941/advanced-bio/index.html', { waitUntil: 'load' });
  await page.evaluate(() => { try { document.querySelectorAll('.wc-ov').forEach(x => x.remove()); } catch (e) {} });
  // 1) 即時對答：多選練習，選 A 確認 → 顯示解析
  await page.evaluate(() => { startDaily(); });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { const b = document.querySelector('#v-run .opt'); b && b.click(); });
  await page.evaluate(() => { const b = [...document.querySelectorAll('#v-run button')].find(x => /確認答案/.test(x.textContent)); b && b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const run = await page.evaluate(() => { const e = document.querySelector('#v-run .expl'); return { has: !!e, src: e && e.querySelector('.expl-src') ? e.querySelector('.expl-src').textContent : '', note: e && e.classList.contains('expl-note'), sw: document.scrollingElement.scrollWidth, iw: innerWidth }; });
  ok(`${w} 作答後顯示解析與「稜線編輯撰寫，非官方解析」`, run.has && (run.note || /稜線編輯撰寫，非官方解析/.test(run.src)), JSON.stringify(run));
  ok(`${w} 作答畫面不橫向捲動`, run.sw <= run.iw, run.sw + '/' + run.iw);
  await page.evaluate(() => document.querySelector('#instFb')?.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${OUT}/run_${w}.png` });
  // 2) 收藏清單：指定題（含 mismatch 題 F113-32）
  await page.evaluate(() => { S.fav = ['F112-14', 'F115-1', 'F113-32']; go('fav'); });
  await new Promise(r => setTimeout(r, 300));
  const fav = await page.evaluate(() => [...document.querySelectorAll('#v-fav .expl')].map(e => ({ src: e.querySelector('.expl-src')?.textContent || '', note: e.classList.contains('expl-note'), len: e.textContent.length })));
  ok(`${w} 收藏清單：兩題有自寫解析標示、F113-32 顯示整理中`, fav.length === 3 && fav.filter(f => /非官方解析/.test(f.src)).length === 2 && fav.filter(f => f.note).length === 1, JSON.stringify(fav));
  const sw2 = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
  ok(`${w} 收藏清單不橫向捲動`, sw2[0] <= sw2[1], sw2.join('/'));
  await page.screenshot({ path: `${OUT}/fav_${w}.png`, fullPage: true });
  // 3) 非選題 115：展開參考答案與解析
  await page.evaluate(() => { ncYear = 115; go('nonchoice'); document.querySelectorAll('#v-nonchoice details').forEach(d => d.open = true); });
  await new Promise(r => setTimeout(r, 300));
  const nc = await page.evaluate(() => { const r = [...document.querySelectorAll('#v-nonchoice .ncref')]; return { n: r.length, labeled: r.filter(x => /稜線編輯撰寫，非官方解析/.test(x.textContent)).length, ref: r.filter(x => /參考答案（大考中心公布）/.test(x.textContent)).length, sw: document.scrollingElement.scrollWidth, iw: innerWidth }; });
  ok(`${w} 非選 115：12 題都有標示與官方參考答案`, nc.n === 12 && nc.labeled === 12 && nc.ref === 12, JSON.stringify(nc));
  ok(`${w} 非選頁不橫向捲動`, nc.sw <= nc.iw, nc.sw + '/' + nc.iw);
  await page.evaluate(() => { const d = document.querySelector('#v-nonchoice .ncref'); d && d.scrollIntoView({ block: 'center' }); });
  await page.screenshot({ path: `${OUT}/nc_${w}.png` });
  await page.close();
}
ok('沒有 JS 例外', errs.length === 0, errs.join(' | '));
for (const r of results) console.log(r.join('  '));
console.log(results.every(r => r[0] === 'ok  ') ? 'ALL PASS' : 'HAS FAIL', results.length);
await browser.close(); srv.close();
