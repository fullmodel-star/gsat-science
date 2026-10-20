/**
 * 702 學測自然複習・總入口（根目錄 index.html）瀏覽器層走查
 *
 *   node _tools/ui_tests.mjs                 → 對專案根目錄跑
 *   node _tools/ui_tests.mjs --dir=<資料夾>  → 對別的副本跑（例：改前版本）
 *
 * 2026-10-19 版面美化「自然探險」建立（寫法照 605 _tools/ui_tests.mjs）：
 * - 第 1–6 節＝功能安全網（題庫入口、學測日期同步三支 App、進度總覽、主推題庫、分頁、版面不溢出、只連本機），
 *   改版前後都必須通過。
 * - 第 7 節＝這次改版的新要求（主視覺、圓體字型、3D 圖、操作元件沒有 emoji、三張題庫卡同一套、
 *   桌機兩欄平衡、頁首不再是重色塊、深色模式）。改版前跑要失敗，用來確認測試抓得到現況。
 * - 不用 --virtual-time-budget；一律真實時間輪詢。自己起 http server（no-store），直接試綁埠。
 * - 子題庫（biology／earth／advanced-bio）不在這支的範圍，只檢查入口連結。
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const ROOT = path.resolve(HERE, '..', dirArg ? dirArg.slice(6) : '.');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.txt': 'text/plain', '.woff2': 'font/woff2' };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

async function startServer() {
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    const p = path.join(ROOT, rel);
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    try {
      const b = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(b);
    } catch { res.writeHead(404); res.end(); }
  });
  for (let port = 8820; port < 8860; port++) {
    const okBind = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (okBind) return { server, port };
  }
  throw new Error('找不到可用的埠');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.errors = []; this.requests = []; this.initScript = null; }
  static async connect(debugPort) {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* Chrome 還沒起來 */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('接不上 Chrome 的 CDP');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiters.has(m.id)) { c.waiters.get(m.id)(m); c.waiters.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        c.errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'unknown');
      }
      if (m.method === 'Network.requestWillBeSent') c.requests.push(m.params.request.url);
    };
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Network.enable');
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.waiters.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  }
  async until(expr, ms = 8000, step = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await this.eval(expr)) return true; } catch { /* 還沒 ready */ }
      await sleep(step);
    }
    return false;
  }
  async width(w, h = 844) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(200);
  }
  async scheme(v) {
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });
    await sleep(150);
  }
  /** 開頁面：清本地資料後寫入 seed（{key: 物件}） */
  async open(url, seed = {}) {
    if (this.initScript) await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.initScript });
    const r = await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      try { localStorage.clear(); const s = ${JSON.stringify(seed)}; for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); } catch(e) {}
    })();` });
    this.initScript = r.result && r.result.identifier;
    await this.send('Page.navigate', { url });
    return this.until(`document.querySelectorAll('#cards .card').length === 3 && document.getElementById('foot').textContent.length > 10`, 15000);
  }
}

/* 假進度：學測地科練過 5 題（對 3）、錯題 2 → 主推應變成地科 */
const SEED_EARTH = { escgsat_qb_v1: { rec: { a1: { correct: true }, a2: { correct: true }, a3: { correct: true }, a4: { correct: false }, a5: { correct: false } },
  wrong: ['a4', 'a5'], fav: [] } };

const { server, port } = await startServer();
const BASE = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(path.join(tmpdir(), 'gsat702-ui-'));
const DEBUG_PORT = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let c;
async function cleanup() {
  try { chrome.kill(); } catch {}
  server.close();
  await sleep(300);
  try { await rm(profile, { recursive: true, force: true }); } catch {}
}

const EMOJI = '/\\p{Extended_Pictographic}/u';

try {
  console.log('對象：' + ROOT);
  c = await CDP.connect(DEBUG_PORT);
  await c.width(390);
  await c.scheme('light');

  console.log('\n[1 載入與題庫入口]');
  const loaded = await c.open(BASE);
  ok('1.1 三張題庫卡載入', loaded, await c.eval(`document.querySelectorAll('#cards .card').length`));
  const cards = await c.eval(`[...document.querySelectorAll('#cards .card')].map(a=>({href:a.getAttribute('href'), t:a.textContent.replace(/\\s+/g,' ')}))`);
  ok('1.2 三張卡依序連到 biology／earth／advanced-bio', JSON.stringify(cards.map((x) => x.href)) ===
    JSON.stringify(['biology/index.html', 'earth/index.html', 'advanced-bio/index.html']), cards.map((x) => x.href));
  ok('1.3 卡片題數照實：78 題（選擇 69＋非選 9）／70 題（選擇 62＋非選 8）／242 題（選擇 186＋非選 56）',
    /學測生物/.test(cards[0].t) && /78 題（選擇 69＋非選 9）/.test(cards[0].t) &&
    /學測地科/.test(cards[1].t) && /70 題（選擇 62＋非選 8）/.test(cards[1].t) &&
    /分科生物/.test(cards[2].t) && /242 題（選擇 186＋非選 56）/.test(cards[2].t), cards.map((x) => x.t.slice(0, 80)));
  ok('1.4 頁尾來源說明：大考中心官方公開試題、逐題解析整理中', await c.eval(`/大考中心官方公開試題/.test(document.getElementById('foot').textContent) && /逐題解析整理中/.test(document.getElementById('foot').textContent)`));
  const fresh = await c.eval(`(()=>{const m=document.querySelectorAll('#cards .card.main'); return {n:m.length, href:m[0]&&m[0].getAttribute('href'), txt:m[0]&&m[0].textContent}})()`);
  ok('1.5 沒有進度時主推＝學測生物（唯一一張 .main，寫「建議從這裡開始」）', fresh.n === 1 && fresh.href === 'biology/index.html' && /建議從這裡開始/.test(fresh.txt), fresh);
  ok('1.6 頁首品牌：山形圖＋App 名「學測自然複習」', await c.eval(`!!document.querySelector('header.rl-appbar img.rl-glyph') && document.querySelector('.rl-title').textContent==='學測自然複習'`));

  console.log('\n[2 學測日期：驗證格式、同步三支 App]');
  await c.eval(`document.getElementById('examIn').value='2027-02-30'; document.querySelector('#exam form button[type=submit]').click()`);
  ok('2.1 不存在的日期（2027-02-30）不儲存、顯示格式提示', await c.eval(`/日期格式不對/.test(document.getElementById('examMsg').textContent) && !localStorage.getItem('natsci_hub_v1')`));
  await c.eval(`document.getElementById('examIn').value='2099/1/16'; document.querySelector('#exam form button[type=submit]').click()`);
  const sync = await c.eval(`(()=>{const g=k=>{try{return JSON.parse(localStorage.getItem(k)||'{}')}catch(e){return{}}};
    return {hub:g('natsci_hub_v1').examDate, bio:(g('biogsat_qb_v1').settings||{}).examDate, esc:(g('escgsat_qb_v1').settings||{}).examDate, fk:(g('fenke_qb_v1').settings||{}).examDate,
      txt:document.getElementById('exam').textContent.replace(/\\s+/g,' ')}})()`);
  ok('2.2 輸入 2099/1/16：存成 2099-01-16，hub 與三支 App 的 settings.examDate 都同步', sync.hub === '2099-01-16' && sync.bio === sync.hub && sync.esc === sync.hub && sync.fk === sync.hub, sync);
  ok('2.3 顯示「距離學測還有 N 天」倒數', /距離學測還有 \d+ 天/.test(sync.txt), sync.txt.slice(0, 120));

  console.log('\n[3 進度總覽與主推題庫]');
  await c.open(BASE, SEED_EARTH);
  const st = await c.eval(`document.getElementById('stats').textContent.replace(/\\s+/g,' ')`);
  ok('3.1 總覽：累計已練 5、總答對率 60%、待清錯題 2', /5\s*累計已練/.test(st) && /60%\s*總答對率/.test(st) && /2\s*待清錯題/.test(st), st);
  const m2 = await c.eval(`(()=>{const m=document.querySelectorAll('#cards .card.main'); return {n:m.length, href:m[0]&&m[0].getAttribute('href'), txt:m[0]&&m[0].textContent.replace(/\\s+/g,' ')}})()`);
  ok('3.2 有進度的學測地科變成主推，按鈕寫「繼續練習」', m2.n === 1 && m2.href === 'earth/index.html' && /繼續練習/.test(m2.txt), m2);
  ok('3.3 地科卡寫「選擇題已練 5 / 62（8%）」與答對率 60%', /選擇題已練 5 \/ 62（8%）/.test(m2.txt) && /答對率 60%/.test(m2.txt), m2.txt);

  console.log('\n[4 分頁]');
  const tabs = await c.eval(`[...document.querySelectorAll('#tabs a')].map(a=>a.getAttribute('href'))`);
  ok('4.1 底部分頁三個：題庫／倒數與進度／說明', JSON.stringify(tabs) === JSON.stringify(['#qbank', '#exam', '#help']), tabs);
  await c.eval(`document.querySelector('#tabs a[href="#help"]').click()`);
  await sleep(600);
  const help = await c.eval(`(()=>{const h=document.getElementById('help'); const r=h.getBoundingClientRect(); const t=h.querySelector('.tip');
    return {cur:document.querySelector('#tabs a[href="#help"]').getAttribute('aria-current'), top:Math.round(r.top), tipVisible:!!t && t.getBoundingClientRect().height>20, txt:/三支 App 各自獨立/.test(h.textContent)}})()`);
  ok('4.2 點「說明」：捲到說明區、說明內容看得到、分頁標成目前', help.cur === 'true' && help.top < 500 && help.tipVisible && help.txt, help);

  console.log('\n[5 版面不溢出]');
  for (const w of [390, 1440]) {
    await c.width(w, w > 600 ? 900 : 844);
    await c.open(BASE);
    const hs = await c.eval(`document.documentElement.scrollWidth > window.innerWidth + 1`);
    ok(`5.1 ${w}px 沒有水平捲動`, !hs);
  }
  const two = await c.eval(`(()=>{const e=document.getElementById('exam').getBoundingClientRect(), q=document.getElementById('qbank').getBoundingClientRect(); return {eR:Math.round(e.right), qL:Math.round(q.left), eT:Math.round(e.top), qT:Math.round(q.top)}})()`);
  ok('5.2 1440px 桌機兩欄：學測日期在左、題庫在右', two.eR <= two.qL, two);
  await c.width(390);

  console.log('\n[7 自然探險 2026-10-19：主視覺、圓體字型、3D 圖、一致卡片、頁首減重]');
  await c.open(BASE, SEED_EARTH);
  const hero = await c.eval(`(()=>{const h=document.querySelector('.hero'); if(!h) return null; const r=h.getBoundingClientRect(); const cards=document.getElementById('cards').getBoundingClientRect();
    const prim=[...h.querySelectorAll('.go-main')]; return {top:Math.round(r.top), bottom:Math.round(r.bottom), cardsTop:Math.round(cards.top), inHeader:!!h.closest('header'),
      prim:prim.length, href:prim[0]&&prim[0].getAttribute('href'), label:prim[0]&&prim[0].textContent.trim(), h2:(h.querySelector('h2')||{}).textContent}})()`);
  ok('7.1 手機首屏主視覺：在內容區頂端（不在黏住的頁首）、在題庫卡上方、首屏內看得到', !!hero && !hero.inHeader && hero.top < 260 && hero.bottom <= hero.cardsTop && hero.bottom < 844, hero);
  ok('7.2 主視覺裡只有一顆主行動，連到主推題庫（有進度＝學測地科），寫「繼續練習」', !!hero && hero.prim === 1 && hero.href === 'earth/index.html' && /繼續練習/.test(hero.label), hero);
  const xp = await c.eval(`(()=>{const i=document.querySelector('.hero .xp i'); return i? {w:i.style.width, t:(document.querySelector('.hero .xpl')||{}).textContent} : null})()`);
  ok('7.3 主視覺進度條＝三題庫選擇題已練 5 / 317（2%）', !!xp && xp.w === '2%' && /5\s*\/\s*317/.test(xp.t), xp);
  await c.eval(`document.fonts.ready`);
  const font = await c.until(`[...document.fonts].some(f=>f.family.replace(/"/g,'')==='GsRound' && f.status==='loaded')`, 5000);
  const fams = await c.eval(`['.hero h2','#cards .card .nm b','.rl-title','#tabs a','.hero .go-main'].map(s=>{const e=document.querySelector(s); return e? getComputedStyle(e).fontFamily : 'none'})`);
  ok('7.4 粉圓子集字型（GsRound）有載入，主視覺標題、題庫名、App 名、分頁、主鈕都用它', font && fams.every((f) => /GsRound/.test(f)), fams);
  const f3 = await c.eval(`(async()=>{const srcs=[...new Set([...document.querySelectorAll('img[src*="fluent-3d"]')].map(i=>i.getAttribute('src')))];
    const res=await Promise.all(srcs.map(s=>new Promise(ok=>{const im=new Image(); im.onload=()=>ok(im.naturalWidth>0?null:s); im.onerror=()=>ok(s); im.src=s;})));
    return {n:srcs.length, broken:res.filter(Boolean)}})()`);
  ok('7.5 用到的 3D 圖檔（' + f3.n + ' 種）全部載得出來', f3.n >= 10 && f3.broken.length === 0, f3);
  const cardImg = await c.eval(`[...document.querySelectorAll('#cards .card')].map(a=>{const i=a.querySelector('img[src*="fluent-3d"]'); return i&&i.getAttribute('src')})`);
  ok('7.6 三張題庫卡各有自己的 3D 圖（DNA／地球／顯微鏡）', cardImg.length === 3 && cardImg.every(Boolean) && new Set(cardImg).size === 3, cardImg);
  const emo = await c.eval(`(()=>{const els=[...document.querySelectorAll('#tabs a, .sect, #exam button, #exam label, #exam .top, .hero a, .hero button, #cards .go, .hud, .help-sum')];
    const bad=els.map(e=>e.textContent||'').filter(t=>${EMOJI}.test(t)); return {n:els.length, bad:bad.slice(0,5)}})()`);
  ok('7.7 操作與標題元件（' + emo.n + ' 個）文字裡沒有 emoji', emo.n >= 10 && emo.bad.length === 0, emo);
  const uni = await c.eval(`(()=>{const cs=[...document.querySelectorAll('#cards .card')].map(a=>{const s=getComputedStyle(a); return s.backgroundColor+'|'+s.backgroundImage+'|'+s.borderTopColor});
    const bars=[...document.querySelectorAll('#cards .prog i')].map(i=>getComputedStyle(i).backgroundImage+'|'+getComputedStyle(i).backgroundColor);
    return {cards:[...new Set(cs)], bars:[...new Set(bars)]}})()`);
  ok('7.8 三張題庫卡同一套外觀（底色、框色、進度條色一致，不再綠／藍／紫三色）', uni.cards.length === 1 && uni.bars.length === 1, uni);
  const hdr = await c.eval(`(()=>{const s=getComputedStyle(document.querySelector('header.rl-appbar')).backgroundColor; let m=s.replace(/^color\\(srgb/,'').match(/[\\d.]+/g).map(Number);
    if(/^color\\(srgb/.test(s)) m=[m[0]*255,m[1]*255,m[2]*255].concat(m.slice(3));   // color-mix() 會回 color(srgb 0–1 …)
    const a=m.length>3?m[3]:1; const lum=(0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255; return {bg:s, a, lum:+lum.toFixed(2)}})()`);
  ok('7.9 頁首不再是重色塊（淺色模式下頁首底是淺色或透明）', hdr.a < 0.5 || hdr.lum > 0.75, hdr);

  await c.width(1440, 900);
  await c.open(BASE, SEED_EARTH);
  const d = await c.eval(`(()=>{const R=s=>{const e=document.querySelector(s); return e? e.getBoundingClientRect() : {right:9999,top:-9999,bottom:0}}; const h=R('.hero'), q=R('#qbank'), e=R('#exam');
    const cards=[...document.querySelectorAll('#cards .card')].map(a=>a.getBoundingClientRect());
    const leftBottom=Math.max(h.bottom,e.bottom), rightBottom=Math.max(...cards.map(r=>r.bottom));
    return {heroR:Math.round(h.right), qL:Math.round(q.left), heroT:Math.round(h.top), qT:Math.round(q.top), leftBottom:Math.round(leftBottom), rightBottom:Math.round(rightBottom),
      tabsPos:getComputedStyle(document.getElementById('tabs')).display, hs:document.documentElement.scrollWidth>window.innerWidth+1}})()`);
  const bal = Math.abs(d.leftBottom - d.rightBottom) / Math.max(d.leftBottom, d.rightBottom);
  ok('7.10 1440px：左欄主視覺＋學測日期、右欄題庫，兩欄同高起跑、底部高度差 ≤20%（實測 ' + Math.round(bal * 100) + '%）',
    d.heroR <= d.qL && Math.abs(d.heroT - d.qT) <= 60 && bal <= 0.2 && !d.hs, d);
  ok('7.11 1440px：底部分頁不顯示（桌機兩欄都看得到，不再有浮在底部的窄條）', d.tabsPos === 'none', d.tabsPos);

  await c.width(390);
  await c.scheme('dark');
  await c.open(BASE, SEED_EARTH);
  const dk = await c.eval(`(()=>{const L=s=>{const m=s.match(/[\\d.]+/g).map(Number); return (0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255};
    const b=getComputedStyle(document.body).backgroundColor, card=getComputedStyle(document.querySelector('#cards .card')).backgroundColor, ink=getComputedStyle(document.querySelector('#cards .card .nm b')).color;
    return {b, card, ink, lb:+L(b).toFixed(2), lc:+L(card).toFixed(2), li:+L(ink).toFixed(2)}})()`);
  ok('7.12 深色模式：頁面與題庫卡是深底、題庫名是淺字', dk.lb < 0.2 && dk.lc < 0.25 && dk.li > 0.7, dk);
  await c.scheme('light');

  console.log('\n[8 手機返回鍵（2026-10-20）]');
  {
    // 用不同網址開（?bk=1）＝真的跨文件導覽，第一筆紀錄才是這一頁的首頁
    await c.width(390);
    await c.open(BASE + '?bk=1');
    await sleep(300);
    const view = () => c.eval(`({y:Math.round(scrollY), hash:location.hash, cur:[...document.querySelectorAll('#tabs a')].filter(a=>a.getAttribute('aria-current')==='true').map(a=>a.getAttribute('href')),
      help:document.getElementById('helpBox').open})`);
    const nav = async (expr) => { await c.eval(expr); await sleep(700); };
    const v0 = await view();
    await nav(`document.querySelector('#tabs a[href="#exam"]').click()`);
    const v1 = await view();
    await nav(`history.back()`);
    const v2 = await view();
    ok('8.1 首頁 → 點「倒數與進度」→ 上一頁：捲回原位（y ' + v1.y + '→' + v2.y + '）、網址沒有錨點、分頁亮燈回到「題庫」',
      v0.y < 50 && v1.y > 300 && v1.hash === '#exam' && v2.y < 50 && v2.hash === '' && JSON.stringify(v2.cur) === '["#qbank"]', { v0, v1, v2 });
    await nav(`document.querySelector('#tabs a[href="#exam"]').click()`);
    await nav(`document.querySelector('#tabs a[href="#help"]').click()`);
    const v3 = await view();
    await nav(`history.back()`);
    const v4 = await view();
    await nav(`history.forward()`);
    const v5 = await view();
    ok('8.2 倒數 → 點「說明」（展開）→ 上一頁：說明收回、回到倒數、亮燈「倒數與進度」；再前進：說明又展開',
      v3.help && v3.hash === '#help' && !v4.help && v4.hash === '#exam' && JSON.stringify(v4.cur) === '["#exam"]' && v5.help && v5.hash === '#help', { v3, v4, v5 });
    await nav(`history.back()`); await nav(`history.back()`);
    const v6 = await view();
    await c.eval(`window.__bk=1`);
    await nav(`history.back()`);
    const left = await c.eval(`typeof window.__bk === 'undefined'`).catch(() => true);
    ok('8.3 回到首頁（無錨點）後再按上一頁 → 離開這一頁', v6.hash === '' && left === true, { v6, left });
    // 使用者自己打開的說明（不是從分頁打開）不會被上一頁收掉
    await c.open(BASE + '?bk=2');
    await sleep(300);
    await c.eval(`document.getElementById('helpBox').open=true`);
    await nav(`document.querySelector('#tabs a[href="#exam"]').click()`);
    await nav(`history.back()`);
    const v7 = await view();
    ok('8.4 自己點開的說明，按分頁再上一頁後仍保持展開（只收回由分頁打開的）', v7.help === true && v7.hash === '', v7);
  }

  console.log('\n[6 沒有錯誤、只連本機]');
  ok('6.1 沒有未捕捉的 JS 例外', c.errors.length === 0, c.errors.slice(0, 3));
  const hosts = [...new Set(c.requests.filter((u) => /^https?:/i.test(u)).map((u) => new URL(u).hostname))];
  ok('6.2 只連本機（實際主機：' + hosts.join(', ') + '）', hosts.length > 0 && hosts.every((h) => h === '127.0.0.1'), hosts);
} catch (e) {
  fail++;
  console.log('  FAIL 測試程式本身出錯：' + (e && e.stack || e));
} finally {
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + '　通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  await cleanup();
  process.exit(fail ? 1 : 0);
}
