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
  // Missão 2027, etapa 7: decisions by turn, decision vs result, what the log lacks, one practice goal
  for (const part of ['Mulligan e abertura', 'Sequência e tinta', 'Quest x desafio', 'Decisão x resultado', 'Informação que faltou', 'Próximo treino']) assert.match(p, new RegExp(part));
  assert.match(p, /## O que o registro não mostra\n- Minha mão e minhas compras: este registro não traz[^]*- Mulligan: este registro traz só a quantidade de cartas trocadas \(eu 2, oponente 4\), não quais\.\n- Do oponente, só as 11 cartas diferentes[^]*- Custo pago: não consta\./);
  assert.doesNotMatch(p, /duels\.ink n[ãa]o (registra|guarda|traz)/i);                 // what this log has, never a claim about duels.ink
  // Conselho 19/11: facts vs hypotheses, and no "unspent ink" from printed costs
  assert.match(p, /\[fato\] \(está no registro\) ou \[hipótese\]/);
  assert.match(p, /Não conclua que sobrou tinta somando custos impressos/);
  assert.doesNotMatch(p, /custo impresso jogado/);
  assert.match(p, /T6 Eu \(inkwell 3\): .* → 1–3$/m);
  assert.ok(p.indexOf('## O que o registro não mostra') < p.indexOf('## Turno a turno'));
});

test('a loss asks why I lost; English works; games without turns give nothing', () => {
  const g = game(); g.result.winner = 'p2';
  const p = build(g, cards, { lang: 'pt' });
  assert.match(p, /Por que perdi/);
  assert.match(p, /Resultado: PERDI/);
  const en = build(game(), cards, { lang: 'en' });
  assert.match(en, /Why I won/);
  assert.match(en, /T19 Opponent \(inkwell 5\): passed with no actions/);
  assert.match(en, /Decision vs result/);
  assert.match(en, /## What the log doesn't show/);
  assert.match(en, /\[fact\] \(it is in the log\) or \[hypothesis\]/);
  assert.match(en, /Don't conclude ink went unspent by adding printed costs/);
  assert.doesNotMatch(en, /printed cost played/);
  assert.equal(build({ ...game(), turns: [] }, cards), '');
  assert.equal(build(null, cards), '');
});
