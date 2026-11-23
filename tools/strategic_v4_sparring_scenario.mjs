// Small, scripted comparison in the same starting state using the real engine.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const circle = "Circle of Life";
const malicious = "Malicious, Mean, and Scary";
const phillip = "Prince Phillip - Vanquisher of Foes";
const don = "Don Karnage - Debonair Pirate";

const bundle = process.argv[2];
if (!bundle) throw new Error("Usage: node strategic_v4_sparring_scenario.mjs /path/to/dist/index.mjs");
const engine = await import(pathToFileURL(resolve(bundle)).href);
let serial = 0;
const card = (fullName) => {
    if (!engine.getCard(fullName)) throw new Error("Fixture card missing from catalog: " + fullName);
    return { fullName, i: ++serial };
};
const position = {
    turn: { number: 6, player: 2 },
    players: {
        1: { lore: 19, turnsTaken: 3, hand: [], discard: [], inkwell: [],
            deck: Array.from({ length: 5 }, () => card("Simba - Protective Cub")),
            play: [{ card: card("Simba - Protective Cub"), exerted: false, damage: 0 }] },
        2: { lore: 0, turnsTaken: 2, hand: [card(circle), card(malicious)],
            discard: [card(phillip), ...(engine.getCard(don) ? [card(don)] : [])],
            deck: Array.from({ length: 5 }, () => card("Ursula - Vanessa")),
            inkwell: Array.from({ length: 3 }, () => ({ card: card("Ursula - Vanessa"), exerted: false })),
            play: ["Mufasa - Ruler of Pride Rock"].map(name => ({
                card: card(name), exerted: false, damage: 0,
            })) },
    },
};

async function trial(cards, target) {
    const remaining = [...cards];
    const played = [], sung = [], selections = [], payments = [];
    let game;
    try {
        game = await engine.playGameAsync([
            { player: 1, deck: [], controller: {
                observe() {},
                decide(_state, request) {
                    if (request.type !== "Action") throw new Error("Unexpected human prompt: " + request.type);
                    const action = request.actions.find(item => item.action.type === "Quest")
                        ?? request.actions.find(item => item.action.type === "End Turn");
                    return { type: "Action", option: action.option };
                },
            }},
            { player: 2, deck: [], controller: {
                observe(update) {
                    for (const event of update.observations) {
                        if (event.type !== "Action") continue;
                        if (event.action.type === "Play") played.push(event.action.card.fullName);
                        if (event.action.type === "Sing") {
                            played.push(event.action.song.fullName);
                            sung.push({ song: event.action.song.fullName,
                                singers: event.action.singers.map(card => card.fullName) });
                        }
                    }
                },
                decide(_state, request) {
                    if (request.type === "Action") {
                        const desired = remaining[0];
                        const matches = request.actions.filter(item =>
                            (item.action.type === "Play" && item.action.card.fullName === desired)
                            || (item.action.type === "Sing" && item.action.song.fullName === desired));
                        const action = desired ? matches.find(item => item.cost.some(cost => cost.type === "Ink")) ?? matches[0]
                            : request.actions.find(item => item.action.type === "End Turn");
                        if (!action) throw new Error("Action not offered: " + desired);
                        if (desired) remaining.shift();
                        return { type: "Action", option: action.option };
                    }
                    if (request.type === "Pay Cost" && request.payments.length) {
                        const payment = request.payments[0];
                        payments.push(payment);
                        return { type: "Decision", answer: { type: "Pay Cost", pay: true, payment } };
                    }
                    if (request.type === "Choose Cards") {
                        const found = request.cards.find(card => card?.fullName === target);
                        if (!found) throw new Error("Target not offered: " + target);
                        selections.push(found.fullName);
                        return { type: "Decision", answer: { type: "Choose Cards", cards: [found] } };
                    }
                    throw new Error("Unexpected bot prompt: " + request.type);
                },
            }},
        ], { from: position, seed: 20261123, turns: 2, audit: true });
    } catch (error) {
        return { evidence: "inconclusive", error: error.message, played, sung, selections, payments };
    }
    return {
        evidence: "engine_simulated_controlled_fixture", played, sung, selections, payments,
        human_lore: game.final.players[1]?.lore ?? null,
        human_wins: game.outcome?.winners.includes(1) ?? false,
        outcome: game.outcome ?? null,
        remaining_human_characters: game.final.players[1]?.play.map(entry => entry.card.fullName) ?? [],
    };
}

const circleOnly = await trial([circle], phillip);
const setup = await trial([malicious, circle], phillip);
const directDon = engine.getCard(don) ? await trial([circle], don)
    : { evidence: "not_simulated", missing_catalog_card: don };
console.log(JSON.stringify({
    fixture_human_lore: 19,
    circle_phillip: circleOnly, malicious_circle_phillip: setup, circle_don_karnage: directDon,
    only_legal_defense: null, scope: "two scripted turns from one artificial state; no exhaustive defense search",
}, null, 2));
if (circleOnly.evidence !== "engine_simulated_controlled_fixture"
    || setup.evidence !== "engine_simulated_controlled_fixture"
    || !circleOnly.human_wins || circleOnly.outcome?.reason !== "Lore"
    || setup.human_wins || setup.human_lore !== 19 || setup.remaining_human_characters.length !== 0) {
    process.exitCode = 1;
}
