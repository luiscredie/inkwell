// "Analisar com IA" prompt (src/site/aiprompt.js) from a real duels.ink game (tools/fixtures/duels-game.json).
//   node --test tools/aiprompt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const here = new URL('.', import.meta.url);
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../src/site/aiprompt.js', here), 'utf8'), ctx);
const build = ctx.window.INKWELL_AI_PROMPT;
const cards = new Map(JSON.parse(fs.readFileSync(new URL('../site/data/cards.json', here), 'utf8')).cards.map((c) => [c.card_id, c]));
const game = () => JSON.parse(fs.readFileSync(new URL('./fixtures/duels-game.json', here), 'utf8'));

test('a win: asks why I won, names cards, keeps whose card is whose', () => {
  const p = build(game(), cards, { lang: 'pt' });
  assert.match(p, /Por que ganhei/);
  assert.doesNotMatch(p, /Por que perdi/);
  assert.match(p, /Resultado: VENCI por lore — Lore final: Eu 21 × 14 Oponente/);
  assert.match(p, /Quem começou: Oponente\. Turnos: 20/);
  assert.match(p, /## Meu deck \(60 cartas, Esmeralda\/Aço\)/);
  assert.match(p, /- 4x Vixey - Forest Friend/);
  // both decks run Angel - Experiment 624: the owner comes from the action, not from my list
  assert.match(p, /T20 Eu \(inkwell 5\): joga Strength of a Raging Fire; Strength of a Raging Fire causa 4 de dano em Angel - Experiment 624 \[Oponente\]; Angel - Experiment 624 \[Oponente\] é banido/);
  assert.match(p, /T5 Oponente \(inkwell 3\): .*White Rabbit - Late Again \[Eu\] é banido/);
  assert.match(p, /T19 Oponente \(inkwell 5\): passou sem ações → 19–14/);
  // opponent cards seen, including a song that was only sung
  assert.match(p, /## Oponente — Âmbar\/Aço[^]*- Akood Et Emuti/);
  // the real card text goes in, so the AI doesn't invent it
  assert.match(p, /- Elinor - Renowned Diplomat \(4⬡, Character, Emerald, não inkável, 3\/4, lore 1\) — COORDINATED EFFORTS: At the end of your turn/);
  assert.doesNotMatch(p, /LOR\d+-\d+/);   // no raw ids left
});

test('a loss asks why I lost; English works; games without turns give nothing', () => {
  const g = game(); g.result.winner = 'p2';
  const p = build(g, cards, { lang: 'pt' });
  assert.match(p, /Por que perdi/);
  assert.match(p, /Resultado: PERDI/);
  const en = build(game(), cards, { lang: 'en' });
  assert.match(en, /Why I won/);
  assert.match(en, /T19 Opponent \(inkwell 5\): passed with no actions/);
  assert.equal(build({ ...game(), turns: [] }, cards), '');
  assert.equal(build(null, cards), '');
});
