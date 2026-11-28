// Offline synthetic experiments. Only the current player's menu reaches the override.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureLoss, reviewLoss, trial } from "./strategic_v4_sparring_lab.mjs";

const hash = data => createHash("sha256").update(data).digest("hex");

async function transfer(position, seed, prefix) {
    let index = 0, diverged = false;
    const result = await trial(position, seed, true, {}, [], (view, request, chosen) => {
        if (diverged || index === prefix.length || view.turn.player !== 2 || request.player !== 2) return chosen;
        const step = prefix[index];
        if (step.menu !== hash(JSON.stringify(request))) {
            diverged = true;
            return chosen;
        }
        index++;
        return step.answer;
    });
    return { matched: !diverged && index === prefix.length, winner: result.winner,
        lore: result.ownLore, executed: result.executed };
}

export async function explore(folder, reviews, output, {maxVariants = 24, maxMs = 15000, offset = 0} = {}) {
    const start = performance.now();
    const report = {status: "inconclusive", parent: null, tested: 0, losses: 0, branches: 0, cutoff: null};
    const engine = await import(pathToFileURL(resolve(process.env.INKWELL_SPAR_ENGINE)));
    const parents = reviews.filter(r => r.status === "inconclusive" && /^[a-f0-9]{64}\.json$/.test(r.checkpoint))
        .map(r => {
            const raw = readFileSync(join(folder, r.checkpoint));
            if (hash(raw) + ".json" !== r.checkpoint) throw Error("Invalid checkpoint hash");
            return {record: JSON.parse(raw), file: r.checkpoint};
        }).filter(({record: r}) => r.origin === "synthetic-benchmark" && r.policy === "defense" &&
            r.horizon === 2 && r.opponent === "quest-first" && r.observed.winner === 1 &&
            r.position.players[2].play.length === 1 && !r.position.players[2].hand.length &&
            !r.position.players[2].inkwell.length && r.position.players[1].play.length === 1 &&
            r.position.players[1].play[0].exerted &&
            engine.getCard(r.position.players[2].play[0].card.fullName).type === "Character")
        .sort((a,b) => a.record.name.localeCompare(b.record.name) || a.record.seed - b.record.seed);
    if (!parents.length) return report;
    const {record, file} = parents[0];
    report.parent = file;
    const replay = await trial(record.position, record.seed, true);
    if (JSON.stringify(replay.executed) !== JSON.stringify(record.observed.executed) || replay.winner !== 1)
        return {...report, status: "parent_mismatch"};
    const catalog = new Map(engine.cards.filter(c => c.type === "Character" && c.abilities?.some(
        a => a.type === "Keyword" && a.keyword.name === "Boost")).map(c => [c.fullName,c]));
    const ordered = [...catalog].sort(([a],[b]) => a.localeCompare(b));
    const first = Math.max(0, Math.trunc(offset)) % ordered.length;
    for (const [name, card] of [...ordered.slice(first), ...ordered.slice(0,first)]) {
        if (report.tested >= maxVariants || performance.now() - start >= maxMs) {
            report.cutoff = "budget"; break;
        }
        const p = structuredClone(record.position), own = p.players[2];
        own.play[0].card.fullName = name;
        own.lore = 19 - card.lore;
        // Move existing synthetic fillers into the inkwell, preserving unique instance IDs.
        const amount = card.abilities.find(a => a.keyword?.name === "Boost").keyword.cost[0]?.amount;
        if (!Number.isInteger(amount) || amount < 1 || amount >= own.deck.length - 2) continue;
        own.inkwell.push(...own.deck.splice(-amount).map(card => ({card, exerted:false})));
        // Reserve a public-board change and a different seed before searching.
        const held = structuredClone(p), heldSeed = record.seed + 1009;
        held.players[1].play[0].exerted = false;
        const base = await trial(p, record.seed, true);
        report.tested++;
        if (base.winner !== 1) continue;
        report.losses++;
        const checkpoint = captureLoss(output, name, p, record.seed, base);
        const review = await reviewLoss(checkpoint);
        report.branches += review.branches.length;
        if (!review.reproduced || !["own_win","survived_reply"].includes(review.status)) continue;
        const branch = review.branches.at(-1);
        const baseline = await trial(held, heldSeed, true);
        if (baseline.winner !== 1) continue;
        const reserved = await transfer(held, heldSeed, branch.prefix);
        if (!reserved.matched || reserved.winner !== branch.result.winner) continue;
        return {...report, status: "validated_variant", name, seed: record.seed, heldSeed,
            checkpoint:basename(checkpoint), prefix:branch.prefix, discovery:branch.result,
            baseline:base.executed, heldBaseline:baseline.executed, reserved, ms:Math.round(performance.now()-start)};
    }
    return {...report, ms:Math.round(performance.now()-start)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [folder, reviews, output, offset = "0"] = process.argv.slice(2);
    console.log(JSON.stringify(await explore(folder, JSON.parse(readFileSync(reviews)), output, {offset:Number(offset)})));
}
