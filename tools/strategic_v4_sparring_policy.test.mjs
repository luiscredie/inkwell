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
        const observed = await trial(position, seed, true, { mixedActivation: false, planBoardRace: false });
        assert.equal(observed.winner, 1);
        const name = "meridasBow19";
        const path = captureLoss(directory, name, position, seed, observed, "v8-reference");
        const review = await reviewLoss(path);
        const stale = captureLoss(directory, name, position, seed, { ...observed, executed: [] }, "v8-reference");
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

test("discard choice converts a verified defense on the next own turn", { skip }, async () => {
    const knowledge = "Gathering Knowledge and Wisdom";
    const krei = "Alistair Krei - Ambitious Entrepreneur";
    const item = "Weight Set";
    const setups = [
        { name: "knowledge", reserve: knowledge, flip: false },
        { name: "knowledgeReverse", reserve: knowledge, flip: true },
        { name: "krei", reserve: krei, ink: 3, own: 17, items: [[item]] },
        { name: "kreiReverse", reserve: krei, ink: 3, own: 17, items: [[item]], flip: true },
        { name: "notEnoughInk", reserve: knowledge, ink: 1, control: true },
        { name: "noItem", reserve: krei, ink: 3, own: 17, control: true },
        { name: "nonForcedReply", reserve: knowledge, items: [["Magic Golden Flower"]], control: true },
        { name: "insufficientLore", reserve: knowledge, own: 15, control: true },
        { name: "ownWinNow", reserve: knowledge, own: 19, control: true },
        { name: "lethalRemains", reserve: knowledge, items: [[pegasus]], control: true },
    ];
    for (const { name, reserve, ink = 2, own = 16, items = [], flip, control } of setups) {
        const position = fixture({ own, ink, allies: [[angel]], enemies: [[pegasus], ...items],
            hand: flip ? [lady, reserve] : [reserve, lady] });
        for (const seed of seeds) {
            const before = await trial(position, seed, true, { planDiscardContinuation: false }, [], undefined, 3);
            const after = await trial(position, seed, true, { planPublicReplies: false }, [], undefined, 3);
            assert.ok(after.searches.every((s) => s.nodes <= 768), name);
            if (control) {
                assert.equal(after.searches[0].afterPublicPass, null, name);
                assert.deepEqual(after.executed, before.executed, name);
            } else {
                assert.equal(before.winner, null, name);
                assert.equal(after.winner, 2, name);
                assert.equal(after.ownLore, 20, name);
                assert.equal(after.executed.length, 3, name);
                assert.ok(after.searches[0].afterPublicPass.some((s) => s.action?.card?.fullName === reserve), name);
                const paid = (run) => run.executed[0].flatMap((s) => s.answer?.payment ?? [])
                    .find((p) => p.type === "Discard").cards[0].fullName;
                assert.equal(paid(before), reserve, name);
                assert.equal(paid(after), lady, name);
                assert.ok(after.executed[2].some((s) => s.action?.type === "Play" &&
                    s.action.card.fullName === reserve), name);
                assert.equal(after.lore, 19, name);
            }
            const current = await trial(position, seed, true, {planBoardRace: false}, [], undefined, 3);
            const latest = await trial(position, seed, true, {}, [], undefined, 3);
            if (current.winner === 2) assert.equal(latest.winner, 2, name);
            if (current.winner !== 1) assert.notEqual(latest.winner, 1, name);
            if (name === "nonForcedReply") {
                assert.equal(current.winner, 2);
            } else {
                assert.deepEqual(current.executed, after.executed, name);
            }
            if (process.env.INKWELL_RESERVE_TRACE === "1") {
                const side = (r) => ({ winner: r.winner, ownLore: r.ownLore, lore: r.lore, ms: r.ms, executed: r.executed });
                console.log(JSON.stringify({ reserveCase: name, seed, before: side(before), after: side(after),
                    witness: after.searches[0].afterPublicPass }));
            }
        }
    }
});

test("reserve planning honors the public view and preserves defense on a late cutoff", { skip }, async () => {
    const spec = { own: 16, ink: 2, allies: [[angel]], enemies: [[pegasus]],
        hand: ["Gathering Knowledge and Wisdom", lady] };
    const a = await trial(fixture({ ...spec, hidden: [lady], top: malicious }), 309, true);
    const b = await trial(fixture({ ...spec, hidden: [circle], top: lady }), 309, true);
    assert.deepEqual(a.decisions, b.decisions);
    assert.ok(a.searches[0].afterPublicPass);
    assert.deepEqual(a.searches[0].afterPublicPass, b.searches[0].afterPublicPass);
    const control = await trial(fixture(spec), 309, true, { planDiscardContinuation: false });
    const limited = await trial(fixture(spec), 309, true, { maxNodes: control.searches[0].nodes + 1 });
    assert.deepEqual(limited.executed, control.executed);
    assert.equal(limited.verdicts[0], "public_defense");
    assert.equal(limited.searches[0].afterPublicPass, null);
});

const flower = "Magic Golden Flower", trap = "Ratigan's Marvelous Trap";
const gathering = "Gathering Knowledge and Wisdom";
const activateFirst = (_view, menu) => menu.actions.find((entry) => entry.action.type === "Activate");
function replyFixture(item, damage = 0, extra = {}) {
    return fixture({ own: 16, ink: 2, allies: [[angel, false, damage]], enemies: [[pegasus], [item]],
        hand: [gathering, lady], ...extra });
}
function discardIn(turn) {
    return turn.flatMap((step) => step.answer?.payment ?? []).find((cost) => cost.type === "Discard")?.cards[0];
}

test("conversion against pass and active replies on the same public boards", { skip }, async () => {
    for (const [board, item, damage] of [["flower", flower, 0], ["wounded", flower, 1], ["trap", trap, 0]]) {
        for (const active of [false, true]) for (const seed of seeds) {
            const position = replyFixture(item, damage);
            const run = (planPublicReplies) => trial(position, seed, true, { planPublicReplies, planConditionalLore: false }, [], undefined,
                3, active ? activateFirst : undefined);
            const before = await run(false), after = await run(true);
            assert.equal(before.winner, null);
            for (const game of [before, after]) {
                assert.equal(game.executed.length, 3);
                assert.equal(game.executed[1].some((s) => s.action?.type === "Activate"), active);
                assert.ok(game.searches.every((s) => s.nodes <= 768));
            }
            const proof = after.searches[0].publicReplies;
            if (item === flower) {
                assert.equal(before.ownLore, 18);
                assert.equal(after.winner, 2);
                assert.equal(after.ownLore, 20);
                assert.equal(discardIn(before.executed[0]).fullName, gathering);
                assert.equal(discardIn(after.executed[0]).fullName, lady);
                assert.ok(after.executed[2].some((s) => s.action?.card?.fullName === gathering));
                assert.equal(proof.length, damage ? 3 : 2);
                assert.ok(proof.some((leaf) => leaf.reply.length === 1 && leaf.reply[0].action.type === "End Turn"));
                assert.deepEqual(proof.flatMap(({reply}) => reply.filter((s) => s.answer?.type === "Choose Amount")
                    .map((s) => s.answer.amount)).sort(), damage ? [0, 1] : [0]);
                assert.ok(proof.every((leaf) => leaf.continuation.some((s) => s.action?.card?.fullName === gathering)));
            } else {
                assert.equal(proof, null);
                assert.deepEqual(before.executed, after.executed);
                assert.equal(after.ownLore, active ? 16 : 18);
            }
            if (process.env.INKWELL_PUBLIC_REPLY_TRACE === "1") {
                const evidence = (g) => ({ winner: g.winner, ownLore: g.ownLore, executed: g.executed,
                    nodes: g.searches.map((s) => s.nodes), ms: g.ms });
                console.log(JSON.stringify({ replyCase: board, active, seed, before: evidence(before), after: evidence(after), proof }));
            }
        }
    }
});

test("the same reserved card loses its winning continuation when the Trap fires", { skip }, async () => {
    for (const seed of seeds) {
        async function counterfactual(active) {
            let paid = false;
            return trial(replyFixture(trap), seed, true, {}, [], (view, request, answer) => {
                if (view.turn.number !== 8) return answer;
                if (answer.answer?.payment?.[0]?.type === "Discard") {
                    const payment = request.payments.find((p) => p[0].cards[0].fullName === lady);
                    assert.ok(payment);
                    paid = true;
                    return { type: "Decision", answer: { type: "Pay Cost", pay: true, payment } };
                }
                if (paid && request.type === "Action") {
                    const end = request.actions.find((r) => r.action.type === "End Turn");
                    return { type: "Action", option: end.option };
                }
                return answer;
            }, 3, active ? activateFirst : undefined);
        }
        const pass = await counterfactual(false), defended = await counterfactual(true);
        assert.deepEqual(pass.executed[0], defended.executed[0]);
        assert.equal(discardIn(pass.executed[0]).fullName, lady);
        assert.equal(pass.winner, 2);
        assert.equal(defended.winner, null);
        assert.equal(defended.ownLore, 18);
        assert.ok(defended.executed[1].some((s) => s.action?.ability?.card.fullName === trap));
        assert.ok(defended.executed[2].some((s) => s.action?.card?.fullName === gathering));
        if (process.env.INKWELL_PUBLIC_REPLY_TRACE === "1") {
            console.log(JSON.stringify({ trapCounterfactual: seed,
                pass: { lore: pass.ownLore, executed: pass.executed },
                active: { lore: defended.ownLore, executed: defended.executed } }));
        }
    }
});

test("public branches ignore opposing hidden identities and keep the defense on cutoff", { skip }, async () => {
    const run = (extra, limits = {}) => trial(replyFixture(flower, 1, extra), 309, true, limits);
    const a = await run({ hidden: [circle], top: malicious }), b = await run({ hidden: [phillip], top: lady });
    assert.deepEqual(a.decisions, b.decisions);
    assert.deepEqual(a.searches[0].publicReplies, b.searches[0].publicReplies);
    assert.equal(a.searches[0].publicReplies.length, 3);
    const control = await run({}, { planDiscardContinuation: false });
    const limit = control.searches[0].nodes + 1;
    const cut = await run({}, { maxNodes: limit });
    assert.equal(cut.searches[0].nodes, limit);
    assert.equal(cut.searches[0].continuationCutoff, "budget");
    assert.equal(cut.searches[0].publicReplies, null);
    assert.equal(cut.verdicts[0], "public_defense");
    assert.deepEqual(cut.executed, control.executed);
});

const floorCases = [
    ["trap", trap, {}], ["shortInk", trap, {ink: 1}], ["shortLore", trap, {own: 15}], ["flower", flower, {}],
];

test("conditional conversion improves the worst measured reply without claiming a forced win", { skip }, async () => {
    for (const [name, item, extra] of floorCases) for (const active of [false, true]) for (const seed of seeds) {
        const position = replyFixture(item, 0, extra);
        const run = (planConditionalLore) => trial(position, seed, true, { planConditionalLore }, [], undefined,
            3, active ? activateFirst : undefined);
        const before = await run(false), after = await run(true);
        const report = after.searches[0].conditionalProgress;
        if (name === "trap") {
            assert.equal(discardIn(before.executed[0]).fullName, gathering);
            assert.equal(discardIn(after.executed[0]).fullName, lady);
            assert.ok(before.board.some((p) => p.card.fullName === lady));
            assert.ok(!after.board.some((p) => p.card.fullName === lady));
            assert.equal(before.ownLore, active ? 16 : 18);
            assert.equal(after.ownLore, active ? 18 : 20);
            assert.equal(before.winner, null);
            assert.equal(after.winner, active ? null : 2);
            assert.ok(after.executed[2].some((s) => s.action?.card?.fullName === gathering));
            assert.equal(after.searches[0].publicReplies, null);
            assert.equal(after.searches[0].afterPublicPass, null);
            assert.deepEqual([report.priorFloor, report.floor], [16, 18]);
            assert.equal(report.leaves.length, 2);
            for (const path of report.leaves) {
                const activation = path.reply.some((s) => s.action?.type === "Activate");
                assert.equal(path.won, !activation);
                assert.equal(path.lore, activation ? 18 : 20);
                if (activation) assert.equal(path.followingReply[0].action.type, "End Turn");
            }
        } else {
            assert.equal(report, null);
            assert.deepEqual(before.executed, after.executed, name);
            assert.equal(after.winner, name === "flower" ? 2 : null);
        }
        assert.ok(after.searches.every((s) => s.nodes <= 768));
        if (process.env.INKWELL_CONDITIONAL_TRACE === "1") {
            const evidence = (g) => ({ winner: g.winner, lore: g.ownLore, board: g.board, executed: g.executed,
                nodes: g.searches.map((s) => s.nodes), ms: g.ms });
            console.log(JSON.stringify({ floorCase: name, seed, active, before: evidence(before), after: evidence(after), report }));
        }
    }
});

test("conditional conversion stays qualified beyond the next own turn and against hidden reach", { skip }, async () => {
    for (const seed of seeds) {
        const long = [];
        for (const planConditionalLore of [false, true]) {
            const r = await trial(replyFixture(trap), seed, true, { planConditionalLore }, [], undefined, 7, activateFirst);
            assert.equal(r.winner, 2);
            assert.equal(r.executed.length, 7);
            long.push({ winner: r.winner, turns: r.executed.length, executed: r.executed });
        }
        const playKnownToOpponent = (_view, request) => request.actions.find(({action}) =>
            action.type === "Play" && action.card.fullName === gathering) ?? activateFirst(_view, request);
        const hidden = async (card, planConditionalLore) => trial(replyFixture(trap, 0, { hidden: [card], enemyInk: 2 }),
            seed, true, { planConditionalLore }, [], undefined, 3, playKnownToOpponent);
        const harmless = await hidden(filler, true), danger = await hidden(gathering, true), old = await hidden(gathering, false);
        assert.deepEqual(harmless.executed[0], danger.executed[0]);
        assert.deepEqual(harmless.searches[0].conditionalProgress, danger.searches[0].conditionalProgress);
        assert.equal(danger.searches[0].conditionalProgress.floor, 18);
        assert.equal(harmless.ownLore, 18);
        assert.equal(danger.winner, 1);
        assert.equal(old.winner, 1);
        assert.equal(danger.lore, 21);
        if (process.env.INKWELL_CONDITIONAL_TRACE === "1") console.log(JSON.stringify({
            floorControl: seed, long, hiddenReply: { winner: danger.winner, lore: danger.lore, executed: danger.executed } }));
    }
});

test("a partial floor comparison cannot displace the existing legal defense", { skip }, async () => {
    const position = replyFixture(trap);
    const previous = await trial(position, 17, true, { planConditionalLore: false });
    const limit = previous.searches[0].nodes + 1;
    const cut = await trial(position, 17, true, { maxNodes: limit });
    assert.equal(cut.searches[0].nodes, limit);
    assert.equal(cut.searches[0].conditionalProgress, null);
    assert.equal(cut.searches[0].continuationCutoff, "budget");
    assert.equal(cut.verdicts[0], "public_defense");
    assert.deepEqual(cut.executed, previous.executed);
});

test("a second public Trap keeps the conditional continuation unresolved", { skip }, async () => {
    const position = replyFixture(trap, 0, { enemies: [[pegasus], [trap], [trap]] });
    // Diagnostic budget isolates the follow-up from the normal 768-node cutoff.
    const run = (planConditionalLore) => trial(position, 17, true, { maxNodes: 4096, maxMs: 3000, planConditionalLore },
        [], undefined, 3, activateFirst);
    const old = await run(false), current = await run(true);
    assert.equal(current.searches[0].cutoff, null);
    assert.equal(current.searches[0].continuationCutoff, null);
    assert.equal(current.searches[0].conditionalProgress, null);
    assert.deepEqual(current.executed, old.executed);
    assert.equal(current.executed[1].filter((s) => s.action?.type === "Activate").length, 2);
    assert.equal(current.ownLore, 14);
});

const v8Limits = { mixedActivation: false, planBoardRace: false };
const bow = "Merida's Bow", staff = "Rafiki's Bakora Staff", flynn = "Flynn Rider - Charming Rogue";

function boardFixture(own, body = lady, extra = {}) {
    const p = fixture({ own, ink: 2, allies: [[angel]], enemies: [[pegasus]], hand: [gathering], ...extra });
    p.players[2].deck[0].fullName = body; // drawn before the decision, visible to its owner
    return p;
}
const runEvidence = (r) => ({ winner: r.winner, ownLore: r.ownLore, opposingLore: r.lore, executed: r.executed,
    board: r.board, nodes: r.searches.map((s) => s.nodes), ms: r.ms });

test("board development and immediate lore across the same endgames and seeds", { skip }, async () => {
    const variants = [
        ["lady13", 13, lady, 7, {}, null, 2, lady],
        ["lady15", 15, lady, 5, {}, null, 2, lady],
        ["reserve16", 16, lady, 3, {}, 2, 2], ["win17", 17, lady, 1, {}, 2, 2],
        ["flynn", 12, flynn, 7, {}, null, 2, flynn], ["lilo", 12, lilo, 7, {}, 2, 2],
        ["tooFar", 10, lady, 7, {}, null, null], ["noInk", 13, lady, 7, {ink: 0}, null, null],
        ["trap", 13, lady, 7, {enemies: [[pegasus], [trap]]}, null, null],
    ];
    for (const [name, own, body, horizon, extra, oldWinner, winner, play] of variants) for (const seed of seeds) {
        const p = boardFixture(own, body, extra);
        const run = (limits) => trial(p, seed, true, limits, [], undefined, horizon, activateFirst);
        const before = await run(v8Limits), after = await run({});
        assert.equal(before.winner, oldWinner, name);
        assert.equal(after.winner, winner, name);
        assert.ok(after.searches.every((s) => s.nodes <= 768), name);
        const proof = after.searches[0].boardRace;
        if (play) {
            assert.ok(after.executed[0].some((s) => s.action?.type === "Play" && s.action.card.fullName === play));
            assert.ok(after.executed.slice(1).flat().some((s) => s.action?.type === "Quest" && s.action.card.fullName === play), name);
            assert.equal(1 + 2 * proof.winOn, after.executed.length);
            assert.ok(proof.evaluated.some((r) => r.opening.some((s) => s.action?.card?.fullName === gathering)));
            if (name === "lady13") assert.equal(proof.evaluated.find((r) =>
                r.opening.some((s) => s.action?.card?.fullName === gathering)).winOn, null);
        } else {
            assert.equal(proof, null, name);
            assert.deepEqual(after.executed, before.executed, name);
        }
        if (process.env.INKWELL_NIGHT_TRACE === "1") console.log(JSON.stringify({ boardCase: name, seed, horizon,
            before: runEvidence(before), after: runEvidence(after), proof }));
    }
});

test("pay ink and banish the actual source in a lethal position", { skip }, async () => {
    const variants = [
        ["bow", bow, 1, [[pegasus]], true], ["staff", staff, 1, [[pegasus]], true],
        ["twoInk", bow, 2, [[pegasus]], true], ["woundedMax", bow, 1, [[max, false, 1]], true],
        ["noInk", bow, 0, [[pegasus]], false], ["ward", bow, 1, [["Kuzco - Temperamental Emperor"]], false],
        ["twoPegasus", bow, 1, [[pegasus], [pegasus]], false], ["healthyMax", bow, 1, [[max]], false],
    ];
    for (const [name, item, ink, enemies, saves] of variants) for (const seed of seeds) {
        const p = fixture({ allies: [[item]], enemies, ink });
        const before = await trial(p, seed, true, v8Limits), after = await trial(p, seed, true);
        assert.equal(before.winner, 1, name);
        assert.equal(after.winner, saves ? null : 1, name);
        if (saves) {
            const payment = after.executed[0].find((s) => s.answer?.payment?.some((part) => part.type === "Banish")).answer.payment;
            assert.deepEqual(payment.map((part) => part.type), ["Ink", "Banish"]);
            assert.equal(payment[0].cards.length, 1);
            assert.ok(p.players[2].inkwell.some((r) => r.card.i === payment[0].cards[0].i));
            assert.deepEqual(payment[1].cards, [p.players[2].play[0].card]);
            assert.deepEqual(after.executed[0].find((s) => s.answer?.type === "Choose Cards").answer.cards, [p.players[1].play[0].card]);
            assert.equal(after.lore, 19);
            assert.equal(after.verdicts[0], "public_defense");
        } else {
            captureLoss(process.env.INKWELL_LOSS_DIR, "mixedCost-" + name, p, seed, after);
            assert.equal(after.verdicts[0], "inconclusive");
        }
        if (process.env.INKWELL_NIGHT_TRACE === "1") console.log(JSON.stringify({ mixedCase: name, seed,
            before: runEvidence(before), after: runEvidence(after) }));
    }
});

test("a real Gathering line competes with developing Lady from the same decision", { skip }, async () => {
    for (const seed of seeds) {
        const p = boardFixture(13);
        const development = await trial(p, seed, true, {}, [], undefined, 7);
        let paid = false, played = false;
        const race = await trial(p, seed, true, v8Limits, [], (view, req, chosen) => {
            if (view.turn.number !== p.turn.number) return chosen;
            if (chosen.answer?.payment?.[0]?.type === "Discard") {
                const payment = req.payments.find((cost) => cost[0].cards[0].fullName === lady);
                assert.ok(payment);
                paid = true;
                return { type: "Decision", answer: { type: "Pay Cost", pay: true, payment } };
            }
            if (paid && !played && req.type === "Action") {
                const play = req.actions.find(({action}) => action.type === "Play" && action.card.fullName === gathering);
                assert.ok(play);
                played = true;
                return { type: "Action", option: play.option };
            }
            return chosen;
        }, 7);
        assert.ok(played);
        assert.equal(race.ownLore, 19);
        assert.equal(race.winner, null);
        assert.equal(development.winner, 2);
        assert.equal(development.ownLore, 20);
        if (process.env.INKWELL_NIGHT_TRACE === "1") console.log(JSON.stringify({ boardCounterfactual: seed,
            develop: runEvidence(development), gather: runEvidence(race) }));
    }
});

test("board plans preserve hidden information and the earlier defense on cutoff", { skip }, async () => {
    const setup = (hidden) => boardFixture(13, lady, {hidden: [hidden], enemyInk: 2});
    const reply = (_view, menu) => menu.actions.find(({action}) => action.type === "Play" && action.card.fullName === gathering);
    const safe = await trial(setup(filler), 309, true, {}, [], undefined, 7, reply);
    const danger = await trial(setup(gathering), 309, true, {}, [], undefined, 7, reply);
    assert.deepEqual(safe.executed[0], danger.executed[0]);
    assert.deepEqual(safe.searches[0].boardRace, danger.searches[0].boardRace);
    assert.equal(safe.winner, 2);
    assert.equal(danger.winner, 1);
    assert.equal(danger.lore, 21);
    const p = boardFixture(13);
    const before = await trial(p, 17, true, v8Limits);
    const maxNodes = before.searches[0].nodes + 1;
    const cut = await trial(p, 17, true, {maxNodes});
    assert.equal(cut.searches[0].nodes, maxNodes);
    assert.equal(cut.searches[0].boardRaceCutoff, "budget");
    assert.equal(cut.verdicts[0], "public_defense");
    assert.deepEqual(cut.executed, before.executed);
});

test("fixed additional positions retain earlier wins with different printed characters", { skip }, async () => {
    const bodies = ["Pinocchio - Star Attraction", "Minnie Mouse - Always Classy", "Simba - Protective Cub"];
    for (const [i, body] of bodies.entries()) for (const ink of [1, 2]) for (const own of [11, 12, 13, 14]) {
        const seed = 9000 + i * 100 + ink * 10 + own;
        const p = boardFixture(own, body, {ink});
        const before = await trial(p, seed, true, v8Limits, [], undefined, 7);
        const after = await trial(p, seed, true, {}, [], undefined, 7);
        if (before.winner === 2) {
            assert.equal(after.winner, 2);
            assert.ok(after.executed.length <= before.executed.length);
        }
        if (before.winner !== 1) assert.notEqual(after.winner, 1);
        assert.ok(after.searches.every((s) => s.nodes <= 768));
        if (process.env.INKWELL_NIGHT_TRACE === "1") console.log(JSON.stringify({
            boardGrid: body, own, ink, seed, before: runEvidence(before), after: runEvidence(after) }));
    }
});
