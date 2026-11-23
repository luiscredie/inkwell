// JSON Lines bridge for the public simulator-for-lorcana engine.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
    engine: { type: "string" }, human: { type: "string" }, bot: { type: "string" },
    seed: { type: "string", default: "1" }, turns: { type: "string" },
}});
const human = 1;
const bot = 2;
const input = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

function publicHumanState(view) {
    const state = structuredClone(view);
    const opponent = state.players[bot];
    if (opponent && Array.isArray(opponent.hand)) opponent.hand = opponent.hand.length;
    return state;
}

function resources(view) {
    const player = view.players[bot];
    if (!player) return null;
    return {
        available_ink: player.inkwell.filter(card => !card.exerted).length,
        ink_drops: player.inkDrops ?? 0,
        hand_size: Array.isArray(player.hand) ? player.hand.length : player.hand,
        exerted_in_play: player.play.filter(card => card.exerted).map(card => card.card),
    };
}

function engineAlternatives(request) {
    if (request.type === "Action") {
        return request.actions.map(({ option, action, cost }) => ({
            option, type: action.type, action, listed_cost: cost, source: "engine",
        }));
    }
    // Selection constraints are captured verbatim. A combination is not certified merely
    // because its individual cards appear in a Choose Cards or Pay Cost request.
    return [];
}

function inputRecord(request, answer, view) {
    const legal = engineAlternatives(request);
    if (answer.type === "Action" && !legal.some(action => action.option === answer.option)) {
        throw new Error("bot selected an action outside the engine's enumerated options");
    }
    return {
        source: "engine",
        type: answer.type === "Action" ? legal.find(item => item.option === answer.option).type : answer.answer.type,
        request, answer, legal_actions: legal, resources_before: resources(view), resources_after: null,
    };
}

function finalizeTurn(turn) {
    const actions = turn.bot_actions;
    const ink = actions.find(item => item.type === "Ink");
    const inkOffered = actions.some(item => item.legal_actions.some(action => action.type === "Ink"));
    const ended = actions.some(item => item.type === "End Turn");
    return {
        ...turn,
        ink_decision: ink ? "inked" : ended && inkOffered ? "declined_when_available"
            : ended ? "no_ink_option_offered" : "turn_ended_without_ink_action",
    };
}

async function main() {
    if (!values.engine || !values.human || !values.bot) throw new Error("--engine, --human and --bot are required");
    const engine = await import(pathToFileURL(resolve(values.engine)).href);
    for (const method of ["parseDeckList", "validateDeck", "getCard", "playGameAsync", "createBot"]) {
        if (typeof engine[method] !== "function") throw new Error(`engine bundle is missing ${method}`);
    }
    const loadDeck = (path) => {
        const { cards, problems } = engine.parseDeckList(readFileSync(path, "utf8"));
        if (problems.length) throw new Error(problems.join("\n"));
        const result = engine.validateDeck(cards.flatMap(row => Array(row.count).fill(engine.getCard(row.fullName))));
        if (!result.valid) throw new Error(result.errors.join("\n"));
        return cards;
    };
    const seed = Number(values.seed);
    const turns = values.turns === undefined ? undefined : Number(values.turns);
    if (!Number.isSafeInteger(seed) || (turns !== undefined && (!Number.isSafeInteger(turns) || turns < 1))) {
        throw new Error("seed must be an integer and turns a positive integer");
    }
    const humanDeck = loadDeck(values.human);
    const botDeck = loadDeck(values.bot);
    const controller = engine.createBot({ player: bot, deck: botDeck, settings: { seed, search: { nodes: 0, samples: 1 } } });
    const gameId = randomUUID();
    let turn = null;
    let humanEndSubmitted = false;
    let pendingBotInput = null;
    const flush = () => {
        if (!turn) return;
        send({ type: "review", turn: finalizeTurn(turn) });
        turn = null;
    };
    const record = await engine.playGameAsync([
        { player: human, deck: humanDeck, controller: {
            observe() {},
            async decide(state, request, error) {
                if (state.turn.player === human) flush();
                send({ type: "human_input", state: publicHumanState(state), request, error });
                const next = await input.next();
                if (next.done) throw new Error("human input ended");
                const answer = JSON.parse(next.value);
                if (state.turn.player === human && request.type === "Action") {
                    humanEndSubmitted = answer?.type === "Action" && request.actions.some(item =>
                        item.option === answer.option && item.action.type === "End Turn");
                }
                return answer;
            },
        }},
        { player: bot, deck: botDeck, controller: {
            observe(update) {
                controller.observe(update);
                if (pendingBotInput) pendingBotInput.resources_after = resources(update.state);
                pendingBotInput = null;
            },
            async decide(state, request, error) {
                if (error) throw new Error("the engine rejected a bot answer: " + error);
                if (state.turn.player === bot && humanEndSubmitted && !turn) {
                    const hand = state.players[bot]?.hand;
                    if (!Array.isArray(hand) || hand.some(card => !card?.fullName)) {
                        throw new Error("bot-side engine projection does not provide a complete hand");
                    }
                    turn = {
                        game_id: gameId, decision_id: `bot-turn-${state.turn.number}`,
                        human_turn_locked: true,
                        bot_hand: { source: "engine", cards: hand.map(card => card.fullName) },
                        bot_actions: [], alternative_actions: [],
                        context: {
                            human_lore: state.players[human]?.lore ?? null,
                            bot_lore: state.players[bot]?.lore ?? null,
                            phillip_in_discard: state.players[bot].discard.some(card =>
                                card.fullName === "Prince Phillip - Vanquisher of Foes"),
                            malicious_in_hand: hand.some(card => card.fullName === "Malicious, Mean, and Scary"),
                            sequence_legal_now: null,
                        },
                    };
                    humanEndSubmitted = false;
                    send({ type: "trainer_hand", decision_id: turn.decision_id, bot_hand: turn.bot_hand });
                }
                const answer = await controller.decide(state, request);
                if (turn && state.turn.player === bot) {
                    pendingBotInput = inputRecord(request, answer, state);
                    turn.bot_actions.push(pendingBotInput);
                    turn.alternative_actions.push(...pendingBotInput.legal_actions.map(action => ({
                        ...action, at_bot_input: turn.bot_actions.length, selected: action.option === answer.option,
                    })));
                }
                return answer;
            },
        }},
    ], { seed, first: human, retry: true, audit: true, turns, maxTurns: 300 });
    flush();
    send({ type: "finished", turns: record.turns.length, outcome: record.outcome ?? null });
}

try {
    await main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await input.return?.();
    process.stdin.destroy();
}
