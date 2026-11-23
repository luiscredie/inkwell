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

const chernabog = "Chernabog - Unnatural Force";
const bodyguard = "Woolter & Jesse - Bellwether's Henchmen";
const giveInk = (player, amount) => {
    player.inkwell = Array.from({ length: amount }, (_, i) => ({ card: card(pegasus, 100 + i), exerted: false }));
};
const darkDanceTargets = (line) => line.filter((step) => step.answer?.type === "Choose Cards")
    .flatMap((step) => step.answer.cards.map(({ fullName }) => fullName));

test("playing Chernabog to remove Bodyguard opens a second defensive action", { skip }, () => {
    const state = position({ targets: [piece(bodyguard, 2, true), piece(lady, 3, true)] });
    state.players[2].hand = [card(chernabog, 5)];
    giveInk(state.players[2], 5);
    assert.equal(analyzeImmediateDefense(engine, state, { maxActions: 1, maxNodes: 512 }).selected, null);
    const result = analyzeImmediateDefense(engine, state, { maxNodes: 512 });
    assert.equal(result.selected?.status, "no_lethal_found");
    assert.deepEqual(result.selected.line.filter((step) => step.type === "Action").map((step) => step.action.type),
        ["Play", "Challenge", "End Turn"]);
    assert.deepEqual(darkDanceTargets(result.selected.line), [bodyguard]);
});

test("the opponent can accept Dark Dance and quest with the returned character", { skip }, () => {
    const state = position({ targets: [piece(pegasus, 2, true)] });
    state.players[2].hand = [card(chernabog, 5)];
    giveInk(state.players[2], 5);
    const options = { maxNodes: 512 };
    const noReturn = analyzeImmediateDefense(engine, state, options);
    assert.deepEqual(darkDanceTargets(noReturn.selected.line), [pegasus]);
    state.players[1].discard = [card(lady, 3)];
    const withReturn = analyzeImmediateDefense(engine, state, options);
    assert.equal(withReturn.candidates.find((candidate) => candidate.action.type === "Play").status, "lethal");
    assert.equal(withReturn.selected, null);
});

test("Duels turn 18 reconstruction: neither the challenge nor Chernabog stops public lethal", { skip }, () => {
    const state = position({ lore: 15, targets: [
        piece("Angela - Night Warrior", 2, true),
        piece(elinor, 3, true),
        { ...piece("Omnidroid - V.8", 4, true), damage: 1 },
        piece("Vixey - Forest Friend", 5, true),
        { ...piece(bodyguard, 6, true), drying: true },
    ] });
    state.players[1].discard = [
        card("Ursula - Deceiver", 11), card(pegasus, 12), card("Tod - All Alone", 13),
        card("Omnidroid - V.8", 14), card(pegasus, 15), card("Ursula - Deceiver", 16),
    ];
    // Guitar and Boost were observed. The pilot tests only the public challenge and play branches.
    state.players[2].play = [piece("Ariel - Ethereal Voice", 7)];
    state.players[2].play[0].under = [{ card: card(pegasus, 18), faceDown: true }];
    state.players[2].hand = [card(chernabog, 9)];
    giveInk(state.players[2], 6);
    const result = analyzeImmediateDefense(engine, state, { maxNodes: 4096 });
    assert.equal(result.baseline.status, "lethal");
    assert.equal(result.selected, null);
    assert.equal(result.budgetExhausted, false);
    for (const type of ["Challenge", "Play"]) {
        const candidate = result.candidates.find((entry) => entry.action.type === type);
        assert.equal(candidate?.status, "lethal");
        assert.equal(candidate?.maxLore, 20);
    }
});

test("end-of-turn Elinor resolves a legal target and the last lore", { skip }, () => {
    const state = position({ lore: 16, targets: [
        piece(elinor, 2), piece(lady, 3), piece(lady, 4),
    ] });
    const result = analyzeImmediateDefense(engine, state, { maxNodes: 512 });
    assert.equal(result.baseline.status, "lethal");
    assert.equal(result.baseline.quests.length, 3);
    assert.equal(result.baseline.maxLore, 20);
    assert.ok(result.baseline.replyLine.some((step) => step.answer?.type === "Choose Cards"));
});

test("Duels first game: Elinor and the drying Max still win after the board clear", { skip }, () => {
    const state = position({ lore: 18, targets: [
        { ...piece(elinor, 2, true), damage: 3 },
        { ...piece("Max Goof - Rebellious Teen", 3), drying: true },
    ] });
    state.players[2].play = [];
    const result = analyzeImmediateDefense(engine, state);
    assert.equal(result.baseline.status, "lethal");
    assert.deepEqual(result.baseline.quests.map((entry) => entry.i), [2, 3]);
});

test("Duels second game: the surviving Chart Topper readies for lethal", { skip }, () => {
    const state = position({ lore: 17, targets: [
        { ...piece("Meilin Lee - Losing Control", 2, true), damage: 2 },
        piece("Ursula - Vanessa", 3, true),
        { ...piece("Max Goof - Chart Topper", 4), drying: true },
    ] });
    state.players[1].discard.push(card("Max Goof - Chart Topper", 5));
    state.players[2].play = [{ ...piece("Angela - Night Warrior", 1, true), damage: 2 }];
    const result = analyzeImmediateDefense(engine, state);
    assert.equal(result.baseline.status, "lethal");
    assert.ok(result.baseline.quests.some((entry) => entry.i === 4));
    assert.ok(!result.baseline.quests.some((entry) => entry.i === 5));
});
