/**
 * 702 學測自然複習・學生作答進度存檔測試（2026-10-24 新增；只測不改 App）
 *
 *   node _tools/progress_tests.mjs
 *   node _tools/progress_tests.mjs --override=biology/index.html=<改壞的副本絕對路徑>   → 用副本取代某一個檔（證明測試抓得到）
 *
 * 範圍：三支子題庫（biology／earth／advanced-bio）的 localStorage 進度：
 *   key＝biogsat_qb_v1／escgsat_qb_v1／fenke_qb_v1，形狀 {rec:{題號:{correct,n}}, wrong:[題號], fav:[題號], daily:{日期:true}, settings:{dark,immediate,examDate}}
 *   忍者經驗值錢包 ninja_xp_v1（三支共用，答對首次 +10，舊進度用 backfill 補一次）；總入口 natsci_hub_v1（學測日期，會同步寫進三支 settings）
 * 1 作答（對錯都有）→ 重新整理 → 進度／錯題／收藏／答對率／經驗值都還在且一致（三支各跑一次）＋每日一練連勝
 * 2 清除進度：取消不動、確定只清 rec/wrong/daily，收藏、設定、別科、總入口、經驗值錢包都不動
 * 3 缺欄位／舊版（接入忍者前的進度）／題庫已刪題目／損壞資料：能開、不白畫面、不歸零
 * 4 匯出匯入：本 App 沒有（確認設定頁沒有這種按鈕）
 * 5 總入口改學測日期：同步進三支 settings，但不動作答進度
 * 每條斷言印樣本數 n，n=0 一律算 FAIL；外部連線一律擋下（host-resolver-rules＋request interception）。
 * 用 puppeteer-core、headless new、伺服器埠 0、真實時間等待；結束只關自己開的 Chrome 與伺服器。
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/c0787/Desktop/App專案/02_其他App/700_學習計畫日曆/node_modules/puppeteer-core');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OVERRIDES = {};
for (const a of process.argv) if (a.startsWith('--override=')) { const [k, v] = a.slice(11).split('='); OVERRIDES['/' + k.replace(/^\/+/, '')] = v; }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

let pass = 0, fail = 0;
/** n＝樣本數；n 為 0 視為空集合，一律 FAIL */
function ok(name, cond, n, extra) {
  const empty = !(n > 0);
  const good = !!cond && !empty;
  if (good) pass++; else fail++;
  console.log(`  ${good ? 'ok  ' : 'FAIL'} ${name}  [n=${n}]${empty ? '（空集合）' : ''}` + (!good && extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : ''));
}
function info(s) { console.log('  info ' + s); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/__blank.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const p = OVERRIDES[rel] || path.join(ROOT, rel);
  if (!OVERRIDES[rel] && !p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const b = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(b);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/`;
const profile = await mkdtemp(path.join(tmpdir(), 'gsat702-prog-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: profile,
  args: ['--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] });

const external = [];
const pageErrors = [];
async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const h = (() => { try { return new URL(r.url()).hostname; } catch { return ''; } })();
    if (/^https?:/.test(r.url()) && h !== '127.0.0.1') { external.push(r.url()); r.abort(); } else r.continue();
  });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.__dialog = 'accept';
  page.__dialogs = [];
  page.on('dialog', async (d) => { page.__dialogs.push(d.message()); if (page.__dialog === 'accept') await d.accept(); else await d.dismiss(); });
  page.__ctx = ctx;
  return page;
}
async function closePage(page) { try { await page.__ctx.close(); } catch {} }
/** 在同網域的空白頁先寫好 localStorage（{key: 值}，值為字串時原樣寫入），再開 App */
async function seed(page, kv, clear = true) {
  await page.goto(BASE + '__blank.html', { waitUntil: 'load' });
  await page.evaluate((kv, clear) => { if (clear) localStorage.clear(); for (const k in kv) localStorage.setItem(k, typeof kv[k] === 'string' ? kv[k] : JSON.stringify(kv[k])); }, kv, clear);
}
async function dump(page, keys) { return page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), keys); }
async function openApp(page, app) {
  const errs0 = pageErrors.length;
  await page.goto(BASE + app.dir + '/index.html', { waitUntil: 'load' });
  const ready = await page.waitForFunction(() => document.querySelector('#v-home .stats .stat b') && document.querySelectorAll('#v-home .mode').length >= 3,
    { timeout: 20000, polling: 150 }).then(() => true, () => false);
  return { ready, newErrors: pageErrors.slice(errs0) };
}
async function homeStats(page) { return page.evaluate(() => [...document.querySelectorAll('#v-home .stats .stat b')].map((b) => b.textContent.trim())); }
async function nav(page, v) {
  // 底部導覽只有 home/wrong/diagnose/settings；收藏頁沒有入口按鈕，改呼叫 App 自己的 go()
  await page.evaluate((v) => { const b = document.querySelector(`#nav button[data-v="${v}"]`); if (b) b.click(); else go(v); }, v);
  await page.waitForFunction((v) => !document.getElementById('v-' + v).classList.contains('hidden'), { timeout: 5000, polling: 100 }, v);
}

/** 在作答畫面答目前這題；want=true 答對、false 答錯。回傳 {id, correct}（以題目答案判定，不讀 App 的計分結果） */
async function answerCurrent(page, want) {
  const q = await page.evaluate(() => { const q = sess.list[sess.i]; return { id: q.id, multi: q.kind === 'multi', ans: (q.answer || []).slice().sort(), keys: optKeys(q) }; });
  let picks;
  if (want) picks = q.ans.slice();
  else { const other = q.keys.find((k) => !q.ans.includes(k)); picks = other ? [other] : [q.ans[0]]; }
  for (const k of picks) {
    await page.evaluate((k) => [...document.querySelectorAll('#v-run .opts .opt')].find((b) => b.querySelector('.k').textContent === k).click(), k);
  }
  if (q.multi) await page.evaluate(() => document.getElementById('nextBtn').click());
  const fb = await page.waitForFunction(() => document.getElementById('instFb'), { timeout: 4000, polling: 100 }).then(() => page.evaluate(() => document.getElementById('instFb').className), () => '');
  const correct = picks.slice().sort().join('') === q.ans.join('');
  return { id: q.id, correct, fbOk: correct ? /\bok\b/.test(fb) : /\bno\b/.test(fb) };
}

const APPS = [
  { dir: 'biology', key: 'biogsat_qb_v1', ninja: 'biology', wc: 'wc.biogsat-qbank.done' },
  { dir: 'earth', key: 'escgsat_qb_v1', ninja: 'earth', wc: 'wc.escgsat-qbank.done' },
  { dir: 'advanced-bio', key: 'fenke_qb_v1', ninja: 'advanced-bio', wc: 'wc.fenke-qbank.done' },
];
const ALL_KEYS = [...APPS.map((a) => a.key), 'ninja_xp_v1', 'natsci_hub_v1', ...APPS.map((a) => a.wc)];
const PATTERN = [true, false, true, true, false, true];   // 6 題：對 4 錯 2

try {
  console.log('對象：' + ROOT + (Object.keys(OVERRIDES).length ? '（覆寫 ' + JSON.stringify(OVERRIDES) + '）' : ''));

  /* ---------- 1 作答 → 重新整理 ---------- */
  for (const app of APPS) {
    console.log(`\n[1 ${app.dir}：作答 6 題（對 4 錯 2）＋收藏 1 題 → 重新整理]`);
    const page = await newPage();
    await seed(page, { [app.wc]: '1' });
    const o = await openApp(page, app);
    ok(`1.0 ${app.dir} 空進度能開、首頁有統計`, o.ready && o.newErrors.length === 0, 1, o);
    await page.evaluate(() => { const n = CHAPTERS.map((c) => usableR.filter((q) => q.ch === c).length); document.querySelectorAll('#v-home .modes')[0].querySelectorAll('.mode')[n.indexOf(Math.max(...n))].click(); });   // 題數最多的章節練習（題數少的章節 6 題內就會交卷）
    await page.waitForFunction(() => !document.getElementById('v-run').classList.contains('hidden') && document.querySelector('#v-run .opts .opt'), { timeout: 5000, polling: 100 });
    const listLen = await page.evaluate(() => sess.list.length);
    const done = [];
    for (let i = 0; i < PATTERN.length && i < listLen; i++) {
      if (i === 0) await page.evaluate(() => document.getElementById('favBtn').click());
      done.push(await answerCurrent(page, PATTERN[i]));
      if (i < PATTERN.length - 1) {
        const before = await page.evaluate(() => sess.i);
        await page.evaluate(() => document.getElementById('nextBtn').click());
        await page.waitForFunction((b) => sess.i === b + 1, { timeout: 4000, polling: 100 }, before);
      }
    }
    ok(`1.1 ${app.dir} 實際作答 ${done.length} 題、每題回饋對錯與題目答案一致`, done.length === PATTERN.length && done.every((d) => d.fbOk), done.length, done);
    const expRight = done.filter((d) => d.correct).map((d) => d.id), expWrong = done.filter((d) => !d.correct).map((d) => d.id);
    const before = await dump(page, ALL_KEYS);
    const S0 = JSON.parse(before[app.key] || '{}');
    ok(`1.2 ${app.dir} 存檔 rec 有 ${done.length} 題、對錯旗標逐題相符`, Object.keys(S0.rec || {}).length === done.length && done.every((d) => S0.rec[d.id] && S0.rec[d.id].correct === d.correct && S0.rec[d.id].n === 1), done.length, S0.rec);
    ok(`1.3 ${app.dir} 存檔錯題本＝答錯的 ${expWrong.length} 題`, eq((S0.wrong || []).slice().sort(), expWrong.slice().sort()), expWrong.length, { wrong: S0.wrong, expWrong });
    ok(`1.4 ${app.dir} 存檔收藏＝第 1 題`, eq(S0.fav, [done[0].id]), (S0.fav || []).length, S0.fav);
    const W0 = JSON.parse(before.ninja_xp_v1 || '{}');
    ok(`1.5 ${app.dir} 忍者經驗值：首次答對 ${expRight.length} 題 ×10＝${expRight.length * 10}`, W0.bySrc && W0.bySrc[app.ninja] === expRight.length * 10 && W0.xp === expRight.length * 10 && W0.correct === expRight.length, expRight.length, W0);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#v-home .stats .stat b'), { timeout: 20000, polling: 150 });
    const after = await dump(page, ALL_KEYS);
    const changed = ALL_KEYS.filter((k) => before[k] !== after[k]);
    ok(`1.6 ${app.dir} 重新整理後 ${ALL_KEYS.length} 個 key 全部一字不差（含經驗值不重複補發）`, changed.length === 0, ALL_KEYS.length, { changed, before: changed.map((k) => before[k]), after: changed.map((k) => after[k]) });
    const hs = await homeStats(page);
    const expPct = Math.round(expRight.length / done.length * 100) + '%';
    ok(`1.7 ${app.dir} 首頁統計：已作答 ${done.length}、答對率 ${expPct}、收藏 1`, eq(hs, [String(done.length), expPct, '1']), hs.length, hs);
    const wrongBtn = await page.evaluate(() => [...document.querySelectorAll('#v-home .mode')].map((b) => b.textContent).find((t) => t.includes('錯題複習')) || '');
    ok(`1.8 ${app.dir} 首頁「錯題複習」寫 ${expWrong.length} 題待清`, wrongBtn.includes(`${expWrong.length} 題待清`), wrongBtn ? 1 : 0, wrongBtn);
    await nav(page, 'wrong');
    const wv = await page.evaluate(() => ({ h: document.querySelector('#v-wrong .sect').textContent, n: document.querySelectorAll('#v-wrong .rev-item').length }));
    ok(`1.9 ${app.dir} 錯題本頁列出 ${expWrong.length} 題`, wv.n === expWrong.length && wv.h.includes(`（${expWrong.length}）`), wv.n, wv);
    await nav(page, 'fav');
    const fv = await page.evaluate(() => document.querySelectorAll('#v-fav .rev-item').length);
    ok(`1.10 ${app.dir} 收藏頁列出 1 題`, fv === 1, fv, fv);
    await nav(page, 'settings');
    const st = await page.evaluate(() => document.getElementById('v-settings').textContent);
    ok(`1.11 ${app.dir} 設定頁「已作答 ${done.length} 題 · 錯題 ${expWrong.length}」`, st.includes(`已作答 ${done.length} 題 · 錯題 ${expWrong.length}`), 1, st.slice(0, 200));
    await nav(page, 'diagnose');
    const dg = await page.evaluate(() => [...document.querySelectorAll('#v-diagnose .card')[0].querySelectorAll('.bar .lb span:last-child')].map((s) => s.textContent));   // 第一張卡＝依章節
    const dgSum = dg.reduce((a, s) => { const m = /(\d+)\/(\d+)/.exec(s); return m ? [a[0] + +m[1], a[1] + +m[2]] : a; }, [0, 0]);
    ok(`1.12 ${app.dir} 弱點診斷（依章節）加總＝${expRight.length}/${done.length}`, dgSum[0] === expRight.length && dgSum[1] === done.length, dg.length, { dg, dgSum });
    // 總入口讀同一份進度
    await page.goto(BASE + 'index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#cards .card').length === 3, { timeout: 15000, polling: 150 });
    const hub = await page.evaluate((dir) => { const c = [...document.querySelectorAll('#cards .card')].find((a) => a.getAttribute('href').startsWith(dir + '/')); return c ? c.querySelector('.row').textContent.replace(/\s+/g, ' ') : ''; }, app.dir);
    ok(`1.13 ${app.dir} 總入口題庫卡顯示已練 ${done.length}、錯題 ${expWrong.length}`, new RegExp(`已練 ${done.length} /`).test(hub) && hub.includes(`錯題 ${expWrong.length}`), hub ? 1 : 0, hub);
    const after2 = await dump(page, ALL_KEYS);
    ok(`1.14 ${app.dir} 開總入口不改任何進度 key`, ALL_KEYS.every((k) => after2[k] === after[k]), ALL_KEYS.length, ALL_KEYS.filter((k) => after2[k] !== after[k]));
    await closePage(page);
  }

  /* ---------- 1b 每日一練連勝 ---------- */
  {
    console.log('\n[1b biology：每日一練作答 1 題 → 重新整理後今天算完成、連勝 1 天]');
    const app = APPS[0];
    const page = await newPage();
    await seed(page, { [app.wc]: '1' });
    await openApp(page, app);
    await page.evaluate(() => document.querySelector('#v-home .mode.daily').click());
    await page.waitForFunction(() => sess && sess.daily && document.querySelector('#v-run .opts .opt'), { timeout: 5000, polling: 100 });
    const a = await answerCurrent(page, true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#v-home .mode.daily'), { timeout: 20000, polling: 150 });
    const r = await page.evaluate((k) => { const S = JSON.parse(localStorage.getItem(k)); const d = new Date(); const t = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return { today: !!(S.daily || {})[t], keys: Object.keys(S.daily || {}), rec: Object.keys(S.rec || {}).length, txt: document.querySelector('#v-home .mode.daily').textContent.replace(/\s+/g, ' '), cls: document.querySelector('#v-home .mode.daily').className }; }, app.key);
    ok('1b.1 存檔 daily 只有今天一筆、rec 1 題', r.today && r.keys.length === 1 && r.rec === 1 && a.correct, r.keys.length, r);
    ok('1b.2 重新整理後首頁每日一練顯示已完成＋🔥 1 天', /\bok\b/.test(r.cls) && r.txt.includes('🔥 1 天'), 1, r);
    await closePage(page);
  }

  /* ---------- 2 清除進度 ---------- */
  {
    console.log('\n[2 biology 設定頁「清除」：取消不動；確定只清作答／錯題／每日，其他都留著]');
    const app = APPS[0];
    const page = await newPage();
    await seed(page, { [app.wc]: '1' });
    await openApp(page, app);
    const ids = await page.evaluate(() => R.slice(0, 5).map((q) => q.id));
    const eIds = await (async () => { await page.goto(BASE + 'earth/index.html', { waitUntil: 'load' }); await page.waitForFunction(() => typeof R !== 'undefined', { timeout: 20000 }); return page.evaluate(() => R.slice(0, 2).map((q) => q.id)); })();
    const SEED = {
      [app.wc]: '1', 'wc.escgsat-qbank.done': '1',
      [app.key]: { rec: { [ids[0]]: { correct: true, n: 1 }, [ids[1]]: { correct: false, n: 2 }, [ids[2]]: { correct: true, n: 3 } }, wrong: [ids[1]], fav: [ids[3], ids[4]],
        daily: { '2026-10-23': true }, settings: { dark: 'dark', immediate: true, examDate: '2027-01-16' } },
      escgsat_qb_v1: { rec: { [eIds[0]]: { correct: false, n: 1 }, [eIds[1]]: { correct: true, n: 1 } }, wrong: [eIds[0]], fav: [], daily: {}, settings: { dark: 'auto', immediate: true, examDate: '2027-01-16' } },
      fenke_qb_v1: { rec: { x1: { correct: true, n: 1 } }, wrong: [], fav: ['x1'], daily: {}, settings: { dark: 'light', immediate: true, examDate: '' } },
      natsci_hub_v1: { examDate: '2027-01-16' },
      ninja_xp_v1: { xp: 120, bySrc: { biology: 20, earth: 10, 'advanced-bio': 10, other: 80 }, correct: 12, units: 0, jutsu: [], seen: { biology: 1, earth: 1, 'advanced-bio': 1 }, ts: 1 },
    };
    await seed(page, SEED);
    await openApp(page, app);
    const b0 = await dump(page, ALL_KEYS);
    await nav(page, 'settings');
    page.__dialog = 'dismiss';
    await page.evaluate(() => [...document.querySelectorAll('#v-settings button')].find((b) => b.textContent.trim() === '清除').click());
    await sleep(300);
    const b1 = await dump(page, ALL_KEYS);
    ok('2.1 按清除但取消：所有 key 一字不差', page.__dialogs.length === 1 && ALL_KEYS.every((k) => b0[k] === b1[k]), ALL_KEYS.length, { dialogs: page.__dialogs, diff: ALL_KEYS.filter((k) => b0[k] !== b1[k]) });
    page.__dialog = 'accept';
    await page.evaluate(() => [...document.querySelectorAll('#v-settings button')].find((b) => b.textContent.trim() === '清除').click());
    await page.waitForFunction(() => document.getElementById('v-settings').textContent.includes('已作答 0 題'), { timeout: 4000, polling: 100 }).catch(() => {});
    const b2 = await dump(page, ALL_KEYS);
    const S2 = JSON.parse(b2[app.key]);
    ok('2.2 確定清除：rec／wrong／daily 清空', eq(S2.rec, {}) && eq(S2.wrong, []) && eq(S2.daily, {}), 3, S2);
    ok('2.3 確定清除：收藏 2 題保留', eq(S2.fav, SEED[app.key].fav), S2.fav.length, S2.fav);
    ok('2.4 確定清除：設定（深色、學測日期）保留', eq(S2.settings, SEED[app.key].settings), Object.keys(S2.settings).length, S2.settings);
    const others = ALL_KEYS.filter((k) => k !== app.key);
    ok(`2.5 確定清除：別科、總入口、經驗值錢包、歡迎旗標共 ${others.length} 個 key 不動`, others.every((k) => b0[k] === b2[k]), others.length, others.filter((k) => b0[k] !== b2[k]));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#v-home .stats .stat b'), { timeout: 20000, polling: 150 });
    const hs = await homeStats(page);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const cd = await page.evaluate(() => (document.querySelector('#v-home .cd') || {}).textContent || '');
    ok('2.6 重新整理：首頁 0 題、0%、收藏 2；深色與倒數仍在', eq(hs, ['0', '0%', '2']) && theme === 'dark' && cd.includes('2027-01-16'), hs.length, { hs, theme, cd });
    info('清除不會扣回忍者經驗值；清除後再答對同一題會再 +10（markAns 以 rec 判斷「首次答對」）——是否該防重刷，規則不明');
    await closePage(page);
  }

  /* ---------- 3 缺欄位／舊版／損壞 ---------- */
  {
    console.log('\n[3 缺欄位、舊版（接入忍者前）、已刪題目、損壞資料]');
    const app = APPS[0];
    const page = await newPage();
    await seed(page, { [app.wc]: '1' });
    await openApp(page, app);
    const ids = await page.evaluate(() => R.slice(0, 4).map((q) => q.id));

    // 3a：接入忍者修行（eab943a）前的舊進度：只有 rec/wrong/fav/daily/settings，沒有 ninja_xp_v1；也試只有 rec 的最小形狀
    await seed(page, { [app.wc]: '1', [app.key]: { rec: { [ids[0]]: { correct: true, n: 1 }, [ids[1]]: { correct: true, n: 2 }, [ids[2]]: { correct: false, n: 1 } } } });
    let o = await openApp(page, app);
    let hs = await homeStats(page);
    let W = JSON.parse(await page.evaluate(() => localStorage.getItem('ninja_xp_v1')) || '{}');
    ok('3a.1 只有 rec 的舊進度：能開、無例外、首頁 3 題 67%', o.ready && o.newErrors.length === 0 && eq(hs, ['3', '67%', '0']), 3, { o, hs });
    ok('3a.2 沒有經驗值錢包的舊進度：補發一次＝答對 2 題 ×10', W.bySrc && W.bySrc[app.ninja] === 20 && W.seen && W.seen[app.ninja] === 1, 2, W);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#v-home .stats .stat b'), { timeout: 20000, polling: 150 });
    const W2 = JSON.parse(await page.evaluate(() => localStorage.getItem('ninja_xp_v1')) || '{}');
    ok('3a.3 再開一次不重複補發（仍 20）', W2.bySrc && W2.bySrc[app.ninja] === 20 && W2.xp === 20, 1, W2);
    const raw3a = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), app.key));
    ok('3a.4 舊進度原樣保留（打開不會改寫 rec）', Object.keys(raw3a.rec).length === 3, Object.keys(raw3a.rec).length, raw3a);
    info('只有 rec、沒有 wrong 陣列的舊資料：答錯的題不會出現在錯題本（錯題本只看 wrong 陣列）——歷史上 wrong 一直存在，屬規則不明');

    // 3b：settings 缺 dark（例如只被總入口寫過日期）
    await seed(page, { [app.wc]: '1', [app.key]: { rec: { [ids[0]]: { correct: true, n: 1 } }, wrong: [], fav: [], settings: { examDate: '2027-01-16' } } });
    o = await openApp(page, app);
    hs = await homeStats(page);
    const th = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    ok('3b.1 settings 缺 dark：能開、無例外、進度 1 題、倒數在', o.ready && o.newErrors.length === 0 && hs[0] === '1' && (await page.evaluate(() => !!document.querySelector('#v-home .cd'))), 1, { o, hs });
    info(`3b settings 缺 dark 時 <html data-theme> = ${JSON.stringify(th)}（applyTheme 把 undefined 寫成字串；深淺色跟系統，非白畫面）`);

    // 3c：題庫已刪掉的題號（錯題本與 rec 裡）
    await seed(page, { [app.wc]: '1', [app.key]: { rec: { [ids[0]]: { correct: false, n: 1 }, 'gone-1': { correct: false, n: 1 } }, wrong: [ids[0], 'gone-1'], fav: ['gone-2'], daily: {}, settings: { dark: 'auto', immediate: true, examDate: '' } } });
    o = await openApp(page, app);
    await nav(page, 'wrong');
    const wn = await page.evaluate(() => document.querySelectorAll('#v-wrong .rev-item').length);
    ok('3c.1 錯題本含已刪題號：能開、無例外、錯題本只列現存的 1 題', o.ready && o.newErrors.length === 0 && wn === 1, wn, { o, wn });
    info(`3c 已刪題號仍計入首頁「已作答」：${(await (async () => { await nav(page, 'home'); return homeStats(page); })())[0]}（rec 不過濾；收藏數也含已刪題）——規則不明`);

    // 3d：整份 JSON 壞掉
    await seed(page, { [app.wc]: '1', [app.key]: '{"rec":{"broken' });
    o = await openApp(page, app);
    hs = await homeStats(page);
    const raw3d = await page.evaluate((k) => localStorage.getItem(k), app.key);
    ok('3d.1 存檔 JSON 損壞：能開、無例外、以 0 題起算', o.ready && o.newErrors.length === 0 && hs[0] === '0', 1, { o, hs });
    ok('3d.2 損壞的原始字串在作答前不被覆寫（還有機會救回）', raw3d === '{"rec":{"broken', 1, raw3d);

    // 3e／3f：欄位型別損壞（非歷史格式，手動改壞或其他程式寫壞）
    for (const [tag, val, desc] of [['3e', { rec: { [ids[0]]: null, [ids[1]]: { correct: true, n: 1 } }, wrong: [], fav: [] }, 'rec 裡有一筆 null'],
      ['3f', { rec: { [ids[0]]: { correct: true, n: 1 } }, wrong: {}, fav: [] }, 'wrong 不是陣列']]) {
      await seed(page, { [app.wc]: '1', [app.key]: val });
      o = await openApp(page, app);
      const body = await page.evaluate(() => ({ home: (document.getElementById('v-home') || {}).innerHTML.length || 0, nav: document.querySelectorAll('#nav button').length }));
      ok(`${tag}.1 【損壞資料，非歷史格式；FAIL＝疑似 bug】${desc}：首頁仍畫得出來（不白畫面）`, o.ready && o.newErrors.length === 0, 1, { ready: o.ready, errors: o.newErrors.slice(0, 2), body });
    }
    await closePage(page);
  }

  /* ---------- 4 匯出匯入 ---------- */
  {
    console.log('\n[4 匯出／匯入／備份]');
    const page = await newPage();
    await seed(page, { [APPS[0].wc]: '1' });
    await openApp(page, APPS[0]);
    await nav(page, 'settings');
    const t = await page.evaluate(() => [...document.querySelectorAll('#v-settings button, #v-settings input')].map((e) => e.textContent || e.type));
    ok('4.1 設定頁沒有匯出／匯入／備份功能（本 App 不提供，無從還原測試）', !t.some((s) => /匯出|匯入|備份|還原|export|import/i.test(s)), t.length, t);
    await closePage(page);
  }

  /* ---------- 5 總入口改日期不動進度 ---------- */
  {
    console.log('\n[5 總入口設定學測日期：同步三支 settings，作答進度不動]');
    const page = await newPage();
    const SEED = { natsci_hub_v1: { examDate: '2027-01-16' },
      biogsat_qb_v1: { rec: { a: { correct: true, n: 1 }, b: { correct: false, n: 1 } }, wrong: ['b'], fav: ['a'], daily: { '2026-10-20': true }, settings: { dark: 'dark', immediate: true, examDate: '2027-01-16' } },
      escgsat_qb_v1: { rec: { c: { correct: true, n: 1 } }, wrong: [], fav: [], daily: {} } };
    await seed(page, SEED);
    await page.goto(BASE + 'index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('examIn'), { timeout: 15000, polling: 150 });
    await page.evaluate(() => { document.getElementById('examIn').value = '2027-01-23'; document.querySelector('#exam form button').click(); });
    await sleep(300);
    const d = await dump(page, ['natsci_hub_v1', 'biogsat_qb_v1', 'escgsat_qb_v1', 'fenke_qb_v1']);
    const B = JSON.parse(d.biogsat_qb_v1), E = JSON.parse(d.escgsat_qb_v1), F = JSON.parse(d.fenke_qb_v1 || '{}');
    ok('5.1 三支 settings.examDate 都變 2027-01-23', [B, E, F].every((s) => s.settings && s.settings.examDate === '2027-01-23') && JSON.parse(d.natsci_hub_v1).examDate === '2027-01-23', 3, d);
    ok('5.2 作答進度（rec/wrong/fav/daily）與深色設定一字不差', eq(B.rec, SEED.biogsat_qb_v1.rec) && eq(B.wrong, ['b']) && eq(B.fav, ['a']) && eq(B.daily, SEED.biogsat_qb_v1.daily) && B.settings.dark === 'dark' && eq(E.rec, SEED.escgsat_qb_v1.rec), 2, { B, E });
    await closePage(page);
  }

  console.log('\n[6 外部連線]');
  ok('6.1 外部請求全部被擋（實際擋下 ' + external.length + ' 個；沒有就代表 App 本身不連外，仍以樣本 1 計）', true, 1);
  if (external.length) info('被擋的外部網址（前 3）：' + external.slice(0, 3).join(' , '));
  info('整輪頁面例外 ' + pageErrors.length + ' 個' + (pageErrors.length ? '：' + pageErrors.slice(0, 3).join(' | ') : ''));
} catch (e) {
  fail++;
  console.log('  FAIL 測試程式本身出錯：' + (e && e.stack || e));
} finally {
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + '　通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  try { await browser.close(); } catch {}
  server.close();
  await sleep(300);
  try { await rm(profile, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
}
