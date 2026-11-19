/* Inkwell — "Analisar com IA": turns one game log (format 1.0, e.g. from duels.ink) into a prompt the player
 * pastes into their own AI (ChatGPT, Claude, Gemini…). Nothing is sent anywhere by Inkwell.
 *
 *   INKWELL_AI_PROMPT(log, cards, { lang: "pt" | "en" }) -> string
 *     log    a game log with turns[] (games without turns have nothing to analyse -> "")
 *     cards  Map or object: card_id -> catalog card (site/data/cards.json: name_en, ink_cost, card_type,
 *            ink_color, inkable, strength, willpower, lore, move_cost, ability_text, classification)
 *
 * Why the card texts go in: general chatbots know little about recent Lorcana sets and invent card text.
 * Giving the exact text of every card seen keeps the analysis on what the cards really do. */
(function (root) {
  "use strict";

  const PT = {
    me: "Eu", opp: "Oponente",
    role: "Você é um coach experiente de Disney Lorcana TCG. Analise a partida abaixo, jogada por mim no duels.ink (simulador online).",
    rules: [
      "Lembretes de regras: vence quem chega a 20 de lore primeiro. A cada turno o jogador pode colocar 1 carta inkável no inkwell (tinta).",
      "Personagens precisam de um turno em jogo antes de fazer quest ou desafiar (exceto Rush). Quest e desafio exaurem o personagem.",
      "Só personagens exauridos podem ser desafiados; os dois causam dano igual à sua força (Strength) e são banidos ao atingir a resistência (Willpower).",
      "Canções podem ser cantadas exaurindo um personagem de custo suficiente em vez de pagar tinta. Shift coloca um personagem por cima de outro com o mesmo nome.",
    ],
    caveats: "Limites do registro: ele mostra o que foi jogado, não a minha mão nem o que comprei. Do oponente só conheço as cartas que apareceram. Use apenas os textos de carta listados abaixo; não invente efeitos. Se algo depender da mão, diga que é uma hipótese.",
    // Missão 2027, etapa 7: every part asks for a concrete turn, separates decision from result, and ends in one training goal
    askLoss: [
      "Responda em português, direto e prático (até ~400 palavras), nesta ordem, sempre citando turnos (ex.: \"T6\"). Marque cada afirmação como [fato] (está no registro) ou [hipótese] (depende de mão, compras ou custos que o registro não traz):",
      "1. Por que perdi: os 2 ou 3 momentos que decidiram o jogo.",
      "2. Mulligan e abertura: este registro traz só quantas cartas troquei, não quais. Avalie pelas jogadas dos primeiros turnos o que a mão parece ter permitido, como [hipótese], sem afirmar que cartas eu tinha.",
      "3. Sequência e tinta: em turnos concretos, a ordem das jogadas e quais cartas foram para o inkwell. Não conclua que sobrou tinta somando custos impressos: reduções, shift, canções e efeitos mudam o custo pago. Se suspeitar de tinta parada, diga que é [hipótese].",
      "4. Quest x desafio: onde eu deveria ter feito quest em vez de desafiar, ou o contrário, e por quê.",
      "5. Decisão x resultado: separe decisões ruins de variância. Diga se alguma boa decisão deu errado ou alguma decisão ruim deu certo.",
      "6. Informação que faltou: o que você precisaria saber (mão, compras) para ter certeza. Marque como palpite o que depende disso.",
      "7. Próximo treino: um único objetivo concreto e verificável para o próximo jogo com este deck (ex.: \"até o T4, colocar na tinta só cartas sem função no plano de jogo\").",
    ],
    askWin: [
      "Responda em português, direto e prático (até ~400 palavras), nesta ordem, sempre citando turnos (ex.: \"T6\"). Marque cada afirmação como [fato] (está no registro) ou [hipótese] (depende de mão, compras ou custos que o registro não traz):",
      "1. Por que ganhei: os 2 ou 3 momentos que decidiram o jogo.",
      "2. Mulligan e abertura: este registro traz só quantas cartas troquei, não quais. Avalie pelas jogadas dos primeiros turnos, como [hipótese], sem afirmar que cartas eu tinha.",
      "3. Sequência e tinta: decisões de ordem e de inkwell que devo repetir. Não conclua que sobrou tinta somando custos impressos; se suspeitar, diga que é [hipótese].",
      "4. Quest x desafio: onde acertei a escolha e onde corri risco à toa.",
      "5. Decisão x resultado: o que ganhei por boa decisão e o que ganhei por erro do oponente ou por sorte.",
      "6. Informação que faltou: o que você precisaria saber para ter certeza; marque palpites.",
      "7. Próximo treino: um único objetivo concreto e verificável para o próximo jogo com este deck.",
    ],
    missing: "O que o registro não mostra",
    missHand: "Minha mão e minhas compras: este registro não traz; só aparece o que foi jogado ou colocado na tinta.",
    missMull: "Mulligan: este registro traz só a quantidade de cartas trocadas (eu {m}, oponente {o}), não quais.", missMullNone: "Mulligan: não consta neste registro.",
    missOpp: "Do oponente, só as {n} cartas diferentes que apareceram; o resto da lista é desconhecido.",
    missCost: "Custo pago: não consta. O custo impresso nas cartas não é o que foi pago (reduções, shift, canções e efeitos).",
    match: "Partida", queue: "Fila", gameN: "jogo {n} da série", result: "Resultado", won: "VENCI", lost: "PERDI", draw: "EMPATE",
    by: { lore: "por lore", concede: "o oponente desistiu", timeout: "por tempo", deckout: "deck acabou" },
    first: "Quem começou", mull: "Mulligan (cartas trocadas)", turns: "Turnos", final: "Lore final",
    myDeck: "Meu deck ({n} cartas, {inks})", oppSeen: "Oponente — {inks} (só cartas vistas na partida)",
    ref: "Referência das cartas (texto oficial)", log: "Turno a turno (lore ao fim do turno: Eu–Oponente)",
    stats: "Números do jogo", inked: "tintas colocadas", played: "cartas jogadas", quested: "lore por quest", banishedMine: "personagens meus banidos", banishedOpp: "personagens do oponente banidos",
    noAct: "passou sem ações",
    act: {
      ink: "tinta: {c}", inkDeck: "tinta do topo do deck", play: "joga {c}", quest: "quest com {c} (+{v})", challenge: "{c} desafia {t} {x}",
      banish: "{c} é banido", damage: "{c} causa {v} de dano em {t}", sing: "canta {c} {x}", shift: "shift de {c} sobre {t}",
      activate: "ativa {c}{x}", lore_adjust: "+{v} lore ({x})", other: "{type} {c}",
    },
    unknown: "carta desconhecida",
  };
  const EN = {
    ...PT,
    me: "Me", opp: "Opponent",
    role: "You are an experienced Disney Lorcana TCG coach. Analyse the game below, which I played on duels.ink (online simulator).",
    rules: [
      "Rules reminders: first to 20 lore wins. Each turn a player may put 1 inkable card into their inkwell.",
      "Characters need a turn in play before questing or challenging (unless Rush). Questing and challenging exert the character.",
      "Only exerted characters can be challenged; both deal damage equal to their Strength and are banished at their Willpower.",
      "Songs can be sung by exerting a character of enough cost instead of paying ink. Shift puts a character on top of another with the same name.",
    ],
    caveats: "Limits of the log: it shows what was played, not my hand or draws. For the opponent I only know the cards that showed up. Use only the card texts listed below; don't invent effects. If something depends on the hand, say it is a guess.",
    askLoss: [
      "Answer in English, direct and practical (up to ~400 words), in this order, always citing turns (e.g. \"T6\"). Mark every claim as [fact] (it is in the log) or [hypothesis] (it depends on hand, draws or costs the log doesn't have):",
      "1. Why I lost: the 2 or 3 moments that decided the game.",
      "2. Mulligan and opening: this log only has how many cards I put back, not which. Judge from the plays of the first turns what the hand seems to have allowed, as a [hypothesis], without claiming which cards I had.",
      "3. Sequencing and ink: on concrete turns, the play order and which cards went to the inkwell. Don't conclude ink went unspent by adding printed costs: reductions, shift, songs and effects change the cost paid. If you suspect idle ink, call it a [hypothesis].",
      "4. Quest vs challenge: where I should have quested instead of challenging, or the other way round, and why.",
      "5. Decision vs result: separate bad decisions from variance. Say if a good decision went wrong or a bad one worked.",
      "6. Missing information: what you would need to know (hand, draws) to be sure. Mark as a guess what depends on it.",
      "7. Next practice: one concrete, checkable goal for my next game with this deck (e.g. \"until T4, ink only cards with no role in the game plan\").",
    ],
    askWin: [
      "Answer in English, direct and practical (up to ~400 words), in this order, always citing turns (e.g. \"T6\"). Mark every claim as [fact] (it is in the log) or [hypothesis] (it depends on hand, draws or costs the log doesn't have):",
      "1. Why I won: the 2 or 3 moments that decided the game.",
      "2. Mulligan and opening: this log only has how many cards I put back, not which. Judge from the plays of the first turns, as a [hypothesis], without claiming which cards I had.",
      "3. Sequencing and ink: order and inkwell decisions to repeat. Don't conclude ink went unspent by adding printed costs; if you suspect it, call it a [hypothesis].",
      "4. Quest vs challenge: where I chose right and where I took needless risks.",
      "5. Decision vs result: what I won by good decisions and what by the opponent's mistakes or luck.",
      "6. Missing information: what you would need to know to be sure; mark guesses.",
      "7. Next practice: one concrete, checkable goal for my next game with this deck.",
    ],
    missing: "What the log doesn't show",
    missHand: "My hand and my draws: not in this log; only what was played or inked shows up.",
    missMull: "Mulligan: this log only has how many cards were put back (me {m}, opponent {o}), not which.", missMullNone: "Mulligan: not in this log.",
    missOpp: "For the opponent, only the {n} different cards that showed up; the rest of the list is unknown.",
    missCost: "Cost paid: not in the log. A card's printed cost is not what was paid (reductions, shift, songs and effects).",
    match: "Game", queue: "Queue", gameN: "game {n} of the series", result: "Result", won: "WON", lost: "LOST", draw: "DRAW",
    by: { lore: "on lore", concede: "opponent conceded", timeout: "on time", deckout: "deck ran out" },
    first: "Went first", mull: "Mulligan (cards put back)", turns: "Turns", final: "Final lore",
    myDeck: "My deck ({n} cards, {inks})", oppSeen: "Opponent — {inks} (only cards seen in the game)",
    ref: "Card reference (official text)", log: "Turn by turn (lore at end of turn: Me–Opponent)",
    stats: "Game numbers", inked: "cards inked", played: "cards played", quested: "lore from quests", banishedMine: "my characters banished", banishedOpp: "opponent characters banished",
    noAct: "passed with no actions",
    act: {
      ink: "ink: {c}", inkDeck: "ink from top of deck", play: "plays {c}", quest: "quests with {c} (+{v})", challenge: "{c} challenges {t} {x}",
      banish: "{c} is banished", damage: "{c} deals {v} damage to {t}", sing: "sings {c} {x}", shift: "shifts {c} onto {t}",
      activate: "activates {c}{x}", lore_adjust: "+{v} lore ({x})", other: "{type} {c}",
    },
    unknown: "unknown card",
  };
  const INK_PT = { Amber: "Âmbar", Amethyst: "Ametista", Emerald: "Esmeralda", Ruby: "Rubi", Sapphire: "Safira", Steel: "Aço" };
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ""));
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

  function build(log, cards, opts = {}) {
    if (!log || !Array.isArray(log.turns) || !log.turns.length) return "";
    const L = opts.lang === "en" ? EN : PT;
    const get = (id) => (id == null ? null : typeof cards?.get === "function" ? cards.get(id) : cards?.[id]) || null;
    const name = (id) => (id == null ? L.unknown : clean(get(id)?.name_en) || id);
    const players = log.players || [];
    const meP = players.find((p) => p.is_me) || players[0] || { seat: "p1" };
    const me = meP.seat || "p1", oppP = players.find((p) => p.seat !== me) || {}, opp = oppP.seat || (me === "p1" ? "p2" : "p1");
    const who = (seat) => (seat === me ? L.me : L.opp);
    const inks = (p) => (p?.deck?.inks || []).map((i) => (opts.lang === "en" ? i : INK_PT[i] || i)).join("/") || "?";
    const r = log.result || {}, fl = r.final_lore || log.turns.at(-1)?.lore_end || {};
    const res = r.winner ? (r.winner === me ? L.won : L.lost) : L.draw;
    const lost = r.winner && r.winner !== me;

    // which card belongs to whom: my deck list, then who played / owned it in the log
    const seen = { [me]: new Map(), [opp]: new Map() };   // card -> times played/inked
    const stats = { [me]: { ink: 0, play: 0, quest: 0, banished: 0 }, [opp]: { ink: 0, play: 0, quest: 0, banished: 0 } };
    for (const t of log.turns) for (const a of t.actions || []) {
      const s = stats[a.by]; if (!s) continue;
      if (a.type === "ink") s.ink++;
      if (a.type === "play" || a.type === "shift") s.play++;
      if (a.type === "quest") s.quest += +a.value || 0;
      if (a.type === "banish") s.banished++;
      if (a.card_id && ["ink", "play", "shift", "quest", "challenge", "sing", "activate", "banish"].includes(a.type)) {
        if (["play", "shift", "ink", "sing", "quest", "challenge", "activate"].includes(a.type)) seen[a.by].set(a.card_id, (seen[a.by].get(a.card_id) || 0) + 1);
      }
    }
    const other = (seat) => (seat === me ? opp : me);
    const tag = (id, seat) => `${name(id)} [${who(seat)}]`;   // whose card: both decks can run the same card, so it comes from the action

    // card reference: my whole deck + every other card that showed up
    const refIds = [...new Set([...(meP.deck?.list || []).map((c) => c.card_id), ...seen[opp].keys(), ...seen[me].keys()])].filter((id) => id && get(id));
    const refLine = (id) => {
      const c = get(id), bits = [`${c.ink_cost ?? "?"}⬡`, c.card_type, c.ink_color, c.inkable ? "inkável" : "não inkável"];
      if (opts.lang === "en") bits[3] = c.inkable ? "inkable" : "uninkable";
      if (c.card_type === "Character") bits.push(`${c.strength ?? "?"}/${c.willpower ?? "?"}`, `lore ${c.lore ?? 0}`);
      if (c.card_type === "Location") bits.push(`lore ${c.lore ?? 0}`, `move ${c.move_cost ?? "?"}`, `willpower ${c.willpower ?? "?"}`);
      const text = clean(c.ability_text);
      return `- ${clean(c.name_en)} (${bits.filter(Boolean).join(", ")})${text ? ` — ${text}` : ""}`;
    };

    const act = (a) => {
      const T = L.act, x = clean(a.text);
      const t = (a.targets || []).map((id) => tag(id, other(a.by))).join(", ");   // challenges and damage hit the other side
      switch (a.type) {
        case "ink": return a.card_id ? fill(T.ink, { c: name(a.card_id) }) : T.inkDeck;
        case "play": return fill(T.play, { c: name(a.card_id) });
        case "quest": return fill(T.quest, { c: name(a.card_id), v: a.value });
        case "challenge": return fill(T.challenge, { c: name(a.card_id), t, x });
        case "banish": return fill(T.banish, { c: tag(a.card_id, a.by) });   // "by" is the banished card's owner
        case "damage": return fill(T.damage, { c: name(a.card_id), v: a.value, t });
        case "sing": return fill(T.sing, { c: name(a.card_id), x: x ? `(${x})` : "" });
        case "shift": return fill(T.shift, { c: name(a.card_id), t: (a.targets || []).map(name).join(", ") });
        case "activate": return fill(T.activate, { c: name(a.card_id), x: x ? `: ${x}` : "" });
        case "lore_adjust": return fill(T.lore_adjust, { v: a.value, x });
        default: return fill(T.other, { type: a.type, c: a.card_id ? name(a.card_id) : "" });
      }
    };
    const inkSoFar = { [me]: 0, [opp]: 0 };
    const turnLines = log.turns.map((t) => {
      const acts = (t.actions || []);
      for (const a of acts) if (a.type === "ink" && inkSoFar[a.by] != null) inkSoFar[a.by]++;
      const le = t.lore_end || {};
      const parts = acts.map((a) => (a.by && a.by !== t.player && a.type !== "banish" ? `[${who(a.by)}] ` : "") + act(a));
      return `T${t.number} ${who(t.player)} (inkwell ${inkSoFar[t.player] ?? "?"}): ${parts.length ? parts.join("; ") : L.noAct} → ${le[me] ?? "?"}–${le[opp] ?? "?"}`;
    });

    const ev = log.event || {}, ref = log.source_ref || {};
    const head = [
      `## ${L.match}`,
      ref.queue || ev.name ? `- ${L.queue}: ${clean(ref.queue || ev.name)}${ev.game_in_match ? ` (${fill(L.gameN, { n: ev.game_in_match })})` : ""}` : "",
      `- ${L.result}: ${res}${r.reason ? ` ${L.by[r.reason] || r.reason}` : ""} — ${L.final}: ${L.me} ${fl[me] ?? "?"} × ${fl[opp] ?? "?"} ${L.opp}`,
      `- ${L.first}: ${meP.went_first ? L.me : L.opp}. ${L.turns}: ${log.turns.length}`,
      meP.mulligan_count != null || oppP.mulligan_count != null ? `- ${L.mull}: ${L.me} ${meP.mulligan_count ?? "?"}, ${L.opp} ${oppP.mulligan_count ?? "?"}` : "",
    ].filter(Boolean);
    const deck = (meP.deck?.list || []);
    const deckN = deck.reduce((n, c) => n + (+c.qty || 0), 0);
    const deckLines = deck.slice().sort((a, b) => (get(a.card_id)?.ink_cost ?? 99) - (get(b.card_id)?.ink_cost ?? 99) || name(a.card_id).localeCompare(name(b.card_id)))
      .map((c) => `- ${c.qty}x ${name(c.card_id)}`);
    const oppLines = [...seen[opp].keys()].map((id) => `- ${name(id)}`);
    const sm = stats[me], so = stats[opp];
    const statLines = [
      `- ${L.me}: ${sm.ink} ${L.inked}, ${sm.play} ${L.played}, ${sm.quest} ${L.quested}, ${sm.banished} ${L.banishedMine}`,
      `- ${L.opp}: ${so.ink} ${L.inked}, ${so.play} ${L.played}, ${so.quest} ${L.quested}, ${so.banished} ${L.banishedOpp}`,
    ];

    return [
      L.role,
      "",
      ...L.rules,
      L.caveats,
      "",
      ...(lost ? L.askLoss : L.askWin),
      "",
      ...head,
      "",
      `## ${fill(L.myDeck, { n: deckN || "?", inks: inks(meP) })}`,
      ...(deckLines.length ? deckLines : ["- ?"]),
      "",
      `## ${fill(L.oppSeen, { inks: inks(oppP) })}`,
      ...(oppLines.length ? oppLines : ["- ?"]),
      "",
      `## ${L.stats}`,
      ...statLines,
      "",
      `## ${L.missing}`,
      `- ${L.missHand}`,
      `- ${meP.mulligan_count != null || oppP.mulligan_count != null ? fill(L.missMull, { m: meP.mulligan_count ?? "?", o: oppP.mulligan_count ?? "?" }) : L.missMullNone}`,
      `- ${fill(L.missOpp, { n: seen[opp].size })}`,
      `- ${L.missCost}`,
      "",
      `## ${L.log}`,
      ...turnLines,
      "",
      `## ${L.ref}`,
      ...refIds.map(refLine),
    ].join("\n");
  }

  if (typeof module !== "undefined" && module.exports) module.exports = build;
  else root.INKWELL_AI_PROMPT = build;
})(typeof window !== "undefined" ? window : globalThis);
