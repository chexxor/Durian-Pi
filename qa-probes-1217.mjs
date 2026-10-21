import { refusalFor } from './src/confine.mjs';
const B = 'git branch ';
const D = String.fromCharCode(45, 68);
const d = '-d';
const F = '--force';
const cases = [
  [B + d + ' ' + F + ' foo', 'want-block'],
  [B + F + ' ' + d + ' foo', 'want-block'],
  [B + F + ' --delete foo', 'want-block'],
  [B + '--delete ' + F + ' foo', 'want-block'],
  [B + '-df foo', 'want-block?'],
  [B + '"' + D + '" foo', 'want-block?'],
  ['git commit -m "msg" && ' + B + D + ' foo', 'want-block'],
  [B + D + ' foo' + ' && echo hi', 'want-block'],
  ['git -C x -C y ' + B + D + ' foo', 'want-block'],
  ['echo "x; ' + B + D + ' foo"', 'want-allow'],
  [B + d + ' ok-branch', 'want-allow'],
  [B + 'new-branch abc123', 'want-allow'],
  [B + '-m a b', 'want-allow'],
];
for (const [c, want] of cases) {
  const r = refusalFor(c);
  const verdict = r ? 'REFUSED(' + r.reason + ')' : 'allowed';
  console.log(want.padEnd(12), '|', verdict.padEnd(16), '|', c);
}
