// Bounded, public-information pilot. Inputs must be main-phase positions in a two-player game.
const hiddenName = "Sparring Hidden Card";
const hiddenCard = { type: "Item", fullName: hiddenName, names: [hiddenName], colors: [], cost: 99, inkwell: false, subtypes: [] };
const LORE_TO_WIN = 20;

export function analyzeImmediateDefense(engine, view, { maxNodes = 128 } = {}) {
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 4096) {
        throw new RangeError("maxNodes must be between 1 and 4096");
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

    function submit(live, action) {
        if (nodes >= maxNodes) return false;
        nodes++;
        live.submit({ type: "Action", action });
        return true;
    }

    function checkReply(live) {
        if (live.outcome) {
            const lethal = live.outcome.reason === "Lore" && live.outcome.winners.includes(attacker);
            return { status: lethal ? "lethal" : "no_lethal_found", maxLore: live.position.players[attacker]?.lore ?? null, quests: [] };
        }
        const maxLore = live.position.players[attacker].lore;
        const request = live.request;
        // An unresolved start/quest trigger or other public action can change the result.
        if (!request || request.type !== "Action" || request.player !== attacker) {
            return { status: "inconclusive", maxLore, quests: [] };
        }
        const quests = request.actions.filter((action) => action.type === "Quest");
        let result = {
            status: request.actions.some((action) => !["Quest", "End Turn"].includes(action.type)) ? "inconclusive" : "no_lethal_found",
            maxLore,
            quests: [],
        };
        for (const quest of quests) {
            const branch = live.branch();
            if (!branch || !submit(branch, quest)) return { ...result, status: "inconclusive" };
            const next = checkReply(branch);
            const path = { ...next, quests: [quest.card, ...next.quests] };
            if (next.status === "lethal") return path;
            if (path.maxLore > result.maxLore) result = { ...result, maxLore: path.maxLore, quests: path.quests };
            if (next.status === "inconclusive") result.status = "inconclusive";
        }
        // End-of-turn public abilities may also gain lore.
        const end = request.actions.find((action) => action.type === "End Turn");
        const branch = live.branch();
        if (!end || !branch || !submit(branch, end) || branch.request) return { ...result, status: "inconclusive" };
        const finalLore = branch.position.players[attacker]?.lore ?? maxLore;
        if (branch.outcome?.reason === "Lore" && branch.outcome.winners.includes(attacker)) {
            return { status: "lethal", maxLore: finalLore, quests: [] };
        }
        return { ...result, maxLore: Math.max(result.maxLore, finalLore) };
    }

    function pass(live) {
        if (live.outcome?.winners.includes(defender)) return { status: "defender_wins", maxLore: live.position.players[attacker]?.lore ?? null, quests: [] };
        const end = live.request?.type === "Action" && live.request.actions.find((action) => action.type === "End Turn");
        if (!end || !submit(live, end) || live.request || live.result?.turn.player !== attacker) {
            return { status: "inconclusive", maxLore: live.position.players[attacker]?.lore ?? null, quests: [] };
        }
        return checkReply(engine.startTurn(live.result, options));
    }

    const root = engine.continueTurn(position, options);
    const baseline = pass(root.branch());
    const candidates = [];
    if (baseline.status === "lethal") {
        for (const action of root.request.actions) {
            if (!["Challenge", "Quest"].includes(action.type)) continue;
            const branch = root.branch();
            if (!submit(branch, action)) break;
            candidates.push({ action, ...pass(branch) });
        }
    }
    const selected = candidates.find((entry) => entry.status === "defender_wins")
        ?? candidates.find((entry) => entry.status === "no_lethal_found")
        ?? null;
    return { baseline, candidates, selected, nodes, maxNodes, budgetExhausted: nodes >= maxNodes };
}

function publicPosition(view, defender) {
    const position = structuredClone(view);
    let next = -1;
    const count = (zone) => typeof zone === "number" ? zone : zone.length;
    const hidden = () => ({ fullName: hiddenName, i: next-- });
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
