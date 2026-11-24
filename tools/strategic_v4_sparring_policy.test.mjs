import assert from "node:assert/strict";
import test from "node:test";
import { captureLoss, reviewLoss, trial } from "./strategic_v4_sparring_lab.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const path = process.env.INKWELL_SPAR_ENGINE;
const skip = !path && "supply the real engine bundle";
const lady = "Lady - Elegant Spaniel", elinor = "Elinor - Renowned Diplomat", pegasus = "Pegasus - Gift for Hercules";
const chernabog = "Chernabog - Unnatural Force", guard = "Woolter & Jesse - Bellwether's Henchmen";
const circle = "Circle of Life", malicious = "Malicious, Mean, and Scary", phillip = "Prince Phillip - Vanquisher of Foes";
const max = "Max Goof - Rebellious Teen", chart = "Max Goof - Chart Topper";
const filler = "Mufasa - Ruler of Pride Rock";
function fixture({ lore = 19, own = 2, enemies = [[lady, true]], allies = [[elinor]], hand = [], ink = 0,
    discard = [], enemyDiscard = [], enemyInk = 0, hidden = [], top = filler } = {}) {
    let id = 1;
    const card = (fullName) => ({ fullName, i: id++ });
    const seat = (score, board, held, pile, resources, draw) => ({
        lore: score, turnsTaken: 3, play: board.map(([name, exerted = false, damage = 0, drying = false]) =>
            ({ card: card(name), exerted, damage, drying })),
        hand: held.map(card), discard: pile.map(card),
        inkwell: Array.from({ length: resources }, () => ({ card: card(lady), exerted: false })),
        deck: Array.from({ length: 10 }, () => card(draw)),
    });
    return { turn: { number: 8, player: 2 }, players: {
        1: seat(lore, enemies, hidden, enemyDiscard, enemyInk, top), 2: seat(own, allies, hand, discard, ink, filler),
    } };
}

const cases = {
    bodyguard: { enemies: [[guard, true], [lady, true]], hand: [chernabog], ink: 5 },
    combo19: { allies: [[filler]], enemies: [["Simba - Protective Cub"]], hand: [circle, malicious], discard: [phillip], ink: 3 },
    opposingLilo: { allies: [[filler]], enemies: [["Simba - Protective Cub"]], hand: [circle, malicious],
        discard: [phillip], ink: 3, enemyDiscard: ["Lilo - Escape Artist"], enemyInk: 2 },
    inkCombo: { allies: [[filler]], enemies: [["Simba - Protective Cub"]], hand: [circle, malicious, "Ursula - Vanessa"],
        discard: [phillip], ink: 2 },
    flowerCost: { allies: [[filler]], enemies: [["Simba - Protective Cub"], ["Magic Golden Flower"]],
        hand: [circle, malicious], discard: [phillip], ink: 3 },
    ownWin: { own: 19, hand: [chernabog], ink: 5 },
    evasiveStrength: { enemies: [[pegasus, true]], hand: ["Strength of a Raging Fire"], ink: 3 },
    ward: { enemies: [["Kuzco - Temperamental Emperor"]], hand: ["Strength of a Raging Fire"], ink: 3 },
    reserveSong: { allies: [["Hercules - Divine Hero"]], enemies: [["Lilo - Making a Wish", true]], hand: ["Strength of a Raging Fire"] },
    ownThreeQuests: { own: 17, allies: [[elinor], [lady], [lady]], hand: [chernabog], ink: 5 },
    ownTwoQuests: { own: 18, allies: [[elinor], [lady]], hand: [chernabog], ink: 5 },
    noDefense: { enemies: [[pegasus, true]] },
    preserve: { hand: [chernabog], ink: 5 },
    noThreat: { lore: 8, hand: [chernabog], ink: 5 },
    elinorMax: { lore: 18, enemies: [[elinor, true, 3], [max, false, 0, true]], allies: [] },
    chartTopper: { lore: 17, enemies: [["Meilin Lee - Losing Control", true, 2], ["Ursula - Vanessa", true],
        [chart, false, 0, true]], enemyDiscard: [chart], allies: [] },
    duels18: { lore: 15, enemies: [["Angela - Night Warrior", true], [elinor, true],
        ["Omnidroid - V.8", true, 1], ["Vixey - Forest Friend", true], [guard, true, 0, true]],
        allies: [["Ariel - Ethereal Voice"]], hand: [chernabog], ink: 6,
        enemyDiscard: ["Ursula - Deceiver", pegasus, "Tod - All Alone", "Omnidroid - V.8", pegasus, "Ursula - Deceiver"] },
};

const actions = (run) => run.executed[0].filter((s) => s.type === "Action").map((s) => s.action);
const compact = (run) => ({ winner: run.winner, lore: run.lore, ownLore: run.ownLore,
    actions: actions(run).map((a) => [a.type, (a.card ?? a.song ?? a.defender)?.fullName]),
    hand: run.hand.map((c) => c.fullName), nodes: run.searches.reduce((s, r) => s + r.nodes, 0),
    pass: run.searches[0]?.pass, selected: run.searches[0]?.chosen, ms: Math.round(run.ms) });

const expected = {
    bodyguard: [null, null], combo19: [1, null], opposingLilo: [1, null], flowerCost: [1, null], inkCombo: [1, null], evasiveStrength: [1, null],
    ownWin: [2, 2], ownTwoQuests: [2, 2], ownThreeQuests: [2, 2], noDefense: [1, 1], ward: [1, 1],
    preserve: [null, null], reserveSong: [null, null], noThreat: [null, null],
    elinorMax: [1, 1], chartTopper: [1, 1], duels18: [1, 1],
};
const seeds = [20261123, 17, 309];
for (const [name, spec] of Object.entries(cases)) {
    test("paired engine turns: " + name, { skip }, async () => {
        const pos = fixture(spec);
        for (const seed of seeds) {
            const before = await trial(pos, seed, false);
            const after = await trial(pos, seed, true);
            captureLoss(process.env.INKWELL_LOSS_DIR, name, pos, seed, after);
            assert.deepEqual([before.winner, after.winner], expected[name]);
            assert.ok(after.searches.every((s) => s.cutoff === null && s.nodes <= 768));
            if (["bodyguard", "combo19", "evasiveStrength", "reserveSong"].includes(name)) {
                assert.ok(after.verdicts.includes("public_defense"));
                assert.equal(after.lore, 19);
            }
            if (name === "combo19") {
                assert.deepEqual(actions(after).map((a) => a.type), ["Play", "Sing", "End Turn"]);
                assert.equal(actions(after)[0].card.fullName, malicious);
                assert.equal(actions(after)[1].song.fullName, circle);
                assert.equal(actions(after)[1].singers[0].fullName, filler);
                assert.ok(after.board.some((p) => p.card.fullName === phillip));
            }
            if (name === "opposingLilo") {
                assert.equal(after.verdicts[0], "public_defense");
                assert.equal(after.lore, 19);
            }
            if (name === "flowerCost") {
                assert.equal(after.verdicts[0], "public_defense");
                const controlled = await trial(pos, seed, false, {}, [["Play", malicious], ["Sing", circle], ["End Turn"]]);
                assert.equal(controlled.winner, null);
                assert.equal(controlled.lore, 19);
                assert.ok(controlled.board.some((p) => p.card.fullName === phillip));
            }
            if (name === "preserve") {
                assert.ok(after.hand.some((c) => c.fullName === chernabog));
                assert.ok(before.hand.every((c) => c.fullName !== chernabog));
            }
            if (name.startsWith("own")) {
                assert.ok(actions(after).every((a) => a.type === "Quest"));
                assert.ok(after.verdicts.includes("own_win"));
            }
            if (name === "noThreat" || name === "noDefense" || name === "ward") {
                assert.deepEqual(before.executed, after.executed);
                assert.equal(after.verdicts[0], name === "noThreat" ? "no_lethal_found" : "inconclusive");
            }
            if (seed === seeds[0]) console.log(name, JSON.stringify([compact(before), compact(after)]));
            if (process.env.INKWELL_BENCH_TRACE) console.log(JSON.stringify({ name, seed, position: pos, before, after }));
        }
    });
}

test("a challenge saves Strength with the same surviving board and score as singing it", { skip }, async () => {
    const position = fixture(cases.reserveSong);
    const saved = await trial(position, seeds[0], true);
    const sung = await trial(position, seeds[0], false, {}, [["Sing", "Strength of a Raging Fire"]]);
    assert.equal(actions(sung)[0].song.fullName, "Strength of a Raging Fire");
    assert.deepEqual([saved.board, saved.lore, saved.ownLore, saved.ink], [sung.board, sung.lore, sung.ownLore, sung.ink]);
    assert.ok(saved.hand.some((c) => c.fullName === "Strength of a Raging Fire"));
    assert.ok(sung.hand.every((c) => c.fullName !== "Strength of a Raging Fire"));
});

test("changing only private identities leaves the bot's complete turn and verdicts identical", { skip }, async () => {
    const a = await trial(fixture({ ...cases.combo19, hidden: [circle], top: malicious }), seeds[0], true);
    const b = await trial(fixture({ ...cases.combo19, hidden: [phillip], top: elinor }), seeds[0], true);
    assert.deepEqual(a.decisions, b.decisions);
    assert.deepEqual(a.verdicts, b.verdicts);
    assert.deepEqual(a.searches.map(({ms, ...rest}) => rest), b.searches.map(({ms, ...rest}) => rest));
});

for (const [reason, limits] of [["nodes", { maxNodes: 1 }], ["time", { maxMs: 0.000001 }]]) {
    test(reason + " cutoff returns the original policy and retains uncertainty", { skip }, async () => {
        const pos = fixture(cases.combo19), seed = seeds[0];
        const before = await trial(pos, seed, false);
        const after = await trial(pos, seed, true, limits);
        assert.deepEqual(after.executed, before.executed);
        assert.equal(after.winner, 1);
        assert.ok(after.verdicts.every((v) => v === "inconclusive"));
        assert.ok(after.searches.every((s) => s.cutoff === reason));
        console.log(reason, JSON.stringify([compact(before), compact(after)]));
    });
}

// Vary public lethal, number of targets and available activation independently.
test("defensive activations across generated Pegasus endgames", { skip }, async () => {
    for (const source of ["Robin Hood - Capable Fighter", "Steel Chromicon", "Ratigan's Marvelous Trap"]) {
        const trap = source === "Ratigan's Marvelous Trap";
        for (const lore of [18, 19]) for (const copies of [1, 2]) {
            const enemies = Array.from({ length: copies }, () => [pegasus]);
            const position = fixture({ lore, enemies, allies: [[source]] });
            const threatened = lore + copies >= 20;
            const canSave = trap || lore + copies - 1 < 20;
            for (const seed of seeds) {
                const before = await trial(position, seed, false);
                const after = await trial(position, seed, true);
                captureLoss(process.env.INKWELL_LOSS_DIR, source + "/" + lore + "/" + copies, position, seed, after);
                const label = JSON.stringify({ source, lore, copies, seed });
                if (process.env.INKWELL_ACTIVATION_TRACE === "1") {
                    console.log(JSON.stringify({ source, lore, copies, seed,
                        before: compact(before), after: compact(after),
                        executed: after.executed, verdicts: after.verdicts }));
                }
                const baselineLoss = threatened && (source !== "Steel Chromicon" || !canSave);
                assert.equal(before.winner, baselineLoss ? 1 : null, label);
                assert.equal(after.winner, threatened && !canSave ? 1 : null, label);
                assert.ok(after.searches.every((s) => !s.cutoff && s.nodes <= 768), label);
                if (!threatened) {
                    assert.deepEqual(after.executed, before.executed, label);
                    continue;
                }
                if (!canSave) {
                    assert.equal(after.verdicts[0], "inconclusive", label);
                    continue;
                }
                assert.equal(after.verdicts[0], "public_defense", label);
                const steps = after.executed[0];
                const activation = actions(after)[0];
                assert.equal(activation.type, "Activate", label);
                assert.equal(activation.ability.card.fullName, source, label);
                const payment = steps.find((s) => s.answer?.type === "Pay Cost").answer.payment;
                assert.deepEqual(payment, [{ type: trap ? "Banish" : "Exert", player: 2,
                    cards: [activation.ability.card] }], label);
                if (!trap) {
                    const target = steps.find((s) => s.answer?.type === "Choose Cards").answer.cards;
                    assert.equal(target.length, 1, label);
                    assert.ok(position.players[1].play.some((p) => p.card.i === target[0].i), label);
                }
                assert.equal(after.lore, lore + copies - (trap ? 2 : 1), label);
            }
        }
    }
});

test("restore a candidate loss and find a legal mixed-cost activation", { skip }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "inkwell-loss-"));
    try {
        const position = fixture({ allies: [["Merida's Bow"]], enemies: [[pegasus]], ink: 1 });
        const seed = 309;
        const observed = await trial(position, seed, true);
        assert.equal(observed.winner, 1);
        const name = "meridasBow19";
        const path = captureLoss(directory, name, position, seed, observed);
        captureLoss(process.env.INKWELL_LOSS_DIR, name, position, seed, observed);
        const review = await reviewLoss(path);
        const stale = captureLoss(directory, name, position, seed, { ...observed, executed: [] });
        const mismatch = await reviewLoss(stale);
        assert.equal(mismatch.status, "replay_mismatch");
        assert.equal(mismatch.branches.length, 0);
        assert.equal(review.reproduced, true);
        assert.equal(review.status, "survived_reply");
        assert.ok(review.branches.length <= review.limits.maxBranches);
        const witness = review.branches.at(-1).result;
        assert.equal(witness.lore, 19);
        const steps = witness.executed[0];
        assert.ok(steps.some((s) => s.action?.ability?.card.fullName === "Merida's Bow"));
        assert.ok(steps.some((s) => s.answer?.payment?.some((p) => p.type === "Banish" && p.cards[0].fullName === "Merida's Bow")));
        assert.ok(steps.some((s) => s.answer?.cards?.[0]?.fullName === pegasus));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

const angel = "Angel - Experiment 624";
const lilo = "Lilo - Making a Wish";
const aimCases = {
    aimPegasus: { target: pegasus },
    aimTwoDamage: { enemies: [[max]], target: max },
    aimSecondTarget: { lore: 18, enemies: [[pegasus], [lilo]], target: lilo },
    aimChallenge: { enemies: [[lilo, true]], action: "Challenge" },
    aimFreePing: { allies: [[angel], ["Robin Hood - Capable Fighter"]], action: "Activate" },
    aimSafe: { lore: 8, action: "Quest" },
    aimOwnWin: { own: 19, action: "Quest", winner: 2 },
    aimWard: { enemies: [["Kuzco - Temperamental Emperor"]], winner: 1 },
    aimTwoPegasus: { enemies: [[pegasus], [pegasus]], winner: 1 },
    aimInsufficient: { enemies: [["Meilin Lee - Losing Control"]], winner: 1 },
};

test("Good Aim is executed only when it buys a tested defense in these endgames", { skip }, async () => {
    for (const [name, { target, action, winner = null, ...spec }] of Object.entries(aimCases)) {
        const position = fixture({ allies: [[angel]], enemies: [[pegasus]], hand: [lady], ...spec });
        for (const seed of seeds) {
            const before = await trial(position, seed, false);
            const after = await trial(position, seed, true);
            captureLoss(process.env.INKWELL_LOSS_DIR, name, position, seed, after);
            assert.equal(after.winner, winner, name);
            const steps = after.executed[0];
            const payments = steps.flatMap((s) => s.answer?.payment ?? []).filter((p) => p.type === "Discard");
            assert.ok(after.searches.every((s) => s.cutoff === null && s.nodes <= 768), name);
            if (target) {
                assert.equal(before.winner, 1, name);
                assert.equal(after.verdicts[0], "public_defense", name);
                assert.equal(after.lore, 19, name);
                assert.equal(payments.length, 1, name);
                assert.deepEqual(payments[0].cards, [position.players[2].hand[0]], name);
                assert.ok(steps.some((s) => s.action?.ability?.card.fullName === angel), name);
                assert.ok(steps.some((s) => s.answer?.cards?.[0]?.fullName === target), name);
            } else {
                assert.equal(payments.length, 0, name);
                assert.ok(after.hand.some((c) => c.fullName === lady), name);
                if (action) assert.ok(steps.some((s) => s.action?.type === action), name);
                if (winner === 1) assert.equal(after.verdicts[0], "inconclusive", name);
            }
            if (process.env.INKWELL_BENCH_TRACE) console.log(JSON.stringify({ name, seed, position, before, after }));
        }
    }
});

test("Good Aim choices stay identical when opposing hidden identities change", { skip }, async () => {
    const position = { allies: [[angel]], enemies: [[pegasus]], hand: [lady] };
    const a = await trial(fixture({ ...position, hidden: [circle], top: malicious }), 309, true);
    const b = await trial(fixture({ ...position, hidden: [phillip], top: elinor }), 309, true);
    assert.deepEqual(a.decisions, b.decisions);
    assert.deepEqual(a.verdicts, b.verdicts);
    assert.deepEqual(a.executed[0], b.executed[0]);
});
