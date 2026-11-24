// Bounded, public-information pilot. Inputs must be main-phase positions in a two-player game.
import { createHash } from "node:crypto";

const hiddenName = "Sparring Hidden Card";
const hiddenCard = { type: "Item", fullName: hiddenName, names: [hiddenName], colors: [], cost: 99, inkwell: false, subtypes: [] };
const defenderActions = new Set(["Challenge", "Quest", "Play", "Sing", "Ink", "Move"]);

// Unsupported cost and target shapes leave the branch inconclusive.
function decisionAnswers(live, line, defender, mixedActivation = false) {
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
            if (mixedActivation && request.player === defender && request.cost.length === 2 &&
                cost.type === "Ink" && Number.isSafeInteger(cost.amount) && cost.amount > 0) {
                const sacrifice = request.cost[1];
                const action = line.at(-1)?.action;
                const source = action?.ability?.card;
                if (action?.type !== "Activate" || action.player !== defender || !source ||
                    sacrifice.type !== "Banish" || sacrifice.cards?.cards?.length !== 1 ||
                    sacrifice.cards.cards[0].i !== source.i) return undefined;
                const payer = live.position.players[defender];
                const inkDrops = Math.min(payer.inkDrops ?? 0, cost.amount);
                const cards = payer.inkwell.filter((entry) => !entry.exerted)
                    .slice(0, cost.amount - inkDrops).map((entry) => entry.card);
                if (cards.length + inkDrops !== cost.amount) return undefined;
                const payment = [
                    { type: "Ink", player: defender, cards, ...(inkDrops ? {inkDrops} : {}) },
                    { type: "Banish", player: defender, cards: [source] },
                ];
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

export function analyzeImmediateDefense(engine, view, { maxNodes = 128, maxActions = 2, maxMs = 1500, rootAllowed = () => true, allowInk = true, planDiscardContinuation = true, planPublicReplies = true, planConditionalLore = true, planBoardRace = planConditionalLore && planPublicReplies && planDiscardContinuation, mixedActivation = true, preventNextCycle = true, originalChoice } = {}) {
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
        const answers = decisionAnswers(node.live, node.line, defender, mixedActivation);
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
    let win = questWin(root, 12);
    // Only promote Boost if the public projection actually reaches an own win
    // this turn. Keep the ordinary defensive search's budget for other lines.
    const boostCeiling = Math.min(maxNodes - 1, nodes + 32);
    function finishBoost(node, remaining) {
        if (node.live.outcome?.reason === "Lore" && node.live.outcome.winners.includes(defender)) return terminal(node);
        const menu = node.live.request;
        if (!menu || menu.player !== defender || nodes >= boostCeiling || budgetExhausted) return;
        if (menu.type === "Pay Cost") {
            const payments = decisionAnswers(node.live, node.line, defender);
            const pay = payments?.find(answer => answer.pay);
            const child = pay && descend(node, {type:"Decision", answer:pay});
            return child && finishBoost(child, remaining);
        }
        if (menu.type !== "Action" || !remaining) return;
        for (const action of menu.actions) {
            if (nodes >= boostCeiling || budgetExhausted) break;
            if (action.type !== "Quest" && !grantedLore(node.live, action)) continue;
            const child = descend(node, {type:"Action", action});
            const result = child && finishBoost(child, remaining - 1);
            if (result) return result;
        }
    }
    if (win.status !== "defender_wins") {
        for (const action of root.live.request.actions) {
            if (nodes >= boostCeiling || budgetExhausted) break;
            if (action.type !== "Boost" || !Number.isInteger(action.ability) || !rootAllowed(action)) continue;
            const child = descend(root, {type:"Action", action});
            const result = child && finishBoost(child, maxActions - 1);
            if (result) { win = result; break; }
        }
    }
    const baseline = pass(root);
    if (win.status === "defender_wins") {
        const selected = { action: win.line[0].action, ...win };
        return { baseline, candidates: [selected], selected, nodes, maxNodes, maxActions, budgetExhausted, cutoff };
    }
    if (baseline.status === "lethal") {
        const actions = root.live.request.actions.filter(rootAllowed);
        // Pure quest wins were tested above. Moving first can preserve a
        // uniquely bindable payment before a quest grants another move route.
        const byUrgency = (action) => action.type === "Move" ? -1 : action.type === "Quest" ? 0 : 1;
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
        let ceiling = Math.min(nodes + (planPublicReplies ? 192 : 96), maxNodes);
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
        function win(live, continuation) {
            const lore = live.position.players[defender].lore;
            return { won: true, lore, continuation };
        }
        // Score only a resolved end of turn. For a new nonwinning line, also
        // require a quiet following public turn so we do not walk into lethal.
        function completedScore(live, steps, guardReply) {
            if (live.request?.type !== "Action" || live.request.player !== defender) return null;
            const end = live.request.actions.find((action) => action.type === "End Turn");
            if (!end) return null;
            const branch = live.branch();
            const step = { type: "Action", action: end };
            submit(branch, step);
            const continuation = [...steps, step];
            if (branch.outcome?.winners.includes(defender)) return win(branch, continuation);
            if (branch.outcome || branch.request || branch.result?.turn.player !== attacker) return null;
            const lore = branch.result.players[defender].lore;
            if (guardReply) {
                const other = start(branch.result);
                if (other.request?.type !== "Action" || other.request.player !== attacker ||
                    other.request.actions.length !== 1 || other.request.actions[0].type !== "End Turn") return null;
                const pass = { type: "Action", action: other.request.actions[0] };
                submit(other, pass);
                if (other.outcome || other.request || other.result?.turn.player !== defender ||
                    other.result.players[defender].lore < lore) return null;
                return { won: false, lore, continuation, followingReply: [pass] };
            }
            return { won: false, lore, continuation };
        }
        // Quests plus at most one play from the original hand. Grades apply
        // to these executed continuations, not to every possible own policy.
        function ownContinuation(state, grade, guardReply) {
            const next = start(state);
            const steps = [];
            for (let count = 0; count < 4 && next.request?.type === "Action"; count++) {
                const quest = next.request.actions.find((a) => a.type === "Quest");
                if (!quest) break;
                const step = { type: "Action", action: quest };
                submit(next, step);
                steps.push(step);
                if (next.outcome?.winners.includes(defender)) return win(next, steps);
            }
            if (next.request?.type !== "Action" || next.request.player !== defender) return null;
            let best = grade ? completedScore(next, steps, guardReply) : null;
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
                if (branch.outcome?.winners.includes(defender)) return win(branch, line);
                if (grade) {
                    const score = completedScore(branch, line, guardReply);
                    if (score?.won) return score;
                    if (score && (!best || !best.won && score.lore > best.lore)) best = score;
                }
            }
            return best;
        }
        // Cover every offered reply in the public projection. A partial tree
        // cannot justify changing the discard. Unknown hand and deck stay masked.
        function witness(state, grade = false, guardReply = false) {
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
                    const score = ownContinuation(live.result, grade, guardReply);
                    if (!score) return false;
                    leaves.push(grade ? { reply: path, ...score } : { reply: path, continuation: score.continuation });
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
            const payments = [];
            for (const answer of answers) {
                const other = answer.payment?.[0]?.cards?.[0];
                if (!other || other.i === paid.i) continue;
                const line = selected.line.with(index, { type: "Decision", answer });
                const state = endOfLine(line);
                if (!state || !equivalent(original, state, other)) continue;
                payments.push({ line, state });
                const publicReplies = witness(state);
                if (publicReplies) {
                    const pass = publicReplies.find(({ reply }) => reply.length === 1 && reply[0].action?.type === "End Turn");
                    return { ...selected, line, nextTurn: pass?.continuation, publicReplies };
                }
            }
            if (!planConditionalLore || !planPublicReplies || !payments.length) return selected;
            // This second pass cannot consume the budget of an existing V7 win.
            ceiling = Math.min(maxNodes, nodes + 128);
            const baseline = witness(original, true);
            if (!baseline || baseline.length < 2) return selected;
            const byReply = new Map(baseline.map((leaf) => [JSON.stringify(leaf.reply), leaf]));
            const priorFloor = Math.min(...baseline.map((leaf) => leaf.lore));
            let bestFloor = priorFloor;
            let choice = selected;
            for (const { line, state } of payments) {
                const leaves = witness(state, true, true);
                if (!leaves || leaves.length !== byReply.size || !leaves.some((leaf) => leaf.won)) continue;
                const keys = new Set(leaves.map((leaf) => JSON.stringify(leaf.reply)));
                if (keys.size !== byReply.size || !leaves.every((leaf) => {
                    const prior = byReply.get(JSON.stringify(leaf.reply));
                    return prior && (!prior.won || leaf.won) && leaf.lore >= prior.lore;
                })) continue;
                const floor = Math.min(...leaves.map((leaf) => leaf.lore));
                if (floor <= bestFloor) continue;
                bestFloor = floor;
                choice = { ...selected, line, conditionalProgress: { priorFloor, floor, baseline, leaves } };
            }
            return choice;
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
    let selected = planDiscardContinuation ? refineDiscard(best) : best;
    if (planBoardRace && selected && !budgetExhausted) {
        const ceiling = Math.min(maxNodes, nodes + 176);
        const stop = Symbol("board race budget");
        try {
            selected = planBoardDevelopment(selected, { anchor, start: (state) => engine.startTurn(state, options),
                defender, attacker, held: position.players[defender].hand,
                spend() {
                    if (nodes >= ceiling || performance.now() >= deadline) throw stop;
                    nodes++;
                } });
        } catch (err) {
            selected = { ...selected, boardRaceCutoff: err === stop ? "budget" : "unsupported" };
        }
    }
    let preventionCutoff = null;
    if (!selected && preventNextCycle && originalChoice && baseline.status === "no_lethal_found" && !budgetExhausted) {
        const ceiling = Math.min(maxNodes, nodes + 384);
        const stop = Symbol("preventive search budget");
        try {
            selected = preventiveActivation(root, originalChoice, { defender, attacker, allowed: rootAllowed,
                start: (state) => engine.startTurn(state, options),
                spend() {
                    if (nodes >= ceiling || performance.now() >= deadline) throw stop;
                    nodes++;
                } });
        } catch (err) {
            preventionCutoff = err === stop ? "budget" : "unsupported";
        }
    }
    return { baseline, candidates, selected, preventionCutoff, nodes, maxNodes, maxActions, budgetExhausted, cutoff };
}

// Four half-turns, starting in the defender's current main phase. Refute the
// original choice even after allowing subsequent defensive choices, then seek
// a line that survives every covered public reply. Unsupported branches carry
// "unknown" through the quantifiers. Traces are examples, not the whole tree.
function preventiveActivation(root, original, { defender, attacker, start, spend, allowed }) {
    const actions = root.live.request.actions;
    const attempts = actions.filter((a) => a.type === "Activate" && Number.isInteger(a.ability?.i) && allowed(a));
    const initial = actions.find(original);
    if (!attempts.length || !["End Turn", "Quest"].includes(initial?.type) ||
        actions.some((a) => ["Play", "Sing", "Shift"].includes(a.type))) return null;
    const unknown = { status: "unknown", trace: [] };
    const safe = { status: "safe", trace: [] }, loss = { status: "loss", trace: [] };
    function submit(live, step) {
        spend();
        live.submit(step);
    }
    function open(state) {
        spend();
        return start(state);
    }
    // Cheap trigger: execute two quest-first replies separated by a pass. The
    // game tree below separately tests what happens if the defender fights back.
    function looming() {
        let live = root.live.branch();
        for (let phase = 0; phase < 4; phase++) {
            const actor = phase % 2 ? attacker : defender;
            for (let i = 0; ; i++) {
                const menu = live.request;
                if (i >= 8 || menu?.type !== "Action" || menu.player !== actor) return false;
                const action = (actor === attacker && menu.actions.find((a) => a.type === "Quest")) ||
                    menu.actions.find((a) => a.type === "End Turn");
                if (!action) return false;
                submit(live, { type: "Action", action });
                if (live.outcome) return phase === 3 && live.outcome.reason === "Lore" && live.outcome.winners.includes(attacker);
                if (action.type === "End Turn") break;
            }
            if (live.request || !live.result) return false;
            if (phase !== 3) live = open(live.result);
        }
        return false;
    }
    if (!looming()) return null;
    let leaves = 0;
    function visit(node, phase, depth) {
        const live = node.live;
        if (live.outcome) {
            leaves++;
            return live.outcome.winners.includes(defender) ? safe : live.outcome.winners.includes(attacker) ? loss : unknown;
        }
        const menu = live.request;
        if (!menu) {
            const next = phase % 2 ? defender : attacker;
            if (live.result?.turn.player !== next) return unknown;
            if (phase === 3) { leaves++; return safe; }
            const anchor = () => open(live.result);
            return visit({live: anchor(), anchor, prefix: []}, phase + 1, depth);
        }
        if (depth >= 32 || ![defender, attacker].includes(menu.player)) return unknown;
        let steps, incomplete = false;
        if (menu.type === "Action") {
            if (menu.player !== (phase % 2 ? attacker : defender)) return unknown;
            const order = menu.player === defender ? ["Activate", "Challenge", "Quest", "End Turn"]
                : ["Quest", "Challenge", "Activate", "End Turn"];
            const moves = order.flatMap((type) => menu.actions.filter((a) => a.type === type));
            incomplete = moves.length !== menu.actions.length;
            steps = moves.map((action) => ({type: "Action", action}));
        } else {
            const target = menu.type === "Choose Cards" && menu.min === 1 && menu.max === 1 && !menu.total &&
                menu.cards.every((c) => [defender, attacker].some((p) => live.position.players[p].play.some((t) => t.card.i === c.i)));
            const selfCost = menu.type === "Pay Cost" && menu.cost.length === 1 && ["Banish", "Exert"].includes(menu.cost[0].type);
            const answers = decisionAnswers(live, node.prefix, defender);
            const discard = menu.player === defender && menu.type === "Pay Cost" &&
                menu.cost.length === 1 && menu.cost[0].type === "Choose Cards" &&
                answers?.some((a) => a.payment?.[0]?.type === "Discard");
            if (!target && !selfCost && !discard) return unknown;
            steps = answers?.map((answer) => ({type: "Decision", answer}));
            // The unknown future draw is never used to establish a safe plan.
            // While refuting a choice, include its legal generic discard too.
            if (discard) {
                for (const card of menu.cost[0].from.cards.filter((c) => c.fullName === hiddenName)) {
                    steps.push({type: "Decision", answer: {type: "Pay Cost", pay: true,
                        payment: [{type: "Discard", player: defender, cards: [card]}]}});
                }
            }
        }
        if (!steps?.length || steps.length > 12) return unknown;
        const desired = menu.player === defender ? "safe" : "loss";
        let representative;
        for (const step of steps) {
            const branch = descend(node, step, phase, depth);
            const opaque = step.answer?.payment?.some((p) => p.cards?.some((c) => c.fullName === hiddenName));
            if (opaque && branch.status === "safe") { incomplete = true; continue; }
            if (branch.status === desired) return branch;
            if (branch.status === "unknown") incomplete = true;
            else representative ??= branch;
        }
        return incomplete ? unknown : representative;
    }
    function descend(node, step, phase, depth) {
        const atAction = node.live.request.type === "Action";
        const anchor = atAction ? () => node.live.branch() : node.anchor;
        const prefix = atAction ? [] : node.prefix;
        const live = anchor();
        for (const previous of prefix) submit(live, previous);
        submit(live, step);
        const child = visit({live, anchor, prefix: [...prefix, step]}, phase, depth + 1);
        return child.status === "unknown" ? child : {
            status: child.status, trace: [{ phase, player: node.live.request.player, step }, ...child.trace],
        };
    }
    const prior = descend(root, {type: "Action", action: initial}, 0, 0);
    if (prior.status !== "loss") return null;
    for (const action of attempts) {
        const branch = descend(root, {type: "Action", action}, 0, 0);
        if (branch.status !== "safe") continue;
        const opening = [];
        for (const entry of branch.trace) {
            if (entry.phase !== 0 || entry.player !== defender) break;
            opening.push(entry.step);
        }
        return {action, status: "no_lethal_found", line: opening, actors: opening.map(() => defender),
            prevention: { before: prior.trace, after: branch.trace, terminalLeaves: leaves } };
    }
    return null;
}

// Extend a resolved defense into a race using unspent ink. An opposing action
// other than passing breaks this proof. Both sides' unknown draws remain masked.
function planBoardDevelopment(selected, { anchor, start, spend, defender, attacker, held }) {
    if (selected?.status !== "no_lethal_found" || selected.publicReplies || selected.conditionalProgress ||
        selected.continuationCutoff || selected.line.at(-1)?.action?.type !== "End Turn" ||
        selected.actors.some((actor) => actor !== defender) || held.length > 4) return selected;
    const costs = selected.line.flatMap((s, i) => s.answer?.payment?.[0]?.type === "Discard" ? [i] : []);
    if (costs.length !== 1) return selected;
    const index = costs[0];
    const unknown = Symbol("unresolved board race");
    function step(live, input, line) {
        spend();
        live.submit(input);
        line.push(input);
    }
    function action(live, move, line) {
        step(live, {type: "Action", action: move}, line);
        for (let i = 0; live.request && live.request.type !== "Action"; i++) {
            if (i >= 4 || live.request.player !== defender || !["Pay Cost", "Choose Trigger"].includes(live.request.type)) throw unknown;
            const answers = decisionAnswers(live, line, defender);
            if (answers?.length !== 1) throw unknown;
            step(live, {type: "Decision", answer: answers[0]}, line);
        }
    }
    function end(live, player, line) {
        const menu = live.request;
        const pass = menu?.type === "Action" && menu.player === player && menu.actions.find((a) => a.type === "End Turn");
        if (!pass) throw unknown;
        step(live, {type: "Action", action: pass}, line);
        if (live.request) throw unknown;
    }
    function from(state, player) {
        if (state?.turn.player !== player) throw unknown;
        spend();
        return start(state);
    }
    function plays(live) {
        if (live.request?.type !== "Action" || live.request.player !== defender) throw unknown;
        return live.request.actions.filter((a) => a.type === "Play" && held.some((c) => c.i === a.card.i));
    }
    function finish(live, opening) {
        const turns = [];
        if (!live.outcome) end(live, defender, opening);
        for (let n = 0; ; n++) {
            if (live.outcome || n === 3) {
                return { winOn: live.outcome?.winners.includes(defender) ? n : null, opening, turns };
            }
            const reply = from(live.result, attacker);
            if (reply.request?.type !== "Action" || reply.request.actions.length !== 1) throw unknown;
            const replyLine = [], own = [];
            end(reply, attacker, replyLine);
            if (reply.outcome) throw unknown;
            live = from(reply.result, defender);
            turns.push({ reply: replyLine, own });
            for (let count = 0; !live.outcome; count++) {
                if (live.request?.type !== "Action" || live.request.player !== defender) throw unknown;
                const quest = live.request.actions.find((a) => a.type === "Quest");
                if (!quest) break;
                if (count === 4) throw unknown;
                action(live, quest, own);
            }
            if (live.outcome) continue;
            const affordable = plays(live);
            // Multiple spending choices would need another comparison.
            if (affordable.length > 1) throw unknown;
            if (affordable.length) action(live, affordable[0], own);
            if (!live.outcome) end(live, defender, own);
        }
    }
    try {
        spend();
        const initial = anchor();
        const prefix = [];
        for (const input of selected.line.slice(0, index)) step(initial, input, prefix);
        const payments = decisionAnswers(initial, prefix, defender);
        if (!payments?.length || payments.length > 4) return selected;
        const evaluated = [];
        let incumbent, best;
        const ordered = [selected.line[index].answer, ...payments.filter((a) =>
            a.payment?.[0]?.cards?.[0]?.i !== selected.line[index].answer.payment[0].cards[0].i)];
        for (const [i, answer] of ordered.entries()) {
            if (!answer.payment) continue;
            spend();
            const live = anchor();
            const line = [];
            for (const input of selected.line.slice(0, -1).with(index, {type: "Decision", answer})) step(live, input, line);
            if (!i) {
                incumbent = finish(live.branch(), [...line]);
                evaluated.push(incumbent);
            }
            for (const play of plays(live)) {
                const branch = live.branch(), opening = [...line];
                action(branch, play, opening);
                const race = finish(branch, opening);
                evaluated.push(race);
                if (race.winOn !== null && race.winOn < (incumbent.winOn ?? Infinity) &&
                    race.winOn < (best?.winOn ?? Infinity)) best = race;
            }
        }
        if (!best) return selected;
        return { ...selected, line: best.opening, actors: best.opening.map(() => defender),
            boardRace: { winOn: best.winOn, priorWinOn: incumbent.winOn, evaluated } };
    } catch (error) {
        if (error === unknown || error?.name === "InvalidInput") return selected;
        throw error;
    }
}

function publicPosition(view, defender) {
    const position = structuredClone(view);
    let next = 1_000_000_000;
    const visible = new Set(Object.entries(position.players).flatMap(([seat, player]) => [
        ...player.discard.map((card) => card.i),
        ...player.play.flatMap(({ card, under = [] }) => [
            card.i, ...under.filter((entry) => !entry.faceDown).map((entry) => entry.card.i),
        ]),
        ...(Number(seat) === defender && Array.isArray(player.hand) ? player.hand.map((card) => card.i) : []),
    ]));
    const count = (zone) => typeof zone === "number" ? zone : zone.length;
    const hidden = () => {
        while (visible.has(next)) next++;
        return { fullName: hiddenName, i: next++ };
    };
    const mask = (zone) => Array.from({ length: count(zone) }, hidden);
    for (const [seat, player] of Object.entries(position.players)) {
        player.deck = mask(player.deck);
        if (Number(seat) !== defender || typeof player.hand === "number") player.hand = mask(player.hand);
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

// Registry slots are local to a resolution. Match the grant by source
// and carry its public definition into the real player's action menu.
function grantedLore(live, action) {
    if (action.type !== "Activate" || !Number.isInteger(action.rule)) return;
    const rule = live.rules.registeredRules().find(entry =>
        entry.slot === action.rule && entry.source.card.i === action.card.i);
    const granted = live.rules.grants(action.card).filter(g => g.ability.type === "Activated");
    const ability = rule?.ability ?? (granted.length === 1 ? granted[0].ability : undefined);
    if (ability?.type === "Activated" && ability.effect.type === "Gain Lore" &&
        ability.effect.player === "You") return ability;
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
        if (step.type === "Action" && step.action.type === "Activate" && step.action.rule !== undefined)
            entry.grant = grantedLore(live, step.action);
        if (trigger) entry.trigger = { player: trigger.player, source: trigger.source, effect: trigger.effect };
        plan.push(entry);
        live.submit(step);
    }
    return plan;
}

export function matchesPlanPosition(view, entry) {
    return projectionKey(view, view.turn.player) === entry.position;
}

// Recreate only a unique Lilo opening prompt. Advance both branches with an
// anonymous draw, then ask the ordinary defensive search about each main phase.
export function compareLiloOpening(engine, view, prompt, limits = {}) {
    const seat = view.turn.player;
    const own = view.players[seat];
    if (prompt.type !== "Optional" || prompt.player !== seat || prompt.effect?.type !== "Play" ||
        prompt.effect.cards !== "Self" || prompt.effect.exerted !== true ||
        own.discard.filter(c => c.fullName === "Lilo - Escape Artist").length !== 1) return;
    const position = publicPosition(view, seat);
    const options = { card: name => name === hiddenName ? hiddenCard : engine.getCard(name) };
    const maxNodes = Math.min(limits.maxNodes ?? 768, 384);
    const deadline = performance.now() + Math.min(limits.maxMs ?? 1200, 350);
    let nodes = 0;
    const branches = [];
    for (const accept of [true, false]) {
        if (nodes >= maxNodes || performance.now() >= deadline) return;
        const live = engine.startTurn(position, options);
        const r = live.request;
        if (r?.type !== "Optional" || JSON.stringify(r.effect) !== JSON.stringify(prompt.effect) ||
            r.player !== seat || projectionKey(live.position, seat) !== projectionKey(view, seat)) return;
        live.submit({type: "Decision", answer: {type: "Optional", accept}});
        nodes++;
        if (accept) {
            if (nodes >= maxNodes || performance.now() >= deadline) return;
            const pay = live.request;
            if (pay?.type !== "Pay Cost" || pay.player !== seat || pay.cost.length !== 1 ||
                pay.cost[0].type !== "Ink" || pay.cost[0].amount !== 2) return;
            const cards = live.position.players[seat].inkwell.filter(i => !i.exerted).slice(0, 2).map(i => i.card);
            if (cards.length !== 2 || live.position.players[seat].inkDrops) return;
            live.submit({type: "Decision", answer: {type: "Pay Cost", pay: true,
                payment: [{type: "Ink", player: seat, cards}]}});
            nodes++;
            if (!live.position.players[seat].play.some(p => p.card.i === own.discard.find(c => c.fullName === "Lilo - Escape Artist").i)) return;
        }
        const ms = deadline - performance.now();
        if (live.request?.type !== "Action" || ms <= 0 || nodes >= maxNodes) return;
        const result = analyzeImmediateDefense(engine, live.position, {...limits, maxNodes: maxNodes - nodes,
            maxActions: Math.min(limits.maxActions ?? 3, 3), maxMs: ms, preventNextCycle: false});
        nodes += result.nodes;
        if (result.budgetExhausted || performance.now() > deadline) return;
        branches.push({pass: result.baseline.status, selected: result.selected?.status ?? null});
        if (accept && (result.baseline.status !== "lethal" || result.selected)) return;
    }
    if (!["no_lethal_found", "defender_wins"].includes(branches[1].selected)) return;
    return {verdict: "reserve_opening_ink", branches, nodes};
}

// Fixed-board probe for spending the last ink opportunity before passing.
// The readied projection asks the rules engine which plays and targets exist.
export function reserveRemoval(engine, view, request, deadline) {
    const seat = view.turn.player;
    const inks = request.actions.filter(x => x.action.type === "Ink");
    if (inks.length !== 2 || view.players[seat].hand.length !== 2) return;
    const keep = inks.find(x => x.action.card.fullName === "Above the Crowd");
    const spend = inks.find(x => x.action.card.fullName === "Circle of Life");
    if (!keep || !spend || view.players[seat].inkwell.length !== 4) return;
    const options = {card: name => name === hiddenName ? hiddenCard : engine.getCard(name)};
    for (const [ink, held] of [[keep, spend],[spend, keep]]) {
        if (performance.now() >= deadline) return;
        const current = engine.continueTurn(publicPosition(view, seat), options);
        const move = current.request.actions.find(a => a.type === "Ink" && a.card.i === ink.action.card.i);
        if (!move) return;
        current.submit({type:"Action",action:move});
        if (current.request?.type !== "Action") return;
        const state = structuredClone(current.position);
        for (const entry of state.players[seat].inkwell) entry.exerted = false;
        for (const entry of state.players[seat].play) {entry.exerted = false; entry.drying = false;}
        const next = engine.continueTurn(state, options);
        const plays = next.request.actions.filter(a => (a.type === "Play" && a.card.i === held.action.card.i) ||
            a.type === "Sing" && a.song.i === held.action.card.i);
        if (ink === keep) { if (plays.length) return; continue; }
        const paid = plays.find(a => a.type === "Play");
        if (!paid) return;
        next.submit({type:"Action",action:paid});
        if (next.request?.type !== "Pay Cost") return;
        const payments = decisionAnswers(next, [], seat);
        if (!payments?.length) return;
        next.submit({type:"Decision",answer:payments[0]});
        if (performance.now() < deadline && next.request?.type === "Choose Cards" && next.request.cards.length) return spend.action;
    }
}
