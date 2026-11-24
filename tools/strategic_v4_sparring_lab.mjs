import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDefensiveController } from "./strategic_v4_sparring_policy.mjs";

const enginePath = process.env.INKWELL_SPAR_ENGINE;
const engine = enginePath && await import(pathToFileURL(resolve(enginePath)));
export async function trial(position, seed, candidate, limits = {}, script = [], onDecision, turns = 2, opponentAction) {
    const setup = { player: 2, deck: [], settings: { seed, search: { nodes: 0, samples: 1 } } };
    const searches = [], decisions = [], verdicts = [];
    const remaining = [...script];
    const started = performance.now();
    const controller = candidate ? createDefensiveController(engine, setup, { limits,
        memoize(_view, _request, compute) { const decision = compute(); verdicts.push(decision.verdict); return decision; },
        onSearch(result, ms, request) {
            searches.push({ nodes: result.nodes, ms, cutoff: result.cutoff, pass: result.baseline.status,
                chosen: result.selected?.status ?? null, afterPublicPass: result.selected?.nextTurn ?? null, publicReplies: result.selected?.publicReplies ?? null,
                boardRace: result.selected?.boardRace ?? null, boardRaceCutoff: result.selected?.boardRaceCutoff ?? null,
                conditionalProgress: result.selected?.conditionalProgress ?? null,
                continuationCutoff: result.selected?.continuationCutoff ?? null, offered: request.actions,
                examined: result.candidates.map(({ action, status, line, replyLine }) => ({ action, status, line, replyLine })) });
        },
    }) : engine.createBot(setup);
    const human = engine.createBot({ ...setup, player: 1 });
    const seats = [
        { player: 1, deck: [], controller: { observe: (u) => human.observe(u),
            decide(view, request) {
                if (request.type !== "Action") return human.decide(view, request);
                const action = opponentAction?.(view, request) ?? request.actions.find((a) => a.action.type === "Quest") ??
                    request.actions.find((a) => a.action.type === "End Turn");
                return { type: "Action", option: action.option };
            } } },
        { player: 2, deck: [], controller: { observe: (u) => controller.observe(u),
            async decide(view, request, error) {
                assert.ifError(error);
                let answer = await controller.decide(view, request);
                if (remaining.length && request.type === "Action") {
                    const [type, name] = remaining.shift();
                    const action = request.actions.find(({ action }) => action.type === type &&
                        (!name || (action.card ?? action.song)?.fullName === name));
                    assert.ok(action, "scripted counterfactual requires a real menu option");
                    answer = { type: "Action", option: action.option };
                }
                if (onDecision) answer = onDecision(view, request, answer);
                decisions.push({ request, answer });
                return answer;
            } } },
    ];
    const game = await engine.playGameAsync(seats, { seed, from: structuredClone(position), turns, audit: true, retry: false });
    assert.equal(remaining.length, 0);
    return { winner: game.outcome?.winners[0] ?? null, lore: game.final.players[1].lore,
        ownLore: game.final.players[2].lore, hand: game.final.players[2].hand, ink: game.final.players[2].inkwell,
        ms: performance.now() - started, searches, decisions, verdicts, board: game.final.players[2].play, executed: game.turns.map(({ turn }) => turn.steps) };
}

const sha = (data) => createHash("sha256").update(data).digest("hex");
let versions;
function fingerprint() {
    return versions ??= {
        engine: sha(readFileSync(resolve(enginePath))),
        modules: ["lab", "policy", "defense"].map((part) =>
            sha(readFileSync(new URL("./strategic_v4_sparring_" + part + ".mjs", import.meta.url)))),
    };
}

function evidence(run) {
    return { winner: run.winner, lore: run.lore, ownLore: run.ownLore, executed: run.executed };
}

export function captureLoss(directory, name, position, seed, run, policy = "defense") {
    if (!directory || run.winner !== 1) return;
    // Only synthetic benchmark inputs enter this archive. Full positions belong
    // to the offline runner. The controller continues to receive a player view.
    const record = { schema: 1, origin: "synthetic-benchmark", policy, horizon: 2,
        opponent: "quest-first", name, seed, versions: fingerprint(), position, observed: evidence(run) };
    const data = JSON.stringify(record);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, sha(data) + ".json");
    const temporary = path + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, data, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    return path;
}

function alternatives(request) {
    switch (request.type) {
        case "Action":
            return request.actions.map(({ option }) => ({ type: "Action", option }));
        case "Optional":
            return [true, false].map((accept) => ({ type: "Decision", answer: { type: request.type, accept } }));
        case "Choose Cards":
            if (request.min !== 1 || request.max !== 1 || request.total) return [];
            return request.cards.filter((card) => card.i !== undefined &&
                (!request.required?.length || request.required.some((r) => r.i === card.i)))
                .map((card) => ({ type: "Decision", answer: { type: request.type, cards: [card] } }));
        default:
            return [];
    }
}

// Each branch starts a new engine game. A prefix binds a player answer to
// its exact projected menu; the engine validates the answer with retry off.
export async function reviewLoss(path) {
    const raw = readFileSync(path);
    assert.equal(basename(path), sha(raw) + ".json", "checkpoint checksum mismatch");
    const saved = JSON.parse(raw);
    assert.deepEqual(saved.versions, fingerprint(), "different rules engine or policy");
    assert.ok(saved.origin === "synthetic-benchmark" && saved.schema === 1 && ["defense", "v8-reference"].includes(saved.policy) &&
        saved.horizon === 2 && saved.opponent === "quest-first" && saved.observed.winner === 1);
    const limits = saved.policy === "v8-reference" ? { mixedActivation: false, planBoardRace: false } : {};
    const maxBranches = 12, maxPrompts = 6, maxMs = 8000;
    const started = performance.now();
    const report = { checkpoint: basename(path), name: saved.name, seed: saved.seed,
        status: "inconclusive", reproduced: false, limits: { maxBranches, maxPrompts, maxMs },
        branches: [], cutoff: null };
    const queue = [], queued = new Set();
    async function run(prefix) {
        const prompts = [];
        const result = await trial(saved.position, saved.seed, true, limits, [], (view, request, chosen) => {
            if (view.turn.player !== 2 || request.player !== 2 || prompts.length >= maxPrompts) return chosen;
            const menu = sha(JSON.stringify(request));
            const forced = prefix[prompts.length];
            if (forced) assert.equal(forced.menu, menu, "decision prefix diverged");
            const answer = forced?.answer ?? chosen;
            prompts.push({ menu, answer, options: alternatives(request) });
            return answer;
        });
        assert.ok(prompts.length >= prefix.length);
        // With a breadth-first queue, earlier branches take precedence.
        const seen = prompts.slice(0, prefix.length).map(({menu, answer}) => ({menu, answer}));
        for (const {menu, answer, options} of prompts.slice(prefix.length)) {
            for (const other of options) {
                if (JSON.stringify(answer) === JSON.stringify(other)) continue;
                const branch = [...seen, {menu, answer: other}];
                const key = JSON.stringify(branch);
                if (!queued.has(key) && queued.size < maxBranches) {
                    queue.push(branch);
                    queued.add(key);
                } else if (!queued.has(key)) report.cutoff ??= "branches";
            }
            seen.push({menu, answer});
        }
        return evidence(result);
    }
    const original = await run([]);
    if (JSON.stringify(original) !== JSON.stringify(saved.observed)) {
        report.status = "replay_mismatch";
        return report;
    }
    report.reproduced = true;
    while (queue.length) {
        if (performance.now() - started >= maxMs) { report.cutoff = "time"; break; }
        const prefix = queue.shift();
        const result = await run(prefix);
        report.branches.push({ prefix, result });
        if (result.winner !== 1) {
            report.status = result.winner === 2 ? "own_win" : "survived_reply";
            break;
        }
    }
    report.ms = Math.round(performance.now() - started);
    return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    console.log(JSON.stringify(await reviewLoss(process.argv[2])));
}
