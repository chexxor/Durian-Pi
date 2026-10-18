import { refusalFor } from './src/confine.mjs';
const D = String.fromCharCode(45, 68);
const cases = [
  ['git -C x ' + 'branch ' + D + ' foo', 'want-block'],
  ['git --no-pager ' + 'branch ' + D + ' foo', 'want-block'],
  ['git -c ' + 'a.b=1 ' + 'branch ' + D + ' foo', 'want-block'],
  ['git ' + '--git-dir=. ' + 'branch ' + D + ' foo', 'want-block'],
  ['git -c ' + 'a.b=1 ' + 'status', 'want-allow'],
];
for (const [c, want] of cases) {
  const r = refusalFor(c);
  console.log(want.padEnd(12), '|', (r ? 'REFUSED' : 'allowed').padEnd(8), '|', c);
}
