import { isDeepStrictEqual as equal } from "node:util";
import { analyzeImmediateDefense, matchesPlanPosition, ownPlan } from "./strategic_v4_sparring_defense.mjs";

function actionOption(request, action) {
    if (request.type !== "Action") return undefined;
    const matches = request.actions.filter(({ action: offered }) => {
        if (action.type !== "Activate") return equal(offered, action);
        // The public menu describes printed abilities by source and index.
        // A granted ability has no stable printed index across projections.
        return offered.type === "Activate" && Number.isInteger(action.ability?.i) &&
            offered.player === action.player && offered.ability === action.ability.i &&
            equal(offered.card, action.ability.card) && Boolean(offered.free) === Boolean(action.free);
    });
    return matches.length === 1 ? matches[0] : undefined;
}

// Bind a simulated choice to THIS engine prompt. Hidden handles and option
// numbers are request-local. Never submit the IDs of simulated ink.
function bind(request, { step, trigger }) {
    if (step.type === "Action") {
        const entry = actionOption(request, step.action);
        return entry && { type: "Action", option: entry.option };
    }
    const answer = step.answer;
    if (step.type !== "Decision" || request.type !== answer.type) return undefined;
    switch (answer.type) {
        case "Pay Cost": {
            if (!answer.pay) return request.optional ? step : undefined;
            if (answer.payment.length === 1 && ["Exert", "Banish", "Discard"].includes(answer.payment[0].type)) {
                const payment = request.payments.find((offered) => equal(offered, answer.payment));
                return payment && { type: "Decision", answer: { type: answer.type, pay: true, payment } };
            }
            const shape = (payment) => payment.map((p) => p.type === "Ink"
                ? [p.type, p.player, p.cards?.length, p.inkDrops ?? 0] : p);
            const payment = request.payments.find((p) => equal(shape(p), shape(answer.payment)));
            return payment && { type: "Decision", answer: { type: answer.type, pay: true, payment } };
        }
        case "Choose Cards":
            if (request.total || answer.cards.length < request.min || answer.cards.length > request.max ||
                !answer.cards.every((card) => request.cards.some((c) => equal(c, card))) ||
                (answer.cards.length && request.required?.length &&
                    !request.required.some((c) => answer.cards.some((card) => equal(c, card))))) return undefined;
            return step;
        case "Choose Trigger": {
            const matches = request.options.filter((o) => equal(
                { player: o.player, source: o.source, effect: o.effect }, trigger));
            return matches.length === 1 && { type: "Decision", answer: { type: answer.type, option: matches[0].option } };
        }
        case "Choose Mode":
            return request.options.some((o) => o.mode === answer.mode) ? step : undefined;
        case "Choose Amount":
            return answer.amount >= request.min && answer.amount <= request.max ? step : undefined;
        case "Choose Player":
            return request.players.includes(answer.player) ? step : undefined;
        case "Optional":
        case "Optional Cost Rule":
            return step;
        default:
            return undefined;
    }
}

export function createDefensiveController(engine, setup, {
    limits = {}, onSearch = () => {}, memoize = (_view, _request, compute) => compute(),
} = {}) {
    const baseline = engine.createBot(setup);
    let pending = [];
    let turn;
    return {
        observe(update) { baseline.observe(update); },
        async decide(view, request) {
            // Keep the original controller's RNG and memory in sync even on overrides.
            const original = await baseline.decide(view, request);
            if (turn !== view.turn.number || view.turn.player !== setup.player) pending = [];
            turn = view.turn.number;
            if (view.turn.player !== setup.player) return original;
            if (pending.length && matchesPlanPosition(view, pending[0])) {
                const answer = bind(request, pending.shift());
                if (answer) return answer;
            }
            pending = [];
            if (request.type !== "Action" || !request.actions.some((r) => r.action.type === "End Turn")) return original;
            const { plan } = memoize(view, request, () => {
                const start = performance.now();
                let search;
                try {
                    search = analyzeImmediateDefense(engine, view, {
                        maxNodes: 768, maxActions: 3, maxMs: 1200, ...limits,
                        allowInk: request.actions.some((r) => r.action.type === "Ink"),
                        rootAllowed: (action) => Boolean(actionOption(request, action)),
                    });
                } catch (error) {
                    // Unsupported projected positions cannot override the real controller.
                    const reason = error instanceof Error ? error.name : "unknown";
                    onSearch({ nodes: 0, cutoff: "unsupported", baseline: {status: "inconclusive"},
                        candidates: [], selected: null }, performance.now() - start, request);
                    return { verdict: "inconclusive", reason, plan: [] };
                }
                onSearch(search, performance.now() - start, request);
                const selected = search.selected;
                let verdict = search.baseline.status;
                let plan = [];
                if (selected && (!search.budgetExhausted || selected.status === "defender_wins")) {
                    plan = ownPlan(engine, view, selected);
                    verdict = selected.status === "defender_wins" ? "own_win" : "public_defense";
                } else if (search.budgetExhausted || search.baseline.status === "lethal") {
                    verdict = "inconclusive";
                }
                return { verdict, cutoff: search.cutoff, nodes: search.nodes, plan,
                    ...(selected?.nextTurn ? { afterPublicPass: selected.nextTurn } : {}),
                    ...(selected?.publicReplies ? { publicReplies: selected.publicReplies } : {}),
                    ...(selected?.boardRace ? { boardRace: selected.boardRace } : {}),
                    ...(selected?.conditionalProgress ? { conditionalProgress: selected.conditionalProgress } : {}),
                    ...(selected?.continuationCutoff ? { continuationCutoff: selected.continuationCutoff } : {}) };
            });
            if (!plan.length) return original;
            const answer = bind(request, plan[0]);
            if (!answer) return original;
            pending = plan.slice(1);
            return answer;
        },
    };
}
