const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const source = process.argv[2];
const label = process.argv[3] || 'before';
const out = __dirname;
const profile = fs.mkdtempSync(path.join(out, 'browser-profile-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mock = `
window.fixtureCalls = [];
window.__TAURI__ = {
 core: { convertFileSrc: s => s, invoke: async (cmd, args) => {
  fixtureCalls.push(cmd);
  if (cmd === 'save_settings') { S.settings = args.settings; return null; }
  if (cmd === 'account_state') return { signedIn: false };
  if (cmd === 'plugin_list') return { all_off: false, plugins: [] };
  if (cmd === 'data_ids') return { usage: 'synthetic-usage', stats: 'synthetic-stats' };
  if (['easy_setup', 'libraries', 'download_history', 'inbox', 'news', 'screenshots', 'list_plugins', 'migrate_scan', 'adopt_scan'].includes(cmd)) return [];
  if (cmd === 'game_setup') return { needs: false, settings: [] };
  if (cmd === 'get_releases') return { data: [] };
  if (cmd === 'take_link' || cmd === 'take_setup_asked' || cmd === 'launcher_update') return null;
  if (cmd === 'get_state') return { os: 'windows', arch: 'x64', version: '0.90.0-beta.47', site: location.origin, library: S.library, settings: S.settings };
  return {};
 } },
 event: { listen: async () => () => {} },
 window: { getCurrentWindow: () => new Proxy({}, { get: () => async () => false }) }
};
`;
const fixture = `
const names = ['Sky Racer', 'Marble Quest', 'Forest Adventure', 'Star Pilot', 'Pixel Rally', 'Castle Run'];
const apps = names.map((name, i) => ({ id: 'fixture-' + i, name, game: name, author: 'Example Studio', repo: 'example/game-' + i,
 systems: ['windows', 'linux', 'macos'], version: '1.0', tag: 'v1.0', genre: 'adventure', origin: 'n64',
 desc: 'Synthetic game entry for a local layout test.', about: { summary: 'A synthetic game for the local layout check.' },
 cover: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="hsl(' + (i * 55) + ',45%,30%)"/><text x="150" y="220" text-anchor="middle" fill="white" font-size="26">' + name + '</text></svg>') }));
Object.assign(S, { site: location.origin, os: 'windows', arch: 'x64', version: '0.90.0-beta.47',
 settings: { setup_done: true, data_asked: true, check_updates: false, library_dirs: [], rom_dirs: [], ui: { pins: apps.map(a => a.id), lang: 'en', enjoy_done: 'up', seen_version: '0.90.0-beta.47' } },
 cat: { apps, origins: [{id:'n64',name:'Nintendo 64'}] }, account: {signedIn:false},
 owned: {}, missing: new Set(), gameSets: {}, trend: {entries:[]},
 library: Object.fromEntries(apps.map(a => [a.id, {id:a.id,name:a.name,repo:a.repo,tag:'v1.0',path:'/synthetic/'+a.id,exe:'game.exe',played_secs:1200,last_played:1800000000,files_in_place:true}])) });
window.fixtureShow = (view, tab) => { S.view = view; S.setTab = tab || 'general'; S.arg = 'fixture-0'; S.anim = null; render(); };
fixtureShow('library');
window.fixtureReady = true;
`;

class CDP {
 constructor(url) {
  this.id = 0; this.pending = new Map(); this.handlers = new Map();
  this.socket = new WebSocket(url);
  this.ready = new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
  this.socket.onclose = () => { for(const p of this.pending.values()) p.reject(new Error('Browser closed')); this.pending.clear(); };
  this.socket.onmessage = event => {
   const m = JSON.parse(event.data);
   if (m.id) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
   else this.handlers.get(m.method)?.(m.params);
  };
 }
 async send(method, params = {}) {
  await this.ready;
  return new Promise((resolve, reject) => { const id = ++this.id; this.pending.set(id, {resolve,reject}); this.socket.send(JSON.stringify({id,method,params})); });
 }
 async evaluate(expression) {
  const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 }
}

(async () => {
 let browser, cdp;
 const errors = [], blocked = [], measurements = [];
 const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(source, 'ui', name);
  if (!file.startsWith(path.resolve(source, 'ui') + path.sep)) { res.writeHead(403).end(); return; }
  try {
   let body = fs.readFileSync(file);
   if (name === 'index.html') body = body.toString().replace('<script src="i18n.js">', '<script>' + mock + '</script><script src="i18n.js">').replace('</body>', '<script>' + fixture + '</script></body>');
   if (name === 'app.js') body = body.toString().split('(async function start() {')[0];
   const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
   res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
 });
 try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const log = fs.openSync(path.join(out, label + '-chrome.log'), 'w');
  browser = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
   '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
   '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync',
   '--no-first-run', '--no-default-browser-check', '--password-store=basic', 'about:blank'
  ], {stdio:['ignore',log,log]});
  fs.closeSync(log);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i=0; i<100 && !fs.existsSync(portFile); i++) await delay(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  cdp = new CDP(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  cdp.handlers.set('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails));
  cdp.handlers.set('Fetch.requestPaused', async p => {
   if (p.request.url.startsWith(origin + '/')) await cdp.send('Fetch.continueRequest', {requestId:p.requestId});
   else { blocked.push(p.request.url); await cdp.send('Fetch.failRequest', {requestId:p.requestId,errorReason:'BlockedByClient'}); }
  });
  await cdp.send('Fetch.enable', {patterns:[{urlPattern:'http*'}]});
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:640,height:480,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate', {url:origin});
  for (let i=0;i<100;i++) { if (await cdp.evaluate('!!window.fixtureReady')) break; await delay(50); }
  if (!(await cdp.evaluate('!!window.fixtureReady'))) throw new Error('Fixture did not start: ' + JSON.stringify(errors));
  for (const [width,height] of [[640,480],[720,576],[640,432],[560,400],[1280,400],[1280,860]]) {
   await cdp.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
   await cdp.evaluate(`S.launcherUpd = ${height === 400 ? "{version:'0.90.0-beta.99'}" : 'null'};`);
   for (const view of ['home','library','discover','downloads','settings','game']) {
    await cdp.evaluate('fixtureShow(' + JSON.stringify(view) + ')');
    await delay(250);
    await cdp.evaluate('document.fonts.ready');
    const result = await cdp.evaluate(`(() => {
     const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
     const nodes = [...document.querySelectorAll('#side button')].filter(e => e.getClientRects().length).map(e => ({label:e.getAttribute('aria-label')||e.title||e.textContent.trim(),rect:rect(e),hit:e.contains(document.elementFromPoint(e.getBoundingClientRect().x+e.getBoundingClientRect().width/2,e.getBoundingClientRect().y+e.getBoundingClientRect().height/2))}));
     return {nodes,main:{client:main.clientWidth,scroll:main.scrollWidth},sidebar:{client:side.clientHeight,scroll:side.scrollHeight},page:document.querySelector('.page')?rect(document.querySelector('.page')):null};
    })()`);
    const reachability = await cdp.evaluate(`(() => {
     const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); };
     const footer = [...document.querySelectorAll('.side-foot button')].filter(e=>e.getClientRects().length);
     const fixedFooter = footer.every(visible);
     const unreachable = [];
     for (const e of document.querySelectorAll('#side .navs button,#pins button')) { if (!e.getClientRects().length) continue; e.focus(); if(!visible(e)) unreachable.push(e.title||e.textContent.trim()); }
     const tabs = [...document.querySelectorAll('.tabs-in button')];
     const unreachableTabs = [];
     for (const e of tabs) { e.focus(); if(!visible(e)) unreachableTabs.push(e.textContent.trim()); }
     return {fixedFooter,unreachable,unreachableTabs};
    })()`);
    // Pointer-wheel scrolling must reach the last pinned game too; focus alone can scroll hidden overflow.
    await cdp.evaluate(`document.querySelector('#side .navs button').focus();`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:35,y:110});
    await delay(80);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:35,y:110,deltaX:0,deltaY:1600});
    await delay(350);
    const wheelReachesLastPin = await cdp.evaluate(`(() => { const e=document.querySelector('#pins button:last-child'),r=e.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:35,y:110,deltaX:0,deltaY:-1600});
    await delay(180);
    await cdp.evaluate(`{ document.activeElement.blur(); document.getElementById('main').scrollTop=0; for(const e of [document.getElementById('side'),...document.querySelectorAll('#side *')])e.scrollTop=0; const tabs=document.querySelector('.tabs-in'); if(tabs)tabs.scrollLeft=0; }`);
    measurements.push({width,height,view,...result,reachability,wheelReachesLastPin});
    const shot = await cdp.send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(out, `${label}-${width}x${height}-${view}.png`), Buffer.from(shot.data,'base64'));
   }
  }
  fs.writeFileSync(path.join(out,label+'-measurements.json'),JSON.stringify({measurements,errors,blocked},null,2));
  console.log(JSON.stringify({label,errors,blocked,measurements:measurements.map(m=>({width:m.width,height:m.height,view:m.view,sidebar:m.sidebar,offscreen:m.nodes.filter(n=>n.rect.bottom>m.height||n.rect.y<0).map(n=>n.label),main:m.main}))},null,2));
 } finally {
  if (cdp) { await Promise.race([cdp.send('Browser.close').catch(()=>{}),delay(1000)]); cdp.socket.close(); }
  if (browser && browser.exitCode === null) { await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),delay(3000)]); if (browser.exitCode === null) browser.kill(); }
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(profile,{recursive:true,force:true});
 }
})().catch(e => { console.error(e); process.exitCode=1; });
