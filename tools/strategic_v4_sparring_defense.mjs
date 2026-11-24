// Bounded, public-information pilot. Inputs must be main-phase positions in a two-player game.
import { createHash } from "node:crypto";

const hiddenName = "Sparring Hidden Card";
const hiddenCard = { type: "Item", fullName: hiddenName, names: [hiddenName], colors: [], cost: 99, inkwell: false, subtypes: [] };
const defenderActions = new Set(["Challenge", "Quest", "Play", "Sing", "Ink"]);

// Unsupported cost and target shapes leave the branch inconclusive.
function decisionAnswers(live, line, defender) {
    const request = live.request;
    const { type } = request;
    switch (type) {
        case "Optional":
        case "Optional Cost Rule":
            return [false, true].map((accept) => ({ type, accept }));
        case "Choose Cards": {
            if (request.max > 1 || request.total) return undefined;
            const eligible = request.cards.filter((card) => !request.required?.length ||
                request.required.some((required) => required.i === card.i));
            const choices = request.max === 0 ? [] : eligible.map((card) => [card]);
            if (request.min === 0) choices.push([]);
            return choices.map((cards) => ({ type, cards }));
        }
        case "Choose Amount":
            if (request.max - request.min > 12) return undefined;
            return Array.from({ length: request.max - request.min + 1 }, (_, i) => ({ type, amount: request.min + i }));
        case "Choose Player":
            return request.players.map((player) => ({ type, player }));
        case "Choose Mode":
            return request.options.map(({ mode }) => ({ type, mode }));
        case "Choose Trigger":
            return request.options.map(({ reference: trigger }) => ({ type, trigger }));
        case "Pay Cost": {
            // Only the activating instance can pay this single, public card cost.
            const [cost] = request.cost;
            if (request.player === defender && request.cost.length === 1 && cost.type === "Choose Cards" &&
                cost.count === 1 && cost.cost?.length === 1 && cost.cost[0].type === "Discard" &&
                cost.cost[0].cards === "Selected Cards" && Array.isArray(cost.from?.cards)) {
                // The resolved cost supplies the eligible instances. Simulated
                // unknown draws cannot be bound to a real card in the hand.
                const hand = live.position.players[defender].hand;
                const answers = cost.from.cards.filter((card) => card.fullName !== hiddenName &&
                    hand.some((held) => held.i === card.i && held.fullName === card.fullName))
                    .map((card) => ({ type, pay: true, payment: [{ type: "Discard", player: defender, cards: [card] }] }));
                return request.optional ? [{ type, pay: false }, ...answers] : answers;
            }
            if (request.cost.length === 1 && ["Banish", "Exert"].includes(cost.type) && cost.cards?.cards?.length === 1) {
                const step = line.at(-1);
                const action = step?.action;
                const card = action?.ability?.card ?? action?.card;
                if (action?.type !== "Activate" || cost.cards.cards[0].i !== card?.i ||
                    request.player !== action.player) return undefined;
                const payment = [{ type: cost.type, player: request.player, cards: [card] }];
                return [...(request.optional ? [{ type, pay: false }] : []), { type, pay: true, payment }];
            }
            if (typeof request.player !== "number" ||
                !request.cost.every((cost) => cost.type === "Ink" && Number.isSafeInteger(cost.amount) && cost.amount >= 0)) {
                return undefined;
            }
            const payer = live.position.players[request.player];
            const ready = payer.inkwell.filter((ink) => !ink.exerted).map((ink) => ink.card);
            let drops = payer.inkDrops ?? 0;
            const payment = request.cost.map(({ amount }) => {
                const inkDrops = Math.min(drops, amount);
                drops -= inkDrops;
                const cards = ready.splice(0, amount - inkDrops);
                return { type: "Ink", player: request.player, cards, ...(inkDrops ? { inkDrops } : {}) };
            });
            return [...(request.optional ? [{ type, pay: false }] : []), { type, pay: true, payment }];
        }
        default:
            return undefined;
    }
}

export function analyzeImmediateDefense(engine, view, { maxNodes = 128, maxActions = 2, maxMs = 1500, rootAllowed = () => true, allowInk = true, planDiscardContinuation = true, planPublicReplies = true } = {}) {
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 4096) {
        throw new RangeError("maxNodes must be between 1 and 4096");
    }
    if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 4) {
        throw new RangeError("maxActions must be between 1 and 4");
    }
    if (!Number.isFinite(maxMs) || maxMs <= 0 || maxMs > 30000) {
        throw new RangeError("maxMs must be positive and at most 30000");
    }
    const deadline = performance.now() + maxMs;
    const defender = view.turn.player;
    const seats = Object.keys(view.players).map(Number);
    if (seats.length !== 2 || !seats.includes(defender)) {
        throw new Error("a two-player main-phase position is required");
    }
    const attacker = seats.find((seat) => seat !== defender);
    const position = publicPosition(view, defender);
    const options = { card: (name) => name === hiddenName ? hiddenCard : engine.getCard(name) };
    let nodes = 0;
    let budgetExhausted = false;
    let cutoff = null;

    function descend(node, input) {
        if (node.line.length >= 48 || nodes >= maxNodes || performance.now() >= deadline) {
            cutoff ??= node.line.length >= 48 ? "steps" : nodes >= maxNodes ? "nodes" : "time";
            budgetExhausted = true;
            return undefined;
        }
        nodes++;
        // The engine can branch at an action menu. At a decision, rebuild from
        // the last such menu and replay only the accepted inputs since it.
        const live = node.live.branch() ?? node.anchor();
        const prefix = node.live.request.type === "Action" ? [] : node.prefix;
        for (const step of prefix) live.submit(step);
        live.submit(input);
        return {
            live,
            anchor: node.live.request.type === "Action" ? () => node.live.branch() : node.anchor,
            prefix: [...prefix, input],
            line: [...node.line, input],
            actors: [...node.actors, node.live.request.player ?? null],
        };
    }

    const lore = (live) => live.position?.players[attacker]?.lore ?? null;
    const incomplete = (node) => ({ status: "inconclusive", maxLore: lore(node.live), ownLore: node.live.position?.players[defender]?.lore ?? 0, quests: [], line: node.line, actors: node.actors });

    function terminal(node) {
        const { outcome } = node.live;
        if (!outcome) return undefined;
        if (outcome.winners.includes(defender)) return { ...incomplete(node), status: "defender_wins" };
        return { ...incomplete(node), status: outcome.reason === "Lore" ? "lethal" : "inconclusive" };
    }

    function decide(node, visit, actor, prefer) {
        const request = node.live.request;
        if (request.type === "Shuffle") {
            // Keep the next draw opaque in the public-board projection. This
            // ordering is a legal witness, not an estimate of future draws.
            const cards = [...request.cards.filter((card) => card.fullName === hiddenName),
                ...request.cards.filter((card) => card.fullName !== hiddenName)];
            const child = descend(node, { type: "Random", outcome: { type: "Shuffle", cards } });
            return child ? visit(child) : incomplete(node);
        }
        if (request.cards?.some((card) => card.fullName === hiddenName)) return incomplete(node);
        const answers = decisionAnswers(node.live, node.line, defender);
        if (!answers?.length || typeof request.player !== "number") return incomplete(node);
        let best;
        for (const answer of answers) {
            const child = descend(node, { type: "Decision", answer });
            const result = child ? visit(child) : incomplete(node);
            if (!best || prefer(result, best)) best = result;
            if (result.status === (actor === defender ? "defender_wins" : "lethal")) break;
            if (budgetExhausted) return incomplete(node);
        }
        return best;
    }

    const defensiveRank = { defender_wins: 3, no_lethal_found: 2, inconclusive: 1, lethal: 0 };
    const offensiveRank = { lethal: 3, inconclusive: 2, no_lethal_found: 1, defender_wins: 0 };
    const expense = (entry) => {
        const actions = entry.line.filter((step) => step.type === "Action");
        const spent = actions.filter(({ action }) => ["Play", "Sing", "Ink"].includes(action.type)).length;
        const paidCards = entry.line.filter(({ answer }) => answer?.payment?.some((part) =>
            ["Banish", "Discard"].includes(part.type) && part.player === defender)).length;
        return [spent + paidCards, actions.length];
    };
    const compareDefense = (a, b) => {
        const [cardsA, actionsA] = expense(a);
        const [cardsB, actionsB] = expense(b);
        return cardsA - cardsB || b.ownLore - a.ownLore || actionsA - actionsB || a.maxLore - b.maxLore;
    };
    const preferDefense = (a, b) => defensiveRank[a.status] > defensiveRank[b.status] ||
        (a.status === b.status && compareDefense(a, b) < 0);
    const preferAttack = (a, b) => offensiveRank[a.status] > offensiveRank[b.status] ||
        (a.status === b.status && a.maxLore !== null && b.maxLore !== null && a.maxLore > b.maxLore);

    function checkReply(node) {
        const outcome = terminal(node);
        if (outcome) return outcome;
        const request = node.live.request;
        if (!request) return incomplete(node);
        if (request.type !== "Action") {
            return decide(node, checkReply, request.player, request.player === defender ? preferDefense : preferAttack);
        }
        if (request.player !== attacker) return incomplete(node);
        const replyTypes = ["Quest", "End Turn", "Challenge", "Activate"];
        const responses = replyTypes.flatMap((type) => request.actions.filter((action) => action.type === type));
        let result = {
            ...incomplete(node),
            status: request.actions.every((action) => replyTypes.includes(action.type)) ? "no_lethal_found" : "inconclusive",
        };
        for (const action of responses) {
            const child = descend(node, { type: "Action", action });
            if (!child) return { ...result, status: "inconclusive" };
            let next;
            if (action.type !== "End Turn") {
                next = checkReply(child);
                if (action.type === "Quest") next = { ...next, quests: [action.card, ...next.quests] };
            } else {
                next = finishReply(child);
            }
            if (next.status === "lethal") return next;
            if (preferAttack(next, result)) result = next;
        }
        return result;
    }

    function finishReply(node) {
        const outcome = terminal(node);
        if (outcome) return outcome;
        const request = node.live.request;
        if (!request) return { ...incomplete(node), status: "no_lethal_found" };
        return decide(node, finishReply, request.player, request.player === defender ? preferDefense : preferAttack);
    }

    function endDefense(node) {
        const outcome = terminal(node);
        if (outcome) return outcome;
        if (node.live.request) {
            const actor = node.live.request.player;
            return decide(node, endDefense, actor, actor === defender ? preferDefense : preferAttack);
        }
        if (node.live.result?.turn.player !== attacker) return incomplete(node);
        const anchor = () => engine.startTurn(node.live.result, options);
        const live = anchor();
        const start = { live, anchor, prefix: [], line: [], actors: [] };
        // Resolve visible opening choices adversarially, including Lilo's
        // optional payment. Unsupported prompts still return inconclusive.
        const reply = checkReply(start);
        return { ...reply, status: reply.status === "defender_wins" ? "no_lethal_found" : reply.status,
            replyLine: reply.line, line: node.line, actors: node.actors };
    }

    function pass(node) {
        const end = node.live.request?.actions.find((action) => action.type === "End Turn");
        const child = end && descend(node, { type: "Action", action: end });
        return child ? endDefense(child) : incomplete(node);
    }

    function supportedDefense(action) {
        if (action.type === "Ink" && !allowInk) return false;
        if (action.type === "Activate") return Number.isInteger(action.ability?.i);
        return defenderActions.has(action.type);
    }

    function defend(node, remaining) {
        const outcome = terminal(node);
        if (outcome) return outcome;
        const request = node.live.request;
        if (!request) return incomplete(node);
        if (request.type !== "Action") {
            const actor = request.player;
            return decide(node, (child) => defend(child, remaining), actor, actor === defender ? preferDefense : preferAttack);
        }
        let best = pass(node);
        if (remaining === 0) return best;
        for (const action of request.actions) {
            if (!supportedDefense(action)) continue;
            const child = descend(node, { type: "Action", action });
            if (!child) break;
            const result = defend(child, remaining - 1);
            if (preferDefense(result, best)) best = result;
            if (best.status === "defender_wins" || budgetExhausted) break;
        }
        return best;
    }

    const anchor = () => engine.continueTurn(position, options);
    const root = { live: anchor(), anchor, prefix: [], line: [], actors: [] };
    if (root.live.request?.type !== "Action") throw new Error("a main-phase action menu is required");
    const candidates = [];
    // Reserve first access to the shared budget for a quest win before
    // exploring defenses. Try one engine-offered quest order, up to 12 quests.
    function questWin(node, depth) {
        const done = terminal(node);
        if (done) return done;
        const request = node.live.request;
        if (!request || budgetExhausted) return incomplete(node);
        if (request.type !== "Action") {
            const actor = request.player;
            return decide(node, (child) => questWin(child, depth), actor, actor === defender ? preferDefense : preferAttack);
        }
        if (!depth) return incomplete(node);
        const action = request.actions.find((a) => a.type === "Quest" && (node !== root || rootAllowed(a)));
        const child = action && descend(node, { type: "Action", action });
        return child ? questWin(child, depth - 1) : incomplete(node);
    }
    const win = questWin(root, 12);
    const baseline = pass(root);
    if (win.status === "defender_wins") {
        const selected = { action: win.line[0].action, ...win };
        return { baseline, candidates: [selected], selected, nodes, maxNodes, maxActions, budgetExhausted, cutoff };
    }
    if (baseline.status === "lethal") {
        const actions = root.live.request.actions.filter(rootAllowed);
        const byUrgency = (action) => action.type === "Quest" ? 0 : 1;
        for (const action of actions.sort((a, b) => byUrgency(a) - byUrgency(b))) {
            if (!supportedDefense(action)) continue;
            const child = descend(root, { type: "Action", action });
            if (!child) break;
            candidates.push({ action, ...defend(child, maxActions - 1) });
            if (candidates.at(-1).status === "defender_wins" || budgetExhausted) break;
        }
    }
    // Reopen only a proved defense. Change one payment and require the same
    // post-turn state (modulo the two cards exchanged between hand and discard).
    function refineDiscard(selected) {
        if (selected?.status !== "no_lethal_found" || selected.ownLore < 15 || budgetExhausted) return selected;
        const index = selected.line.findIndex((step) => step.answer?.payment?.[0]?.type === "Discard");
        if (index < 0 || selected.actors.some((actor) => actor !== defender)) return selected;
        const paid = selected.line[index].answer.payment[0].cards[0];
        const stop = Symbol("continuation budget");
        const ceiling = Math.min(nodes + (planPublicReplies ? 192 : 96), maxNodes);
        function spend() {
            if (nodes >= ceiling || performance.now() >= deadline) throw stop;
            nodes++;
        }
        function submit(live, step) {
            spend();
            live.submit(step);
        }
        function start(state) {
            spend();
            return engine.startTurn(state, options);
        }
        // At a leaf, witness a win with quests and an already known card.
        function ownContinuation(state) {
            const next = start(state);
            const steps = [];
            for (let count = 0; count < 4 && next.request?.type === "Action"; count++) {
                const quest = next.request.actions.find((a) => a.type === "Quest");
                if (!quest) break;
                const step = { type: "Action", action: quest };
                submit(next, step);
                steps.push(step);
                if (next.outcome?.winners.includes(defender)) return steps;
            }
            if (next.request?.type !== "Action" || next.request.player !== defender) return null;
            const plays = next.request.actions.filter((a) => a.type === "Play" &&
                position.players[defender].hand.some((c) => c.i === a.card.i));
            for (const action of plays.slice(0, 4)) {
                const branch = next.branch();
                const step = { type: "Action", action };
                const line = [...steps, step];
                submit(branch, step);
                // Only forced payments and triggers are covered in this pilot.
                for (let count = 0; count < 4 && branch.request?.player === defender &&
                    ["Pay Cost", "Choose Trigger"].includes(branch.request.type); count++) {
                    const answers = decisionAnswers(branch, line, defender);
                    if (answers?.length !== 1) break;
                    const decision = { type: "Decision", answer: answers[0] };
                    submit(branch, decision);
                    line.push(decision);
                }
                if (branch.outcome?.winners.includes(defender)) return line;
            }
            return null;
        }
        // Cover every offered reply in the public projection. A partial tree
        // cannot justify changing the discard. Unknown hand and deck stay masked.
        function witness(state) {
            const leaves = [];
            const root = start(state);
            if (root.request?.type !== "Action" || root.request.player !== attacker) return null;
            if (!planPublicReplies && (root.request.actions.length !== 1 ||
                root.request.actions[0].type !== "End Turn")) return null;
            function cover(live, path) {
                if (live.outcome || leaves.length >= 12) return false;
                const menu = live.request;
                if (!menu) {
                    if (live.result?.turn.player !== defender) return false;
                    const continuation = ownContinuation(live.result);
                    if (!continuation) return false;
                    leaves.push({ reply: path, continuation });
                    return true;
                }
                if ((!planPublicReplies && path.length) || path.length >= 8 || menu.player !== attacker) return false;
                let choices;
                if (menu.type === "Action") {
                    if (!menu.actions.every((action) => ["End Turn", "Activate", "Challenge", "Quest"].includes(action.type))) return false;
                    choices = menu.actions.map((action) => ({ type: "Action", action }));
                } else {
                    // Supports one public target, a bounded amount, or a self-cost. Leave
                    // composite or fungible payments unresolved in this proof.
                    const selfCost = menu.type === "Pay Cost" && menu.cost.length === 1 &&
                        ["Exert", "Banish"].includes(menu.cost[0].type);
                    const target = menu.type === "Choose Cards" && menu.min === 1 && menu.max === 1 &&
                        !menu.total && menu.cards.every((card) => seats.some((seat) =>
                            live.position.players[seat].play.some((entry) => entry.card.i === card.i)));
                    const amount = menu.type === "Choose Amount" && Number.isSafeInteger(menu.min) &&
                        Number.isSafeInteger(menu.max) && menu.max - menu.min < 8;
                    if (!selfCost && !target && !amount) return false;
                    choices = decisionAnswers(live, path, defender)?.map((answer) => ({ type: "Decision", answer }));
                }
                if (!choices?.length || choices.length > 8) return false;
                return choices.every((step) => {
                    let child = live;
                    if (choices.length > 1) {
                        child = live.branch();
                        if (!child) {
                            child = start(state);
                            for (const previous of path) submit(child, previous);
                        }
                    }
                    submit(child, step);
                    return cover(child, [...path, step]);
                });
            }
            return cover(root, []) ? leaves : null;
        }
        function endOfLine(line) {
            spend();
            const live = anchor();
            for (const step of line) submit(live, step);
            if (!live.outcome && !live.request && live.result?.turn.player === attacker) return live.result;
        }
        function equivalent(original, alternative, other) {
            const canonical = structuredClone(alternative);
            const seat = canonical.players[defender];
            if (!seat.hand.some((c) => c.i === paid.i) || !seat.discard.some((c) => c.i === other.i)) return false;
            seat.hand = seat.hand.map((c) => c.i === paid.i ? other : c);
            seat.discard = seat.discard.map((c) => c.i === other.i ? paid : c);
            // Hand ordering carries no strategic information. Discard order may.
            const ordered = structuredClone(original);
            for (const state of [ordered, canonical]) state.players[defender].hand.sort((a, b) => a.i - b.i);
            return JSON.stringify(ordered) === JSON.stringify(canonical);
        }
        try {
            const original = endOfLine(selected.line);
            if (!original || witness(original)) return selected;
            spend();
            const atPayment = anchor();
            for (const step of selected.line.slice(0, index)) submit(atPayment, step);
            const answers = decisionAnswers(atPayment, selected.line.slice(0, index), defender) ?? [];
            for (const answer of answers) {
                const other = answer.payment?.[0]?.cards?.[0];
                if (!other || other.i === paid.i) continue;
                const line = selected.line.with(index, { type: "Decision", answer });
                const state = endOfLine(line);
                if (!state || !equivalent(original, state, other)) continue;
                const publicReplies = witness(state);
                if (publicReplies) {
                    const pass = publicReplies.find(({ reply }) => reply.length === 1 && reply[0].action?.type === "End Turn");
                    return { ...selected, line, nextTurn: pass?.continuation, publicReplies };
                }
            }
        } catch (err) {
            // Auxiliary probes must never displace the original legal defense.
            if (err !== stop && err?.name !== "InvalidInput") {
                return { ...selected, continuationCutoff: "unsupported" };
            }
            if (err === stop) return { ...selected, continuationCutoff: "budget" };
        }
        return selected;
    }

    const best = candidates.find((entry) => entry.status === "defender_wins")
        ?? candidates.filter((entry) => entry.status === "no_lethal_found").sort(compareDefense)[0]
        ?? null;
    const selected = planDiscardContinuation ? refineDiscard(best) : best;
    return { baseline, candidates, selected, nodes, maxNodes, maxActions, budgetExhausted, cutoff };
}

function publicPosition(view, defender) {
    const position = structuredClone(view);
    let next = 1_000_000_000;
    const visible = new Set(Object.entries(position.players).flatMap(([seat, player]) => [
        ...player.discard.map((card) => card.i),
        ...player.play.flatMap(({ card, under = [] }) => [
            card.i, ...under.filter((entry) => !entry.faceDown).map((entry) => entry.card.i),
        ]),
        ...(Number(seat) === defender ? player.hand.map((card) => card.i) : []),
    ]));
    const count = (zone) => typeof zone === "number" ? zone : zone.length;
    const hidden = () => {
        while (visible.has(next)) next++;
        return { fullName: hiddenName, i: next++ };
    };
    const mask = (zone) => Array.from({ length: count(zone) }, hidden);
    for (const [seat, player] of Object.entries(position.players)) {
        player.deck = mask(player.deck);
        if (Number(seat) !== defender) player.hand = mask(player.hand);
        if (player.removed !== undefined) player.removed = mask(player.removed);
        player.inkwell = player.inkwell.map((ink) => ({ card: hidden(), exerted: ink.exerted }));
        for (const card of player.play) {
            if (card.under) card.under = card.under.map((entry) => entry.faceDown ? { ...entry, card: hidden() } : entry);
        }
    }
    return position;
}

// Canonical public state also guards continuations after an intervening draw or
// other difference between the modeled board and the live runner.
function projectionKey(view, player) {
    const state = publicPosition(view, player);
    const stable = (_, value) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value;
    return createHash("sha256").update(JSON.stringify(state, stable)).digest("hex");
}

export function ownPlan(engine, view, selected) {
    const player = view.turn.player;
    const live = engine.continueTurn(publicPosition(view, player), {
        card: (name) => name === hiddenName ? hiddenCard : engine.getCard(name),
    });
    const plan = [];
    for (const [index, step] of selected.line.entries()) {
        if (!live.request || live.request.player !== player || selected.actors[index] !== player) break;
        const trigger = step.answer?.type === "Choose Trigger"
            ? live.request.options.find((o) => JSON.stringify(o.reference) === JSON.stringify(step.answer.trigger)) : null;
        const entry = { step, position: projectionKey(live.position, player) };
        if (trigger) entry.trigger = { player: trigger.player, source: trigger.source, effect: trigger.effect };
        plan.push(entry);
        live.submit(step);
    }
    return plan;
}

export function matchesPlanPosition(view, entry) {
    return projectionKey(view, view.turn.player) === entry.position;
}
