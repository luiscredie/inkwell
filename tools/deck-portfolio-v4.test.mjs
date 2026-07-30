// V4 Deck Portfolio Advisor — canonical optimizer + contract tests. No deps.
//   node tools/deck-portfolio-v4.test.mjs
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const s = html.indexOf('class Component extends DCLogic'), e = html.indexOf('</script>', s);
const Component = new Function('DCLogic', 'React', html.slice(s, e) + '\nreturn Component;')(class { setState() {} }, { createElement: () => ({}) });
const plan = (inv, decks, o) => Component.computeDeckPortfolioPlan(inv, decks, o || { budget: 200000 });

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };

// 1. X=1, A needs 2, B needs 2 -> missingUnits=3
let P = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, needs: { X: 2 } }, { id: 'B', targetCopies: 1, needs: { X: 2 } }]);
ck('1 X=1,A2,B2 -> missingUnits=3', P.missingUnits === 3);
// 2. shared card lists both decks
ck('2 shared card lists both decks', P.sharedConflicts.length === 1 && Object.keys(P.sharedConflicts[0].decks).length === 2);
// 3. sum of allocations never exceeds inventory
ck('3 allocations <= inventory', P.allocations.length <= 1);
// 4/5. one copy completes exactly one deck (maximize completed)
P = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, needs: { X: 1 } }, { id: 'B', targetCopies: 1, needs: { X: 1 } }]);
ck('4 one copy completes exactly one deck', P.decksBuildable === 1);
// 6/7. priority breaks ties, never reduces completed max
const pa = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, priority: 0, needs: { X: 1 } }, { id: 'B', targetCopies: 1, priority: 9, needs: { X: 1 } }]);
ck('6 priority still completes 1 (not reduced)', pa.decksBuildable === 1);
ck('7 priority sends the copy to B', pa.allocations[0].deckId === 'B');
// 8. targetCopies 0 excludes
ck('8 targetCopies 0 excluded', plan({ X: 4 }, [{ id: 'A', targetCopies: 0, needs: { X: 1 } }]).decksRequested === 0);
// 9. targetCopies 10 requests 10 instances
ck('9 targetCopies 10 -> 10 requested', plan({ X: 40 }, [{ id: 'A', targetCopies: 10, needs: { X: 4 } }]).decksRequested === 10);
// 10. determinism
const d1 = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, needs: { X: 1 } }, { id: 'B', targetCopies: 1, needs: { X: 1 } }]);
const d2 = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, needs: { X: 1 } }, { id: 'B', targetCopies: 1, needs: { X: 1 } }]);
ck('10 deterministic', JSON.stringify(d1.allocations) === JSON.stringify(d2.allocations));
// 11. two copies build both
P = plan({ X: 2 }, [{ id: 'A', targetCopies: 1, needs: { X: 1 } }, { id: 'B', targetCopies: 1, needs: { X: 1 } }]);
ck('11 two copies build both, 0 missing', P.decksBuildable === 2 && P.missingUnits === 0);
// 12. one copy cannot reduce two decks' deficits simultaneously
P = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, needs: { X: 2 } }, { id: 'B', targetCopies: 1, needs: { X: 2 } }]);
const remainingDeficit = P.perDeck.A.missingByInstance.concat(P.perDeck.B.missingByInstance).reduce((s, m) => s + Object.values(m).reduce((a, b) => a + b, 0), 0);
ck('12 one copy cannot double-reduce deficit', remainingDeficit === 3);
// 13. mode/optimal present
ck('13 mode + optimal fields present', typeof P.optimal === 'boolean' && (P.mode === 'exact' || P.mode === 'heuristic'));
// 14. canonical fields present
ck('14 canonical fields', ['completedDeckInstances', 'allocations', 'missingUnits', 'sharedConflicts', 'unusedInventory', 'nextBestDeck', 'purchasesToUnlockNext'].every(k => k in P));

// ---- V4 correction regressions ----
// cardAllocations: real plan ledger
{
  const P = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, needs: { X: 2 } }, { id: 'B', targetCopies: 1, needs: { X: 2 } }]);
  const CA = P.cardAllocations.X;
  ck('cardAllocations exists with inventory', CA && CA.inventory === 1);
  ck('sum allocated never exceeds inventory', CA.allocated.reduce((s, a) => s + a.allocated, 0) <= CA.inventory);
  ck('deficits list both decks', new Set(CA.deficits.map(d => d.deckId)).size === 2);
  ck('no double allocation of one copy', CA.allocated.length === 1 && CA.allocated[0].allocated === 1);
}
// per-instance allocation when targetCopies > 1
{
  const P = plan({ X: 4 }, [{ id: 'A', targetCopies: 2, needs: { X: 2 } }]);
  const insts = new Set(P.cardAllocations.X.allocated.map(a => a.deckId + '#' + a.instance));
  ck('instances distinguished for targetCopies>1', insts.size === 2);
}
// purchasesToUnlockNext shape: {card, buy} — never undefined/NaN when rendered
{
  const P = plan({ X: 1 }, [{ id: 'A', targetCopies: 1, needs: { X: 2 } }]);
  ck('purchases carry buy field', P.purchasesToUnlockNext.every(p => typeof p.buy === 'number' && !Number.isNaN(p.buy)));
  ck('no legacy count field', P.purchasesToUnlockNext.every(p => p.count === undefined));
  ck('nextBestDeck is {deckId,missing}', P.nextBestDeck && P.nextBestDeck.deckId === 'A' && P.nextBestDeck.missing === 1);
}
// zero purchases -> empty list, no invalid entries
{
  const P = plan({ X: 2 }, [{ id: 'A', targetCopies: 1, needs: { X: 2 } }]);
  ck('zero purchases when complete', P.purchasesToUnlockNext.length === 0 && P.nextBestDeck === null);
}
// marginal +1 impact is deterministic and correct
{
  const inv = { X: 1 };
  const decks = [{ id: 'A', targetCopies: 1, needs: { X: 2 } }, { id: 'B', targetCopies: 1, needs: { X: 2 } }];
  const P1 = plan(inv, decks);
  const P2 = plan({ X: 2 }, decks);
  ck('+1 copy unlocks deck A', P2.decksBuildable - P1.decksBuildable === 1);
  ck('+1 copy reduces missing by 1 net unit', P1.missingUnits - P2.missingUnits === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
