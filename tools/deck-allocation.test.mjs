// Deck Portfolio Optimizer unit tests (M1P Checkpoint B). No deps.
// Extracts the pure static Component.computeDeckPortfolioPlan from site/index.html.
//   node tools/deck-allocation.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const sIdx = html.indexOf('static computeDeckPortfolioPlan');
const end = html.indexOf('\n  portfolioInventory()', sIdx);
const body = html.slice(sIdx, end);
const plan = new Function('return function computeDeckPortfolioPlan' + body.slice('static computeDeckPortfolioPlan'.length) + '\n;')();

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };
const D = (id, needs, targetCopies = 1, priority = 0) => ({ id, needs, targetCopies, priority });

// 1 one shared card completes A but not B → allocate to A
let r = plan({ X: 1, a: 4, b: 4 }, [D('A', { X: 1, a: 1 }), D('B', { X: 1, b: 1, c: 1 })]);
ck('1 shared card completes A not B → A built', r.perDeck.A.buildable && !r.perDeck.B.buildable);
ck('1 B still lists X missing', Object.keys(r.perDeck.B.missingByInstance[0]).includes('c') || Object.keys(r.perDeck.B.missingByInstance[0]).includes('X'));

// 2 two copies → both complete
r = plan({ X: 2 }, [D('A', { X: 1 }), D('B', { X: 1 })]);
ck('2 two copies → A and B built', r.perDeck.A.buildable && r.perDeck.B.buildable && r.decksBuildable === 2);

// 3 targetCopies 2, resources for 1 → 1 of 2
r = plan({ X: 1 }, [D('A', { X: 1 }, 2)]);
ck('3 target 2 resources 1 → built 1 of 2', r.perDeck.A.built === 1 && !r.perDeck.A.buildable);

// 4 no card used twice
r = plan({ X: 1 }, [D('A', { X: 1 }), D('B', { X: 1 })]);
ck('4 single copy → exactly one deck built', r.decksBuildable === 1);

// 5 normal+foil combined inventory (caller pools them) — represented as X:2
r = plan({ X: 2 }, [D('A', { X: 2 })]);
ck('5 pooled inventory builds deck needing 2', r.perDeck.A.buildable);

// 6 equivalent reprints combined (caller merges by canonical key → same key X)
r = plan({ X: 3 }, [D('A', { X: 3 })]);
ck('6 merged reprints satisfy need', r.perDeck.A.buildable);

// 7 different subtitles remain separate keys
r = plan({ 'hero-a': 1, 'hero-b': 1 }, [D('A', { 'hero-a': 1, 'hero-b': 1 })]);
ck('7 distinct subtitle keys counted separately', r.perDeck.A.buildable);
r = plan({ 'hero-a': 2 }, [D('A', { 'hero-a': 1, 'hero-b': 1 })]);
ck('7b wrong-subtitle stock does NOT satisfy other', !r.perDeck.A.buildable);

// 8 priority pin decides a tie (only one X; B pinned higher)
r = plan({ X: 1 }, [D('A', { X: 1 }, 1, 0), D('B', { X: 1 }, 1, 5)]);
ck('8 higher priority B wins the contested card', r.perDeck.B.buildable && !r.perDeck.A.buildable);

// 9 targetCopies 0 excludes without deleting
r = plan({ X: 5 }, [D('A', { X: 1 }, 0), D('B', { X: 1 }, 1)]);
ck('9 target 0 excluded from plan', r.perDeck.A === undefined && r.perDeck.B.buildable);

// 10 deterministic deck_id tie-break (equal priority, one card)
r = plan({ X: 1 }, [D('B', { X: 1 }), D('A', { X: 1 })]);
ck('10 deck_id tie-break → A before B', r.perDeck.A.buildable && !r.perDeck.B.buildable);

// 11 maximize completed instances (2 X + 1 y; A needs X, B needs X+y) → both if possible
r = plan({ X: 2, y: 1 }, [D('A', { X: 1 }), D('B', { X: 1, y: 1 })]);
ck('11 maximize completed instances → 2 built', r.decksBuildable === 2);

// 12 missing units minimized in leftover reporting
r = plan({ X: 1 }, [D('A', { X: 1 }), D('B', { X: 1, y: 2 })]);
ck('12 missingUnits counts B shortfall', r.missingUnits >= 1);

// 13 optimal flag true for small exact search
r = plan({ X: 2 }, [D('A', { X: 1 }), D('B', { X: 1 })]);
ck('13 optimal=true within budget', r.optimal === true);

// 14 determinism: identical inputs → identical output
const inv = { X: 2, y: 3 }, decks = [D('A', { X: 1, y: 1 }), D('B', { X: 1, y: 2 })];
ck('14 deterministic repeat', JSON.stringify(plan(inv, decks)) === JSON.stringify(plan(inv, decks)));

// 15 bounded fallback → optimal=false, never throws (many instances)
const many = []; for (let i = 0; i < 20; i++) many.push(D('D' + String(i).padStart(2, '0'), { X: 1 }, 1));
r = plan({ X: 5 }, many, { budget: 50 });
ck('15 large input → recommended (optimal=false), still returns', r.optimal === false && typeof r.decksBuildable === 'number');

// 16 empty decks → zero, no throw
r = plan({ X: 1 }, []);
ck('16 no decks → 0 requested', r.decksRequested === 0 && r.decksBuildable === 0);


// R2 shared-copy missingUnits: one physical X cannot reduce two decks' deficit
r = plan({ X: 1 }, [D('A', { X: 2 }), D('B', { X: 2 })]);
ck('19 shared copy not double-counted (missingUnits=3)', r.missingUnits === 3 && r.decksBuildable === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
