// Engine facade for the unchanged JSONL bridge. New chat games pin this file,
// the search module and the controller. Legacy games still load their own engine.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createDefensiveController } from "./strategic_v4_sparring_policy.mjs";

const engine = await import(pathToFileURL(process.env.INKWELL_RULES_ENGINE));
export const { getCard, parseDeckList, validateDeck, playGameAsync } = engine;

export function createBot(setup) {
    const journal = process.env.INKWELL_DECISION_JOURNAL;
    if (!journal) return createDefensiveController(engine, setup);
    const entries = readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    let index = 0;
    return createDefensiveController(engine, setup, {
        memoize(view, request, compute) {
            const key = createHash("sha256").update(JSON.stringify([view, request])).digest("hex");
            if (index < entries.length) {
                const record = entries[index++];
                if (record.key !== key) throw new Error("defense checkpoint diverged");
                return record.decision;
            }
            const decision = compute();
            appendFileSync(journal, JSON.stringify({ key, decision }) + "\n");
            return decision;
        },
    });
}
