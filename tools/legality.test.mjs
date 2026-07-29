// Legality engine end-to-end contract tests. No dependencies.
// Run: node tools/legality.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const start = html.indexOf('class Component extends DCLogic');
const end = html.indexOf('</script>', start);
const Component = new Function(
  'DCLogic',
  'React',
  html.slice(start, end) + '\nreturn Component;'
)(class { setState() {} }, { createElement: () => ({}) });

const c = Object.create(Component.prototype);
c.CORE_SETS = ['LOR7', 'LOR8', 'LOR9', 'LOR10', 'LOR11', 'LOR12', 'LOR13', 'Q2', 'DLPC2'];
c.INK = {
  Amber: '#F2B33D', Amethyst: '#9B72CF', Emerald: '#37B36B',
  Ruby: '#E23B4E', Sapphire: '#2E90E0', Steel: '#8C97A8',
};
c.cards = [
  { card_id: 'LOR1-1', name_en: 'Old Card', set_code: 'LOR1', ink_color: 'Amber', card_type: 'Character' },
  { card_id: 'LOR9-1', name_en: 'Old Card', set_code: 'LOR9', ink_color: 'Amber', card_type: 'Character' },
  { card_id: 'LOR9-45', name_en: 'Dumbo - Ninth Wonder', set_code: 'LOR9', ink_color: 'Sapphire', card_type: 'Character' },
  { card_id: 'PUP-1', name_en: 'Dalmatian Puppy - Tail Wagger', set_code: 'LOR9', ink_color: 'Amber', card_type: 'Character' },
  { card_id: 'E-1', name_en: 'Emerald Card', set_code: 'LOR9', ink_color: 'Emerald', card_type: 'Character' },
  { card_id: 'R-1', name_en: 'Ruby Card', set_code: 'LOR9', ink_color: 'Ruby', card_type: 'Character' },
  { card_id: 'S-1', name_en: 'Sapphire Card', set_code: 'LOR9', ink_color: 'Sapphire', card_type: 'Character' },
];
c.byId = Object.fromEntries(c.cards.map(card => [card.card_id, card]));
c._byName = {};
for (const card of c.cards) {
  const key = card.name_en.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
  (c._byName[key] = c._byName[key] || []).push(card);
}
for (const method of [
  'nameKey', 'baseName', 'printingsOf', 'fmtRules', 'legalSets',
  'legalityRevision', 'minDeckSize', 'maxInks', 'bannedIn',
  'legalInFormat', 'copyLimitFor', 'inkList', 'deckEntries',
  'deckCount', 'validateDeck', 'validForDeck', 'importBlockers',
]) c[method] = Component.prototype[method];
c.buildNameIndex = function () {};

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

// Embedded fallback.
c.legalityData = null;
check('fallback includes current Core printing', c.legalSets('core').includes('LOR9'));
check('fallback minimum deck size is 60', c.minDeckSize('core') === 60);
check('fallback maximum ink colors is 2', c.maxInks('core') === 2);
check('fallback copy limit is 4', c.copyLimitFor(c.byId['LOR9-45'], 'core') === 4);
check('fallback puppy override is 99', c.copyLimitFor(c.byId['PUP-1'], 'core') === 99);
check('old printing is legal through a current reprint', c.legalInFormat(c.byId['LOR1-1'], 'core') === true);
check('Infinity bypasses rotation', c.legalInFormat(c.byId['LOR9-45'], 'infinity') === true);

// Canonical data-driven artifact.
c.legalityData = { formats: { core: {
  minimum_deck_size: 40,
  maximum_ink_colors: 3,
  legal_sets: ['LOR13'],
  banned_card_ids: ['LOR9-45'],
  default_copy_limit: 3,
  copy_limit_overrides: { 'dalmatian puppy - tail wagger': 99 },
  effective_from: '2026-08-01',
} } };
check('artifact minimum size overrides fallback', c.minDeckSize('core') === 40);
check('canonical maximum_ink_colors overrides fallback', c.maxInks('core') === 3);
check('artifact exposes effective date', c.legalityRevision('core') === '2026-08-01');
check('artifact ban is enforced', c.legalInFormat(c.byId['LOR9-45'], 'core') === false);
check('artifact legal_sets restricts unmatched reprints', c.legalInFormat(c.byId['LOR1-1'], 'core') === false);
check('artifact copy limit overrides fallback', c.copyLimitFor(c.byId['LOR9-1'], 'core') === 3);
check('artifact per-card copy override is retained', c.copyLimitFor(c.byId['PUP-1'], 'core') === 99);

// Backward-compatible alias for an early legality draft.
c.legalityData = { formats: { core: { maximum_inks: 4 } } };
check('legacy maximum_inks remains readable', c.maxInks('core') === 4);

// Structured validateDeck integration.
c.legalityData = null;
let result = c.validateDeck({
  colors: ['Amber'],
  format: 'core',
  cards: { 'LOR9-1': 4 },
});
check('incomplete deck receives MIN_SIZE', result.issues.some(issue => issue.code === 'MIN_SIZE'));
check('MIN_SIZE is not a hard import blocker', c.importBlockers({
  colors: ['Amber'],
  format: 'core',
  cards: { 'LOR9-1': 4 },
}).length === 0);

result = c.validateDeck({
  colors: [],
  format: 'core',
  cards: { 'E-1': 1, 'R-1': 1, 'S-1': 1 },
});
check('three inks receive MAX_INKS', result.issues.some(issue => issue.code === 'MAX_INKS'));
check('MAX_INKS blocks import', c.importBlockers({
  colors: [],
  format: 'core',
  cards: { 'E-1': 1, 'R-1': 1, 'S-1': 1 },
}).some(issue => issue.code === 'MAX_INKS'));

result = c.validateDeck({
  colors: ['Amber'],
  format: 'core',
  cards: { 'S-1': 1 },
});
check(
  'off-color issue carries card_id',
  result.issues.some(issue => issue.code === 'OFF_COLOR' && issue.card_id === 'S-1')
);
check(
  'off-color import is blocked',
  c.importBlockers({
    colors: ['Amber'],
    format: 'core',
    cards: { 'S-1': 1 },
  }).some(issue => issue.code === 'OFF_COLOR')
);

const addThirdInk = c.validForDeck(c.byId['S-1'], {
  colors: [],
  format: 'core',
  cards: { 'E-1': 1, 'R-1': 1 },
}, true);
check(
  'builder rejects a third ink through the same rules engine',
  addThirdInk.ok === false && addThirdInk.code === 'MAX_INKS'
);

result = c.validateDeck({
  colors: ['Amber'],
  format: 'core',
  cards: { 'LOR1-1': 3, 'LOR9-1': 2 },
});
check('copy limits aggregate reprints', result.issues.some(issue => issue.code === 'COPY_LIMIT'));

const importStart = html.indexOf('importDeck = ()=>');
const importEnd = html.indexOf('deleteDeck =', importStart);
const importBlock = html.indexOf('const blockers=this.importBlockers(deck)', importStart);
const importSave = html.indexOf('this.setState({decks:[...st.decks,deck]', importStart);
check(
  'import path blocks hard issues before persisting',
  importStart >= 0 && importBlock > importStart && importBlock < importSave && importSave < importEnd
);
check(
  'new deck color selection uses the format rule rather than a hard-coded two',
  html.includes('newDeckInks.slice(0,this.maxInks(st.newDeckFmt))') &&
    html.includes('const a=st.newDeckInks, max=this.maxInks(st.newDeckFmt)')
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
