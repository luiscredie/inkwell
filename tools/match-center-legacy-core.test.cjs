const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "site", "match-center-engine.js"), "utf8");
const context = {console, setTimeout, clearTimeout, globalThis:null};
context.globalThis = context;
vm.runInNewContext(source, context, {filename:"match-center-engine.js"});
const core = context.INKWELL_MATCH_LEGACY;

const deck = {
  id: "deck-user-1",
  name: "Saved user deck",
  cards: {"LOR1-1": 4},
  notes: "Cross 10 lore by turn 6."
};
const cardsById = {
  "LOR1-1": {card_id:"LOR1-1", name_en:"Dale - Ready for His Shot"}
};
const raw = [
  "Player 1's starting hand: Dale - Ready for His Shot",
  "Player 2's starting hand: Woody",
  "--- Turn 1 ---",
  "Player 1's turn begins",
  "Player 1 played Dale - Ready for His Shot (cost 3)",
  "--- Turn 2 ---",
  "Player 2's turn begins",
  "--- Turn 3 ---",
  "Player 1's turn begins",
  "Player 1 quested with Dale - Ready for His Shot (+10 [LORE], 0 -> 10)",
  "Player 2 conceded",
  "Player 1 won"
].join("\n");

const resolved = core.resolveSavedDeck(deck, cardsById);
assert.equal(resolved.deckId, deck.id);
assert.equal(JSON.stringify(resolved.deckList), JSON.stringify(["Dale - Ready for His Shot"]));
assert.equal(resolved.strategy, deck.notes);

const match = core.createMatchFromSavedDeck({
  raw, deck, cardsById, existingMatches:[]
});
assert.equal(match.deck_id, deck.id);
assert.equal(match.result, "win");
assert.equal(match.raw_log, raw);
assert.equal(match.source, "imported_log");
assert.ok(match.rawHash);
assert.ok(match.planScore);
assert.ok(match.coach);
assert.ok(match.replay.events.length > 0);
assert.equal(match.replay.exact_board_state, false);

const duplicate = core.createMatchFromSavedDeck({
  raw, deck, cardsById, existingMatches:[match]
});
assert.equal(duplicate.isDuplicateOfId, match.id);

assert.throws(
  ()=>core.createMatchFromSavedDeck({
    raw,
    deck:{...deck, cards:{"MISSING":4}},
    cardsById,
    existingMatches:[]
  }),
  /unresolved card_id/
);

console.log("match-center-legacy-core: 14 assertions passed");
