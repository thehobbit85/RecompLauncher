const fs = require('node:fs');
const assert = require('node:assert/strict');
const file = process.argv[2];
const {measurements,errors,blocked} = JSON.parse(fs.readFileSync(file,'utf8'));
assert.deepEqual(errors, [], 'the synthetic UI must render without exceptions');
assert.deepEqual(blocked, [], 'the local check must not need external requests');
let failures = 0;
for (const m of measurements) {
 const name = `${m.width}x${m.height} ${m.view}`;
 const checks = {
  'footer controls stay visible': m.reachability.fixedFooter,
  'all sidebar destinations can be focused and hit': m.reachability.unreachable.length === 0,
  'wheel scrolling reaches the last pin': m.wheelReachesLastPin,
  'all game tabs can be focused and hit': m.reachability.unreachableTabs.length === 0,
  'page content fits its width': m.main.scroll <= m.main.client + 1,
 };
 for (const [check,passed] of Object.entries(checks)) {
  if (!passed) { failures++; console.log(`FAIL ${name}: ${check}`); }
 }
}
console.log(`${measurements.length} viewport/page cases, ${failures} failed checks.`);
process.exitCode = failures ? 1 : 0;
