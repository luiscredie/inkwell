import fs from "node:fs";
import assert from "node:assert/strict";

const html=fs.readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
const engine=fs.readFileSync(new URL("../site/match-center-engine.js",import.meta.url),"utf8");

const checks=[
  ["engine loaded", html.includes('<script src="./match-center-engine.js"></script>')],
  ["saved decks selector", html.includes("deckOpts:st.decks.map")],
  ["current card lookup", html.includes("cardsById:this.byId")],
  ["no legacy seed", !engine.includes("root.LORCANA_SEED") && !engine.includes('const DECK = ["Dale')],
  ["match deck id", engine.includes("deck_id: resolved.deckId")],
  ["raw log stored", engine.includes("raw_log: raw")],
  ["preview before save", html.includes("matchParsed:match") && html.includes("saveParsedMatch")],
  ["row opens match", html.includes("_open:()=>this.openMatch(m.id)")],
  ["row does not open deck", !html.includes("_open:()=>d&&this.openDeck(d.id)")],
  ["replay controls", ["replayReset","replayStep","replayToggle"].every(x=>html.includes(x))],
  ["profile matches persistence", html.includes("matches:this.state.matches")],
  ["filters", ["matchResultFilter","matchDateFilter","matchFilter"].every(x=>html.includes(x))]
];
for(const [name,ok] of checks) assert.ok(ok,name);
console.log("match-center-r3 contract: "+checks.length+"/"+checks.length);
