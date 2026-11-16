// The task events (docs/metricas.md, "Tarefas"): each one is sent by its page, has a name public.track accepts
// ([a-z_], up to 30), is documented, and carries nothing but the name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const EVENTS = {
  scan_saved: 'colecao', scan_fixed: 'colecao', scan_asked: 'colecao', import_done: 'colecao',
  loan_requested: 'decks', loan_saved: 'trades', event_marked: 'eventos', game_added: 'coach',
};
const doc = read('../docs/metricas.md');

for (const [name, page] of Object.entries(EVENTS)) {
  test(`${name}: sent by ${page}, documented, name accepted by track`, () => {
    assert.match(name, /^[a-z_]{1,30}$/);
    const call = `window.INKWELL_TRACK?.("${name}")`;
    for (const file of [`../src/site/${page}/${page}.template.html`, `../site/${page}/index.html`]) {
      const src = read(file);
      assert.equal(src.split(call).length - 1, 1, `${file} sends ${name} exactly once`);
    }
    assert.ok(doc.includes('`' + name + '`'), `${name} is in docs/metricas.md`);
  });
}

test('the tracker takes only a name: no card, deck, person or number can ride along', () => {
  const shell = read('../src/site/shell.js');
  assert.match(shell, /window\.INKWELL_TRACK = \(name\) => \{ if \(!\/\^\[a-z_\]\{1,30\}\$\/\.test\(name \|\| ""\) \|\| statDone\.has\(name\)\) return;/);
  assert.match(shell, /const STAT_OFF = navigator\.webdriver \|\| navigator\.globalPrivacyControl === true \|\| navigator\.doNotTrack === "1"/);
});
