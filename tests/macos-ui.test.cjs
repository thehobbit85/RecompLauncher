const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the real picker logic without requiring a webview or invoking a native dialog.
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
function picker(os, opts, entry) {
  const ctx = vm.createContext({
    S: { os }, FB: { opts, sel: 0, path: '/Games' },
    fbRows: () => entry ? [entry] : [],
  });
  for (const name of ['fbProgramBundle', 'fbTakes', 'fbChoice']) {
    const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
    if (match) vm.runInContext(match[0], ctx);
  }
  return vm.runInContext('fbChoice()', ctx);
}

const app = { name: 'My Game.app', path: '/Games/My Game.app', dir: true };
test('Choose Program can select a Mac app bundle', () => {
  assert.equal(picker('macos', { program: true }, app), app.path);
});
test('a ROM file picker does not accept an app directory as the game copy', () => {
  assert.equal(picker('macos', { filters: [{ extensions: ['z64'] }] }, app), '');
});
test('ordinary directories remain navigable rather than selectable as programs', () => {
  assert.equal(picker('macos', { program: true }, { name: 'Folder', path: '/Games/Folder', dir: true }), '');
  assert.equal(picker('windows', { program: true }, app), '');
  assert.equal(picker('linux', { program: true }, app), '');
});
test('file and folder selection keep their existing behavior', () => {
  assert.equal(picker('windows', { program: true }, { name: 'Game.exe', path: '/Games/Game.exe', dir: false }), '/Games/Game.exe');
  assert.equal(picker('macos', { directory: true }, app), app.path);
  assert.equal(picker('macos', { directory: true }, null), '/Games');
});

function gameActions(os, steam, tv) {
  const game = { id: 'game', name: 'My Game', path: '/Games/My Game' };
  const ctx = vm.createContext({
    S: { os, steam, library: { game }, updates: {}, view: 'game', arg: 'game',
      easy: new Set(), mods: {}, setup: {}, running: new Set(), jobs: {} },
    TV: { view: 'game', arg: 'game', sheet: {} }, GAMEVIEWS: ['game'], window: {},
    byId: () => null, libAppOf: () => game, pins: () => [], favs: () => [],
    looksHere: () => false, mainItem: () => null, verGroup: () => null,
    timeLine: () => '', t: (s) => s, esc: (s) => s,
  });
  if (tv) {
    const code = fs.readFileSync(path.join(__dirname, '../ui/tv.js'), 'utf8');
    const match = code.match(/^  function gameSheet\([^]*?^  }/m);
    assert.ok(match, 'Big Picture game menu exists');
    ctx.sheet = (_name, items) => { ctx.items = items; };
    vm.runInContext(match[0], ctx);
    vm.runInContext("gameSheet('game')", ctx);
  } else {
    const match = source.match(/^function gameMenu\([^]*?^}/m);
    assert.ok(match, 'desktop game menu exists');
    vm.runInContext(match[0], ctx);
    ctx.items = vm.runInContext("gameMenu('game')", ctx);
  }
  const labels = [];
  function collect(items) {
    for (const item of items) {
      if (item.label) labels.push(item.label);
      if (item.sub && Array.isArray(item.sub)) collect(item.sub);
    }
  }
  collect(ctx.items);
  return labels;
}

test('Mac desktop and Big Picture menus omit unsupported shortcuts even if Steam is detected', () => {
  for (const tv of [false, true]) {
    for (const steam of [false, true]) {
      const labels = gameActions('macos', steam, tv);
      for (const label of ['Add To', 'Add to desktop', 'Add to Steam', 'Add to App Menu', 'Add to Start Menu']) {
        assert.ok(!labels.includes(label), `${label} must be hidden on Mac (TV: ${tv})`);
      }
      assert.ok(labels.includes('Screenshots'), 'other game actions remain available');
    }
  }
});

test('Windows and Linux keep desktop shortcuts and conditionally offer Steam in both menus', () => {
  for (const os of ['windows', 'linux']) {
    for (const tv of [false, true]) {
      for (const steam of [false, true]) {
        const labels = gameActions(os, steam, tv);
        assert.ok(labels.includes('Add to desktop'));
        assert.equal(labels.includes('Add to Steam'), steam);
        if (!tv) assert.ok(labels.includes(os === 'windows' ? 'Add to Start Menu' : 'Add to App Menu'));
      }
    }
  }
});
