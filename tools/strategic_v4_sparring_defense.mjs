// Bounded, public-information pilot. Inputs must be main-phase positions in a two-player game.
const hiddenName = "Sparring Hidden Card";
const hiddenCard = { type: "Item", fullName: hiddenName, names: [hiddenName], colors: [], cost: 99, inkwell: false, subtypes: [] };
const defenderActions = new Set(["Challenge", "Quest", "Play", "Sing"]);

// Decisions with multiple targets and non-ink costs remain unresolved.
function decisionAnswers(live) {
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
        case "Choose Player":
            return request.players.map((player) => ({ type, player }));
        case "Choose Mode":
            return request.options.map(({ mode }) => ({ type, mode }));
        case "Choose Trigger":
            return request.options.map(({ reference: trigger }) => ({ type, trigger }));
        case "Pay Cost": {
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

export function analyzeImmediateDefense(engine, view, { maxNodes = 128, maxActions = 2 } = {}) {
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 4096) {
        throw new RangeError("maxNodes must be between 1 and 4096");
    }
    if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 4) {
        throw new RangeError("maxActions must be between 1 and 4");
    }
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

    function descend(node, input) {
        if (nodes >= maxNodes) {
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
        };
    }

    const lore = (live) => live.position?.players[attacker]?.lore ?? null;
    const incomplete = (node) => ({ status: "inconclusive", maxLore: lore(node.live), quests: [], line: node.line });

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
        const answers = decisionAnswers(node.live);
        if (!answers?.length || typeof request.player !== "number") return incomplete(node);
        let best;
        for (const answer of answers) {
            const child = descend(node, { type: "Decision", answer });
            const result = child ? visit(child) : incomplete(node);
            if (!best || prefer(result, best)) best = result;
            if (result.status === (actor === defender ? "defender_wins" : "lethal")) break;
            if (budgetExhausted) return actor === defender && best.status === "no_lethal_found" ? best : incomplete(node);
        }
        return best;
    }

    const defensiveRank = { defender_wins: 3, no_lethal_found: 2, inconclusive: 1, lethal: 0 };
    const offensiveRank = { lethal: 3, inconclusive: 2, no_lethal_found: 1, defender_wins: 0 };
    const preferDefense = (a, b) => defensiveRank[a.status] > defensiveRank[b.status] ||
        (a.status === b.status && a.maxLore !== null && b.maxLore !== null && a.maxLore < b.maxLore);
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
        const quests = request.actions.filter((action) => action.type === "Quest");
        let result = {
            ...incomplete(node),
            status: request.actions.every((action) => ["Quest", "End Turn"].includes(action.type)) ? "no_lethal_found" : "inconclusive",
        };
        for (const action of [...quests, ...request.actions.filter((option) => option.type === "End Turn")]) {
            const child = descend(node, { type: "Action", action });
            if (!child) return { ...result, status: "inconclusive" };
            let next;
            if (action.type === "Quest") {
                next = checkReply(child);
                next = { ...next, quests: [action.card, ...next.quests] };
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
        const start = { live, anchor, prefix: [], line: [] };
        // Public non-main-phase openings can grant extra actions and are outside this pilot.
        const reply = live.request?.type === "Action" || live.outcome ? checkReply(start) : incomplete(start);
        return { ...reply, replyLine: reply.line, line: node.line };
    }

    function pass(node) {
        const end = node.live.request?.actions.find((action) => action.type === "End Turn");
        const child = end && descend(node, { type: "Action", action: end });
        return child ? endDefense(child) : incomplete(node);
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
            if (!defenderActions.has(action.type)) continue;
            const child = descend(node, { type: "Action", action });
            if (!child) break;
            const result = defend(child, remaining - 1);
            if (preferDefense(result, best)) best = result;
            if (best.status === "defender_wins" || budgetExhausted) break;
        }
        return best;
    }

    const anchor = () => engine.continueTurn(position, options);
    const root = { live: anchor(), anchor, prefix: [], line: [] };
    if (root.live.request?.type !== "Action") throw new Error("a main-phase action menu is required");
    const baseline = pass(root);
    const candidates = [];
    if (baseline.status === "lethal") {
        for (const action of root.live.request.actions) {
            if (!defenderActions.has(action.type)) continue;
            const child = descend(root, { type: "Action", action });
            if (!child) break;
            candidates.push({ action, ...defend(child, maxActions - 1) });
            if (budgetExhausted) break;
        }
    }
    const selected = candidates.find((entry) => entry.status === "defender_wins")
        ?? candidates.filter((entry) => entry.status === "no_lethal_found").sort((a, b) => a.maxLore - b.maxLore)[0]
        ?? null;
    return { baseline, candidates, selected, nodes, maxNodes, maxActions, budgetExhausted };
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
