import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { analyzeImmediateDefense } from "./strategic_v4_sparring_defense.mjs";

const path = process.env.INKWELL_SPAR_ENGINE;
const engine = path && await import(pathToFileURL(resolve(path)));
const skip = engine ? false : "set INKWELL_SPAR_ENGINE to the bundled simulator";
const pegasus = "Pegasus - Gift for Hercules";
const lady = "Lady - Elegant Spaniel";
const elinor = "Elinor - Renowned Diplomat";
const lilo = "Lilo - Escape Artist";
const card = (fullName, i) => ({ fullName, i });
const piece = (fullName, i, exerted = false) => ({ card: card(fullName, i), exerted });
const position = ({ lore = 19, targets = [piece(lady, 2, true)] } = {}) => ({
    turn: { player: 2, number: 10 },
    players: {
        1: { lore, turnsTaken: 5, deck: 30, hand: 2, play: targets, discard: [], inkwell: [] },
        2: { lore: 6, turnsTaken: 4, deck: 30, hand: [], play: [piece(elinor, 1)], discard: [], inkwell: [] },
    },
});

test("engine confirms a challenge that prevents the public lethal", { skip }, () => {
    const state = position();
    const result = analyzeImmediateDefense(engine, state);
    assert.equal(result.baseline.status, "lethal");
    assert.equal(result.baseline.maxLore, 20);
    assert.deepEqual(result.baseline.quests, [card(lady, 2)]);
    assert.equal(result.selected?.action.type, "Challenge");
    assert.equal(result.selected.maxLore, 19);
    assert.deepEqual(state, position());
});

test("no modeled single action stops two public questers at 19 lore", { skip }, () => {
    const result = analyzeImmediateDefense(engine, position({ targets: [piece(lady, 2, true), piece(pegasus, 3)] }));
    assert.equal(result.baseline.status, "lethal");
    assert.equal(result.selected, null);
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every((entry) => entry.status === "lethal"));
});

test("nonlethal board does not force a defensive challenge", { skip }, () => {
    const result = analyzeImmediateDefense(engine, position({ lore: 18 }));
    assert.equal(result.baseline.status, "no_lethal_found");
    assert.equal(result.baseline.maxLore, 19);
    assert.equal(result.selected, null);
});

test("a budget cutoff and an unresolved Lilo trigger remain inconclusive", { skip }, () => {
    const low = analyzeImmediateDefense(engine, position(), { maxNodes: 1 });
    assert.equal(low.baseline.status, "inconclusive");
    assert.equal(low.nodes, 1);
    assert.equal(low.selected, null);
    const state = position();
    state.players[1].discard.push(card(lilo, 3));
    state.players[1].inkwell = [4, 5].map((i) => ({ card: card(pegasus, i), exerted: false }));
    const result = analyzeImmediateDefense(engine, state);
    assert.equal(result.baseline.status, "inconclusive");
    assert.equal(result.selected, null);
});

test("changing hidden names with fixed counts cannot affect the analysis", { skip }, () => {
    const masked = position();
    const known = position();
    known.players[1].hand = [card(lilo, 30), card(lilo, 31)];
    known.players[1].deck = Array.from({ length: 30 }, (_, i) => card(lilo, 32 + i));
    assert.deepEqual(analyzeImmediateDefense(engine, known), analyzeImmediateDefense(engine, masked));
});

test("an Evasive quester is not an available challenge target", { skip }, () => {
    const result = analyzeImmediateDefense(engine, position({ targets: [piece(pegasus, 2, true)] }));
    assert.equal(result.baseline.status, "lethal");
    assert.equal(result.selected, null);
    assert.ok(!result.candidates.some((entry) => entry.action.type === "Challenge"));
});

test("immediate victory takes precedence over a defensive challenge", { skip }, () => {
    const state = position();
    state.players[2].lore = 19;
    const result = analyzeImmediateDefense(engine, state);
    assert.equal(result.baseline.status, "lethal");
    assert.equal(result.selected?.action.type, "Quest");
    assert.equal(result.selected.status, "defender_wins");
});
