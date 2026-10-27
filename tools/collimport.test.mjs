// "Importar coleção" (src/site/collimport.js): the file says what it is; no question about the app.
//   node --test tools/collimport.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const here = new URL('.', import.meta.url);
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../src/site/collimport.js', here), 'utf8'), ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));   // values from the vm's realm -> this one, for deepEqual
const parse = (...a) => plain(ctx.window.INKWELL_COLL_IMPORT.parse(...a));
const total = (rows) => plain(ctx.window.INKWELL_COLL_IMPORT.total(rows));
const cat = JSON.parse(fs.readFileSync(new URL('../site/data/cards.json', here), 'utf8'));
const cards = cat.cards.map((c) => ({ id: c.card_id, name: c.name_en, set: c.set_code, num: c.card_number }));
const sets = cat.sets;
const ids = (r) => total(r.rows).map((x) => `${x.id}:${x.n}/${x.f}`).sort();

test('Dreamborn CSV: set and card number, Normal/Foil, promo sets', () => {
  const csv = 'Set Number,Card Number,Variant,Count,Name,Color,Rarity\n1,41,Normal,3,Elsa - Snow Queen,Sapphire,Rare\n1,41,Foil,1,Elsa - Snow Queen,Sapphire,Rare\n11,86,Normal,2,Vixey - Forest Friend,Emerald,Uncommon\nP2,1,Foil,1,Prince John - Gold Lover,Amber,Promo\n99,1,Normal,1,Nobody,,\n';
  const r = parse(csv, 'collection.csv', cards, sets);
  assert.equal(r.format, 'dreamborn');
  assert.deepEqual(ids(r), ['DLPC1-1-P2:0/1', 'LOR1-41:3/1', 'LOR11-86:2/0']);
  assert.equal(r.rejects.length, 1);
  assert.equal(r.rejects[0].line, 6);
});

test('TCGplayer export: set by name, "12/204" numbers, Printing column', () => {
  const csv = 'Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID,SKU\n2,Rapunzel - Tower Defender,Rapunzel - Tower Defender,Attack of the Vine!,80/204,,Normal,Near Mint,English,Rare,1,2\n1,Strength of a Raging Fire,Strength of a Raging Fire,Rise of the Floodborn,201/204,,Cold Foil,Near Mint,English,Rare,3,4\n';
  const r = parse(csv, 'tcgplayer.csv', cards, sets);
  assert.equal(r.format, 'tcgplayer');
  assert.deepEqual(ids(r), ['LOR13-80:2/0', 'LOR2-201:0/1']);
  assert.equal(r.rejects.length, 0);
});

test('a Portuguese spreadsheet with semicolons (Excel), names only', () => {
  const csv = 'Carta;Quantidade;Acabamento\n"Broadway - Sturdy and Strong";4;Normal\nVixey - Forest Friend;1;Foil\nCarta inventada;2;\n';
  const r = parse(csv, 'minha-colecao.csv', cards, sets);
  assert.deepEqual(ids(r), ['LOR10-190:4/0', 'LOR11-86:0/1']);
  assert.deepEqual(r.rejects.map((x) => [x.line, x.reason]), [[4, 'no_match']]);
});

test("Inkwell's own CSV and JSON exports", () => {
  const csv = 'card_id,name,set,normal,foil\nLOR1-41,"Elsa - Snow Queen",LOR1,2,1\nLOR99-1,X,LOR99,1,0\n';
  const r = parse(csv, 'inkwell.csv', cards, sets);
  assert.equal(r.format, 'inkwell-csv');
  assert.deepEqual(ids(r), ['LOR1-41:2/1']);
  const j = parse(JSON.stringify({ collection: { 'LOR13-80': { n: 1, f: 2 }, nope: { n: 1 } } }), 'backup.json', cards, sets);
  assert.deepEqual(ids(j), ['LOR13-80:1/2']);
  assert.equal(j.rejects[0].reason, 'unknown_id');
});

test('a plain list, deck style, with foil and set/number hints; repeated lines add up', () => {
  const txt = '4 Broadway - Sturdy and Strong\n2x Vixey - Forest Friend\nRapunzel - Tower Defender x3\n1 Elsa - Snow Queen (foil)\nVixey - Forest Friend\n// comment\nStrength of a Raging Fire (2-201)\nNada disso\n';
  const r = parse(txt, 'lista.txt', cards, sets);
  assert.equal(r.format, 'list');
  assert.deepEqual(ids(r), ['LOR1-41:0/1', 'LOR10-190:4/0', 'LOR11-86:3/0', 'LOR13-80:3/0', 'LOR2-201:1/0']);
  assert.deepEqual(r.rejects.map((x) => x.raw), ['Nada disso']);
});
