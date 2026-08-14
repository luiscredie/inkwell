// src/engine/rng.ts
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ h1 >>> 18, 597399067);
  h2 = Math.imul(h4 ^ h2 >>> 22, 2869860233);
  h3 = Math.imul(h1 ^ h3 >>> 17, 951274213);
  h4 = Math.imul(h2 ^ h4 >>> 19, 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
var Rng = class {
  a;
  b;
  c;
  d;
  constructor(seed) {
    const [a, b, c, d] = cyrb128(seed);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
  /** Float em [0, 1). */
  next() {
    this.a |= 0;
    this.b |= 0;
    this.c |= 0;
    this.d |= 0;
    const t = (this.a + this.b | 0) + this.d | 0;
    this.d = this.d + 1 | 0;
    this.a = this.b ^ this.b >>> 9;
    this.b = this.c + (this.c << 3) | 0;
    this.c = this.c << 21 | this.c >>> 11;
    this.c = this.c + t | 0;
    return (t >>> 0) / 4294967296;
  }
  /** Inteiro em [0, n). */
  int(n) {
    if (n <= 0) throw new Error("Rng.int requer n > 0");
    return Math.floor(this.next() * n);
  }
  /** Fisher-Yates in-place. [CR 2.2.1.2] */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
  /**
   * O estado do RNG faz parte do estado da partida: um checkpoint da busca do
   * bot que nao restaure o RNG produz linhas de jogo divergentes.
   */
  save() {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }
  restore(s) {
    this.a = s.a;
    this.b = s.b;
    this.c = s.c;
    this.d = s.d;
  }
};

// src/engine/events.ts
var EventLog = class {
  events = [];
  seq = 0;
  push(type, data, cause = {}) {
    const ev = { seq: this.seq++, type, cause, data };
    this.events.push(ev);
    return ev;
  }
  /** Usado pelo rollback: eventos de uma acao desfeita saem do historico. */
  truncateTo(length) {
    this.events.length = length;
  }
  get length() {
    return this.events.length;
  }
  all() {
    return this.events;
  }
  /** Rendericao legivel, para depuracao e para a aba de historico da UI. */
  format() {
    return this.events.map((e) => {
      const cause = [e.cause.action, e.cause.rule].filter(Boolean).join(" ");
      return `#${e.seq} ${e.type} ${JSON.stringify(e.data)}${cause ? "  <- " + cause : ""}`;
    }).join("\n");
  }
};

// src/engine/journal.ts
var Journal = class {
  ops = [];
  frames = [];
  get depth() {
    return this.frames.length;
  }
  get pendingOps() {
    return this.ops.length;
  }
  /** Abre um escopo desfazivel. Aninhavel. */
  begin(label) {
    this.frames.push({ label, start: this.ops.length });
  }
  /**
   * Registra uma operacao inversa. Fora de qualquer escopo a operacao e
   * descartada: nada a desfazer, e guardar tudo vazaria memoria na partida.
   */
  record(undo) {
    if (this.frames.length === 0) return;
    this.ops.push({ undo });
  }
  /** Marca um ponto irreversivel (embaralhar, revelar). [CR 1.7.6.2] */
  markIrreversible(reason) {
    if (this.frames.length === 0) return;
    this.ops.push({ undo: () => {
    }, irreversible: reason });
  }
  /** Confirma o escopo. Ao fechar o escopo mais externo, o journal e limpo. */
  commit() {
    const frame = this.frames.pop();
    if (!frame) throw new Error("commit sem begin correspondente");
    if (this.frames.length === 0) this.ops.length = 0;
  }
  /** Desfaz o escopo, do fim para o inicio. */
  rollback() {
    const frame = this.frames.pop();
    if (!frame) throw new Error("rollback sem begin correspondente");
    const blocked = [];
    for (let i = this.ops.length - 1; i >= frame.start; i--) {
      const op = this.ops[i];
      if (op.irreversible) {
        blocked.push(op.irreversible);
        continue;
      }
      op.undo();
    }
    this.ops.length = frame.start;
    return { complete: blocked.length === 0, blocked };
  }
  /**
   * Executa fn dentro de um escopo. Se fn lancar, o escopo e desfeito e o erro
   * repropagado com o resultado do rollback anexado.
   */
  transaction(label, fn) {
    this.begin(label);
    try {
      const result = fn();
      this.commit();
      return result;
    } catch (err) {
      const res = this.rollback();
      if (!res.complete && err instanceof Error) {
        err.message += ` [rollback parcial: ${res.blocked.join("; ")}]`;
      }
      throw err;
    }
  }
};
var IllegalActionError = class extends Error {
  constructor(message, rule) {
    super(message);
    this.rule = rule;
    this.name = "IllegalActionError";
  }
};

// src/engine/decisions.ts
var firstAvailable = {
  orderTriggers: () => 0,
  chooseTargets: (_g, _p, req) => req.pool.slice(0, req.max),
  confirmOptional: () => true,
  chooseOption: () => 0,
  chooseCardInHand: (_g, _p, hand) => hand[0],
  chooseFromCards: (_g, _p, req) => req.pool.slice(0, req.max)
};

// src/engine/game.ts
var Game = class {
  state;
  journal = new Journal();
  log = new EventLog();
  gameRng;
  botRng;
  defs;
  /** Quem responde as escolhas que a regra nao determina. Trocavel: UI ou bot. */
  decisions = firstAvailable;
  constructor(defs, state, seed) {
    this.defs = defs;
    this.state = state;
    this.gameRng = new Rng(seed + ":game");
    this.botRng = new Rng(seed + ":bot");
  }
  // --- acesso -------------------------------------------------------------
  card(id) {
    const c = this.state.cards.get(id);
    if (!c) throw new Error(`carta inexistente: ${id}`);
    return c;
  }
  def(id) {
    const d = this.defs.get(this.card(id).defId);
    if (!d) throw new Error(`definicao inexistente para carta ${id}`);
    return d;
  }
  player(id) {
    return this.state.players[id];
  }
  zoneArray(owner, zone) {
    return this.player(owner)[zone];
  }
  // --- escopos ------------------------------------------------------------
  begin(label) {
    const logLength = this.log.length;
    this.journal.begin(label);
    this.journal.record(() => this.log.truncateTo(logLength));
  }
  commit() {
    this.journal.commit();
  }
  rollback() {
    return this.journal.rollback();
  }
  transaction(label, fn) {
    this.begin(label);
    try {
      const r = fn();
      this.commit();
      return r;
    } catch (err) {
      this.rollback();
      throw err;
    }
  }
  /** Checkpoint para a busca do bot. Inclui o estado dos dois RNGs. */
  checkpoint(label) {
    this.begin(label);
    return {
      logLength: this.log.length,
      gameRng: this.gameRng.save(),
      botRng: this.botRng.save()
    };
  }
  restore(cp) {
    const r = this.rollback();
    this.gameRng.restore(cp.gameRng);
    this.botRng.restore(cp.botRng);
    return r;
  }
  emit(type, data, cause = {}) {
    this.log.push(type, data, cause);
  }
  // --- mutadores primitivos ----------------------------------------------
  /** [CR 2.3.3] Encerra a partida. O primeiro resultado registrado prevalece. */
  endGame(winner, reason, rule) {
    if (this.state.winner !== null) return;
    const st = this.state;
    const beforeWinner = st.winner;
    const beforeReason = st.endReason;
    const beforePhase = st.phase;
    this.journal.record(() => {
      st.winner = beforeWinner;
      st.endReason = beforeReason;
      st.phase = beforePhase;
    });
    st.winner = winner;
    st.endReason = reason;
    st.phase = "over";
    this.emit("game-over", { winner, reason }, { rule });
  }
  /** Escreve um campo simples de GameState registrando o inverso. */
  setStateField(key, value) {
    const st = this.state;
    const before = st[key];
    if (before === value) return;
    this.journal.record(() => {
      st[key] = before;
    });
    st[key] = value;
  }
  /** Escreve um campo simples de PlayerState registrando o inverso. */
  setPlayerField(p, key, value) {
    const player = this.player(p);
    const before = player[key];
    if (before === value) return;
    this.journal.record(() => {
      player[key] = before;
    });
    player[key] = value;
  }
  /** [CR 1.11.1] Lore nunca fica abaixo de zero. */
  addLore(p, amount, cause = {}) {
    const player = this.player(p);
    const before = player.lore;
    const after = Math.max(0, before + amount);
    if (after === before) return;
    this.journal.record(() => {
      player.lore = before;
    });
    player.lore = after;
    this.emit("lore-changed", { player: p, from: before, to: after }, cause);
  }
  setExerted(id, value, cause = {}) {
    const c = this.card(id);
    if (c.exerted === value) return;
    const before = c.exerted;
    this.journal.record(() => {
      c.exerted = before;
    });
    c.exerted = value;
    this.emit(value ? "exerted" : "readied", { card: id }, cause);
  }
  setDrying(id, value, cause = {}) {
    const c = this.card(id);
    if (c.drying === value) return;
    const before = c.drying;
    this.journal.record(() => {
      c.drying = before;
    });
    c.drying = value;
    this.emit("drying-changed", { card: id, drying: value }, cause);
  }
  /**
   * [CR 1.9.2] Aplica contadores de dano. Esta e a primitiva bruta: a distincao
   * entre deal / put / remove / move e os modificadores de dano [CR 1.9.4]
   * entram na P4, por cima desta funcao.
   */
  setDamage(id, value, cause = {}) {
    const c = this.card(id);
    const after = Math.max(0, value);
    if (c.damage === after) return;
    const before = c.damage;
    this.journal.record(() => {
      c.damage = before;
    });
    c.damage = after;
    this.emit("damage-changed", { card: id, from: before, to: after }, cause);
  }
  /**
   * Move uma carta entre zonas. index = posicao no destino (default: fim).
   * O undo restaura a posicao exata na zona de origem: sem isso, desfazer uma
   * compra ilegal embaralharia o topo do deck.
   */
  moveCard(id, toOwner, toZone, index = null, cause = {}) {
    const c = this.card(id);
    const fromOwner = c.owner;
    const fromZone = c.zone;
    const fromArr = this.zoneArray(fromOwner, fromZone);
    const fromIndex = fromArr.indexOf(id);
    if (fromIndex < 0) throw new Error(`carta ${id} nao esta em ${fromZone}`);
    const toArr = this.zoneArray(toOwner, toZone);
    const insertAt = index === null ? toArr.length : index;
    fromArr.splice(fromIndex, 1);
    toArr.splice(insertAt, 0, id);
    c.zone = toZone;
    c.owner = toOwner;
    this.journal.record(() => {
      const back = this.zoneArray(toOwner, toZone);
      const i = back.indexOf(id);
      if (i >= 0) back.splice(i, 1);
      this.zoneArray(fromOwner, fromZone).splice(fromIndex, 0, id);
      c.zone = fromZone;
      c.owner = fromOwner;
    });
    this.emit("card-moved", {
      card: id,
      fromZone,
      toZone,
      fromIndex,
      toIndex: insertAt
    }, cause);
  }
  /** [CR 1.12.1] Compra: topo do deck para a mao, uma carta por vez [CR 1.12.2]. */
  draw(p, count = 1, cause = {}) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      const deck = this.zoneArray(p, "deck");
      const id = deck[0];
      if (id === void 0) break;
      this.moveCard(id, p, "hand", null, { rule: "CR 1.12.1", ...cause });
      const c = this.card(id);
      const wasFaceDown = c.faceDown;
      this.journal.record(() => {
        c.faceDown = wasFaceDown;
      });
      c.faceDown = false;
      drawn.push(id);
    }
    return drawn;
  }
  /** [CR 2.2.1.2] Embaralhar e irreversivel [CR 1.7.6.2]. */
  shuffleDeck(p, cause = {}) {
    const deck = this.zoneArray(p, "deck");
    this.gameRng.shuffle(deck);
    this.journal.markIrreversible("embaralhar o deck nao pode ser desfeito [CR 1.7.6.2]");
    this.emit("deck-shuffled", { player: p, size: deck.length }, cause);
  }
};

// src/engine/setup.ts
function newPlayerState(id) {
  return {
    id,
    lore: 0,
    deck: [],
    hand: [],
    play: [],
    inkwell: [],
    discard: [],
    under: [],
    inkedThisTurn: 0,
    challengesThisTurn: 0,
    inkLimitThisTurn: 1,
    hasAlteredHand: false,
    hasConceded: false
  };
}
function newCardInstance(id, defId, owner) {
  return {
    id,
    defId,
    owner,
    zone: "deck",
    exerted: false,
    damage: 0,
    drying: false,
    faceDown: true,
    onTopOf: null,
    atLocation: null,
    boostedThisTurn: false,
    abilitiesUsedThisTurn: [],
    playedViaShift: false
  };
}
function createGame(opts) {
  const state = {
    cards: /* @__PURE__ */ new Map(),
    bag: [],
    continuousEffects: [],
    players: [newPlayerState(0), newPlayerState(1)],
    startingPlayer: 0,
    activePlayer: 0,
    turnNumber: 0,
    phase: "setup",
    startStep: null,
    winner: null,
    endReason: null
  };
  const game = new Game(opts.defs, state, opts.seed);
  let nextId = 1;
  for (const p of [0, 1]) {
    const list = opts.decks[p];
    for (const [defId, qty] of Object.entries(list.cards)) {
      if (!opts.defs.has(defId)) throw new Error(`definicao ausente: ${defId}`);
      for (let i = 0; i < qty; i++) {
        const id = nextId++;
        state.cards.set(id, newCardInstance(id, defId, p));
        state.players[p].deck.push(id);
      }
    }
  }
  const starting = opts.startingPlayer ?? game.gameRng.int(2);
  state.startingPlayer = starting;
  state.activePlayer = starting;
  game.emit("starting-player", { player: starting }, { rule: "CR 2.2.1.1" });
  game.shuffleDeck(0, { rule: "CR 2.2.1.2" });
  game.shuffleDeck(1, { rule: "CR 2.2.1.2" });
  game.emit("setup-complete", {}, { rule: "CR 2.2.1" });
  return game;
}

// src/engine/types.ts
function otherPlayer(p) {
  return p === 0 ? 1 : 0;
}

// src/engine/bag.ts
var nextTriggerId = 1;
function addTrigger(game, controller, label, resolve, source = null) {
  const trigger = {
    id: nextTriggerId++,
    controller,
    source,
    label,
    resolve
  };
  const bag = game.state.bag;
  bag.push(trigger);
  game.journal.record(() => {
    const i = bag.indexOf(trigger);
    if (i >= 0) bag.splice(i, 1);
  });
  game.emit("trigger-added", { trigger: trigger.id, label, controller, source }, {
    rule: "CR 1.7.4",
    source: source ?? void 0
  });
  return trigger;
}
function bagIsEmpty(game) {
  return game.state.bag.length === 0;
}
function nextResolvingPlayer(game) {
  const active = game.state.activePlayer;
  if (game.state.bag.some((t) => t.controller === active)) return active;
  const other = otherPlayer(active);
  if (game.state.bag.some((t) => t.controller === other)) return other;
  return null;
}
function triggersOf(game, player) {
  return game.state.bag.filter((t) => t.controller === player);
}
function takeTrigger(game, trigger) {
  const bag = game.state.bag;
  const i = bag.indexOf(trigger);
  if (i < 0) throw new Error(`habilidade ${trigger.id} nao esta no bag`);
  bag.splice(i, 1);
  game.journal.record(() => {
    bag.splice(i, 0, trigger);
  });
}

// src/engine/checks.ts
var WIN_LORE = 20;
function banish(game, id, reason) {
  const card = game.card(id);
  const owner = card.owner;
  if (game.def(id).type === "location") {
    for (const other of [...game.player(owner).play]) {
      const inst = game.card(other);
      if (inst.atLocation === id) {
        const before = inst.atLocation;
        game.journal.record(() => {
          inst.atLocation = before;
        });
        inst.atLocation = null;
        game.emit("left-location", { card: other, location: id }, { rule: "CR 5.6.6" });
      }
    }
  }
  for (const other of [...game.player(owner).under]) {
    if (game.card(other).onTopOf === id) {
      game.moveCard(other, owner, "discard", null, { rule: "CR 5.1.1.7", action: reason });
    }
  }
  game.setDamage(id, 0, { rule: "CR 1.9.6" });
  game.moveCard(id, owner, "discard", null, { rule: "CR 1.8.1.4", action: reason });
  game.emit("banished", { card: id, reason }, { rule: "CR 1.8.1.4" });
  dispatch(game, { on: "banished", card: id, player: owner });
}
function collect(game, opts) {
  const results = [];
  const active = game.state.activePlayer;
  const order = active === 0 ? [0, 1] : [1, 0];
  for (const p of order) {
    if (game.player(p).lore >= WIN_LORE) {
      results.push({ player: p, kind: "win-lore" });
    }
    if (opts.endOfTurn && p === active && game.player(p).deck.length === 0) {
      results.push({ player: p, kind: "lose-empty-deck" });
    }
    for (const id of game.player(p).play) {
      const inst = game.card(id);
      const type = game.def(id).type;
      if (type !== "character" && type !== "location") continue;
      if (inst.damage >= willpowerOf(game, id)) {
        results.push({ player: p, kind: "banish", card: id });
      }
    }
  }
  return results;
}
function checkOnce(game, opts) {
  const results = collect(game, opts);
  if (results.length === 0) return false;
  game.emit("state-check", { conditions: results.length }, { rule: "CR 1.8" });
  for (const r of results) {
    if (game.state.winner !== null) break;
    switch (r.kind) {
      case "win-lore":
        game.endGame(r.player, `${WIN_LORE} ou mais de lore`, "CR 1.8.1.1");
        break;
      case "lose-empty-deck":
        game.endGame(
          r.player === 0 ? 1 : 0,
          "terminou o turno sem cartas no deck",
          "CR 1.8.1.2"
        );
        break;
      case "banish":
        if (game.card(r.card).zone === "play") {
          banish(game, r.card, "dano igual ou maior que a willpower");
        }
        break;
    }
  }
  return true;
}
function settle(game, opts = {}) {
  let guard = 0;
  for (; ; ) {
    if (++guard > 1e4) throw new Error("settle nao convergiu (loop infinito?)");
    while (checkOnce(game, opts)) {
      if (game.state.winner !== null) return;
    }
    if (game.state.winner !== null) return;
    if (opts.resolveBag === false) return;
    if (bagIsEmpty(game)) return;
    resolveOneTrigger(game);
  }
}
function resolveOneTrigger(game) {
  const player = nextResolvingPlayer(game);
  if (player === null) return;
  const candidates = triggersOf(game, player);
  const index = candidates.length === 1 ? 0 : game.decisions.orderTriggers(game, player, candidates);
  const chosen = candidates[index] ?? candidates[0];
  takeTrigger(game, chosen);
  game.emit("trigger-resolving", { trigger: chosen.id, label: chosen.label }, {
    rule: "CR 7.7",
    source: chosen.source ?? void 0
  });
  chosen.resolve(game);
}

// src/engine/keywords.ts
var avaliando = /* @__PURE__ */ new Set();
function keywordsOf(game, id) {
  const printed = game.def(id).keywords ?? [];
  const granted = [];
  if (!avaliando.has(id)) {
    avaliando.add(id);
    try {
      forEachStaticAffecting(game, id, (ability) => {
        if (ability.grantsKeywords) granted.push(...ability.grantsKeywords);
      });
    } finally {
      avaliando.delete(id);
    }
  }
  for (const e of game.state.continuousEffects) {
    if (!e.grantedKeywords) continue;
    if (e.cards && !e.cards.includes(id)) continue;
    if (!e.cards) continue;
    granted.push(...e.grantedKeywords);
  }
  return [...printed, ...granted];
}
function hasKeyword(game, id, name) {
  return keywordsOf(game, id).some((k) => k.k === name);
}
function keywordValue(game, id, name) {
  let total = 0;
  for (const k of keywordsOf(game, id)) {
    if (k.k === name && "n" in k) total += k.n;
  }
  return total;
}
function bodyguardTargets(game, defender) {
  return game.player(defender).play.filter(
    (id) => game.def(id).type === "character" && game.card(id).exerted && hasKeyword(game, id, "bodyguard")
  );
}
function challengeRestriction(game, attacker, target) {
  const targetType = game.def(target).type;
  if (targetType === "character") {
    const podeAlcancarEvasive = hasKeyword(game, attacker, "evasive") || hasKeyword(game, attacker, "alert");
    if (hasKeyword(game, target, "evasive") && !podeAlcancarEvasive) {
      return { reason: "so personagens com Evasive podem desafiar Evasive", rule: "CR 8 Evasive" };
    }
    const guards = bodyguardTargets(game, game.card(target).owner);
    if (guards.length > 0 && !guards.includes(target)) {
      return { reason: "ha um personagem com Bodyguard que deve ser desafiado", rule: "CR 8 Bodyguard" };
    }
  }
  return null;
}
function canChallengeWhileDrying(game, id) {
  return hasKeyword(game, id, "rush");
}
function canQuest(game, id) {
  return !hasKeyword(game, id, "reckless");
}
function challengerBonus(game, id) {
  return keywordValue(game, id, "challenger");
}
function isWarded(game, id, chooser) {
  return game.card(id).owner !== chooser && hasKeyword(game, id, "ward");
}
function singCapacity(game, id) {
  const singer = keywordValue(game, id, "singer");
  return singer > 0 ? singer : game.def(id).cost;
}

// src/engine/damage.ts
function damageReplacementsFor(game, target) {
  if (game.card(target).zone !== "play") return [];
  const found = /* @__PURE__ */ new Map();
  const resist = keywordValue(game, target, "resist");
  if (resist > 0) {
    found.set(`resist:${resist}`, { signature: `resist:${resist}`, source: target, reduceBy: resist });
  }
  for (const ability of staticAbilities(game, target)) {
    if (ability.replaceDamage === void 0) continue;
    const signature = `${ability.text ?? "resist"}:${ability.replaceDamage}`;
    if (!found.has(signature)) {
      found.set(signature, { signature, source: target, reduceBy: ability.replaceDamage });
    }
  }
  return [...found.values()];
}
function isDamagePrevented(game, target, opts) {
  let prevenido = false;
  forEachStaticAffecting(game, target, (ability) => {
    if (!ability.preventDamage) return;
    if (ability.preventDamage.unlessChallenged && opts.inChallenge) return;
    prevenido = true;
  });
  return prevenido;
}
function dealDamage(game, target, amount, cause = {}, opts = {}) {
  if (amount <= 0 || game.card(target).zone !== "play") {
    return { intended: amount, dealt: 0, wasDealt: amount > 0 };
  }
  if (isDamagePrevented(game, target, opts)) {
    game.emit("damage-prevented", { card: target, intended: amount }, {
      ...cause,
      rule: "CR 6.5"
    });
    return { intended: amount, dealt: 0, wasDealt: false };
  }
  let dealt = amount;
  for (const r of damageReplacementsFor(game, target)) {
    dealt = Math.max(0, dealt - r.reduceBy);
  }
  if (dealt > 0) {
    game.setDamage(target, game.card(target).damage + dealt, { ...cause, rule: "CR 1.9.2" });
  }
  game.emit("damage-dealt", { card: target, intended: amount, dealt }, {
    ...cause,
    rule: "CR 1.9.4"
  });
  if (dealt > 0 && cause.source !== void 0 && game.card(cause.source).zone === "play") {
    dispatch(game, {
      on: "dealsDamage",
      card: cause.source,
      player: game.card(cause.source).owner,
      damageAmount: dealt,
      inChallenge: opts.inChallenge === true
    });
  }
  return { intended: amount, dealt, wasDealt: true };
}
function removeDamage(game, target, amount, cause = {}) {
  const card = game.card(target);
  if (card.zone !== "play" || card.damage === 0) return 0;
  const removed = Math.min(amount, card.damage);
  game.setDamage(target, card.damage - removed, { ...cause, rule: "CR 1.9.3" });
  return removed;
}

// src/engine/modifiers.ts
function countFor(game, id, kind) {
  const owner = game.card(id).owner;
  const play = game.player(owner).play;
  if (typeof kind === "object") {
    switch (kind.of) {
      case "classificationYouControl":
        return play.filter((c) => game.def(c).type === "character" && game.def(c).classifications.includes(kind.value)).length;
    }
  }
  switch (kind) {
    case "cardsUnder":
      return game.player(owner).under.filter((c) => game.card(c).onTopOf === id).length;
    case "charactersYouControl":
      return play.filter((c) => game.def(c).type === "character").length;
    case "otherCharactersYouControl":
      return play.filter((c) => c !== id && game.def(c).type === "character").length;
    case "cardsInYourHand":
      return game.player(owner).hand.length;
    case "exertedCharactersYouControl":
      return play.filter((c) => game.def(c).type === "character" && game.card(c).exerted).length;
    case "challengesYouMadeThisTurn":
      return game.player(owner).challengesThisTurn;
  }
}
function resolveAmount(game, id, amount) {
  if (typeof amount === "number") return amount;
  return countFor(game, id, amount.perEach) * (amount.times ?? 1);
}
var nextEffectId = 1;
function addContinuousEffect(game, effect) {
  const created = { ...effect, id: nextEffectId++ };
  const list = game.state.continuousEffects;
  list.push(created);
  game.journal.record(() => {
    const i = list.indexOf(created);
    if (i >= 0) list.splice(i, 1);
  });
  game.emit("effect-created", {
    effect: created.id,
    label: created.label,
    duration: created.duration
  }, { source: created.source ?? void 0, rule: "CR 6.4.2" });
  return created;
}
function removeContinuousEffect(game, effect) {
  const list = game.state.continuousEffects;
  const i = list.indexOf(effect);
  if (i < 0) return;
  list.splice(i, 1);
  game.journal.record(() => {
    list.splice(i, 0, effect);
  });
  game.emit("effect-ended", { effect: effect.id, label: effect.label }, { rule: "CR 6.1.13" });
}
function expireThisTurnEffects(game) {
  for (const e of [...game.state.continuousEffects]) {
    if (e.duration === "thisTurn") removeContinuousEffect(game, e);
  }
}
function expireUntilYourNextTurn(game, active) {
  for (const e of [...game.state.continuousEffects]) {
    if (e.duration === "untilYourNextTurn" && e.controller === active) {
      removeContinuousEffect(game, e);
    }
  }
}
function isRestricted(game, id, what) {
  let porEstatica = false;
  forEachStaticAffecting(game, id, (ability) => {
    if (ability.restricts?.includes(what)) porEstatica = true;
  });
  if (porEstatica) return true;
  for (const e of game.state.continuousEffects) {
    if (!e.restricts?.includes(what)) continue;
    if (!isLive(game, e)) continue;
    if (affectsCard(game, e, id)) return true;
  }
  return false;
}
function isLive(game, e) {
  if (e.duration !== "whileSourceInPlay") return true;
  return e.source !== null && game.card(e.source).zone === "play";
}
function affectsCard(game, e, id) {
  if (e.cards) return e.cards.includes(id);
  if (!e.filter) return false;
  return eligible(game, e, id);
}
function eligible(game, e, id) {
  const spec = e.filter;
  const card = game.card(id);
  if (card.zone !== "play") return false;
  if (!spec.types.includes(game.def(id).type)) return false;
  if (spec.self) return id === e.source;
  if (spec.owner === "yours" && card.owner !== e.controller) return false;
  if (spec.owner === "opposing" && card.owner === e.controller) return false;
  for (const f of spec.filters ?? []) {
    switch (f.kind) {
      case "exerted":
        if (!card.exerted) return false;
        break;
      case "ready":
        if (card.exerted) return false;
        break;
      case "damaged":
        if (card.damage === 0) return false;
        break;
      case "costAtMost":
        if (game.def(id).cost > f.value) return false;
        break;
      case "classification":
        if (!game.def(id).classifications.includes(f.value)) return false;
        break;
    }
  }
  return true;
}
function modifierTotal(game, id, attr) {
  let total = 0;
  forEachStaticAffecting(game, id, (ability, source) => {
    for (const m of ability.modifiers ?? []) {
      if (m.attr === attr) total += resolveAmount(game, source, m.amount);
    }
  });
  for (const e of game.state.continuousEffects) {
    if (!isLive(game, e)) continue;
    if (!affectsCard(game, e, id)) continue;
    for (const m of e.modifiers) {
      if (m.attr === attr) total += resolveAmount(game, e.source ?? id, m.amount);
    }
  }
  return total;
}
function costModifiersFor(game, p, id) {
  let total = 0;
  const consumed = [];
  for (const e of game.state.continuousEffects) {
    if (!isLive(game, e) || e.controller !== p) continue;
    if (!e.filter) continue;
    const spec = e.filter;
    if (!spec.types.includes(game.def(id).type)) continue;
    if (spec.owner === "opposing") continue;
    if (!handMatchesFilters(game, id, spec.filters ?? [])) continue;
    const delta = e.modifiers.filter((m) => m.attr === "cost").reduce((sum, m) => sum + resolveAmount(game, e.source ?? id, m.amount), 0);
    if (delta === 0) continue;
    total += delta;
    if (e.usesRemaining != null) consumed.push(e);
  }
  return { total, consumed };
}
function handMatchesFilters(game, id, filters) {
  const def2 = game.def(id);
  for (const f of filters) {
    switch (f.kind) {
      case "costAtMost":
        if (def2.cost > f.value) return false;
        break;
      case "classification":
        if (!def2.classifications.includes(f.value)) return false;
        break;
      case "classificationAny":
        if (!f.values.some((v) => def2.classifications.includes(v))) return false;
        break;
      case "exerted":
      case "ready":
      case "damaged":
        return false;
    }
  }
  return true;
}
function consumeUses(game, effects) {
  for (const e of effects) {
    if (e.usesRemaining == null) continue;
    const before = e.usesRemaining;
    game.journal.record(() => {
      e.usesRemaining = before;
    });
    e.usesRemaining = before - 1;
    if (e.usesRemaining <= 0) removeContinuousEffect(game, e);
  }
}

// src/engine/effects.ts
function forcaAtual(game, id) {
  return (game.def(id).strength ?? 0) + modifierTotal(game, id, "strength");
}
var dispatchPlayedHook = null;
function setDispatchPlayedHook(fn) {
  dispatchPlayedHook = fn;
}
function dispatchPlayed(game, card, player) {
  dispatchPlayedHook?.(game, card, player);
}
function matchesFilter(game, id, f, source) {
  const card = game.card(id);
  switch (f.kind) {
    case "exerted":
      return card.exerted;
    case "ready":
      return !card.exerted;
    case "damaged":
      return card.damage > 0;
    case "costAtMost":
      return game.def(id).cost <= f.value;
    case "classification":
      return game.def(id).classifications.includes(f.value);
    case "classificationAny":
      return f.values.some((v) => game.def(id).classifications.includes(v));
    case "hasKeyword":
      return hasKeyword(game, id, f.value);
    case "strengthAtMost":
      return forcaAtual(game, id) <= f.value;
    case "strengthAtLeast":
      return forcaAtual(game, id) >= f.value;
    // Sem fonte conhecida, o filtro nao pode ser satisfeito: falha FECHADA.
    case "atSourceLocation":
      return source !== null && card.atLocation === source;
    case "otherThanSource":
      return source !== null && id !== source;
  }
}
function eligibleTargets(game, ctx, spec) {
  if (spec.self) {
    if (ctx.source === null) return [];
    return game.card(ctx.source).zone === "play" ? [ctx.source] : [];
  }
  const owners = spec.owner === "yours" ? [ctx.controller] : spec.owner === "opposing" ? [otherPlayer(ctx.controller)] : [ctx.controller, otherPlayer(ctx.controller)];
  const out = [];
  for (const p of owners) {
    for (const id of game.player(p).play) {
      if (!spec.types.includes(game.def(id).type)) continue;
      if (isWarded(game, id, ctx.controller)) continue;
      if ((spec.filters ?? []).some((f) => !matchesFilter(game, id, f, ctx.source))) continue;
      out.push(id);
    }
  }
  return out;
}
function pickTargets(game, ctx, spec) {
  if (spec.bound) return (ctx.bound ?? []).filter((id) => game.card(id).zone === "play");
  const pool = eligibleTargets(game, ctx, spec);
  if (spec.count === "all") return applyVanish(game, ctx, pool);
  if (spec.self) return pool;
  const want = Math.min(spec.count, pool.length);
  if (want === 0) return [];
  if (pool.length === want && !spec.upTo) return applyVanish(game, ctx, pool);
  const chosen = game.decisions.chooseTargets(game, ctx.controller, {
    spec,
    pool,
    max: want,
    min: spec.upTo ? 0 : want,
    label: ctx.label
  });
  if (chosen.length > want) {
    throw new IllegalActionError(`escolhidos ${chosen.length} alvos, maximo ${want}`, "CR 6.1.8");
  }
  if (!spec.upTo && chosen.length < want) {
    throw new IllegalActionError(`escolhidos ${chosen.length} alvos, exigidos ${want}`, "CR 6.1.8");
  }
  for (const id of chosen) {
    if (!pool.includes(id)) {
      throw new IllegalActionError(`alvo ilegal: ${id}`, "CR 1.7.7");
    }
  }
  return applyVanish(game, ctx, chosen);
}
function applyVanish(game, ctx, chosen) {
  for (const id of chosen) {
    if (game.card(id).owner === ctx.controller) continue;
    if (!hasKeyword(game, id, "vanish")) continue;
    banish(game, id, "Vanish");
  }
  return chosen;
}
function execute(game, effect, ctx) {
  if (game.state.winner !== null) return false;
  const cause = { source: ctx.source ?? void 0, action: ctx.label };
  const you = ctx.controller;
  const foe = otherPlayer(you);
  switch (effect.kind) {
    case "sequence": {
      let any = false;
      for (const e of effect.effects) any = execute(game, e, ctx) || any;
      return any;
    }
    // [CR 6.1.7] "Voce pode": o dono do efeito pode recusar.
    case "optional": {
      if (!game.decisions.confirmOptional(game, you, ctx.label)) {
        game.emit("effect-declined", { label: ctx.label }, { ...cause, rule: "CR 6.1.7" });
        return false;
      }
      return execute(game, effect.effect, ctx);
    }
    // [CR 6.1.5] "[A]. If you do, [B]" — B so acontece se A aconteceu.
    case "ifYouDo": {
      const did = execute(game, effect.first, ctx);
      if (!did) return false;
      execute(game, effect.then, ctx);
      return true;
    }
    // [CR 6.1.5] "[A] or [B]" — o dono escolhe um.
    case "choose": {
      const i = game.decisions.chooseOption(
        game,
        you,
        effect.options.map((o) => o.label),
        ctx.label
      );
      const picked = effect.options[i];
      if (!picked) throw new IllegalActionError(`opcao invalida: ${i}`, "CR 1.7.7");
      game.emit("option-chosen", { label: picked.label }, { ...cause, rule: "CR 6.1.5" });
      return execute(game, picked.effect, ctx);
    }
    case "dealDamage": {
      const amount = typeof effect.amount === "number" ? effect.amount : ctx.triggerDamage ?? 0;
      if (amount <= 0) return false;
      const targets = pickTargets(game, ctx, effect.target);
      let any = false;
      for (const id of targets) {
        if (dealDamage(game, id, amount, cause).wasDealt) any = true;
      }
      return any;
    }
    /**
     * [CR 1.9.1] Colocar contadores NAO e causar dano: nao emite "damage-dealt",
     * entao gatilhos de dano nao disparam. E a diferenca em relacao a dealDamage e
     * o motivo de ser um atomo proprio em vez de reuso.
     */
    case "putDamageCounters": {
      if (effect.amount <= 0) return false;
      const targets = pickTargets(game, ctx, effect.target);
      let any = false;
      for (const id of targets) {
        if (game.card(id).zone !== "play") continue;
        game.setDamage(id, game.card(id).damage + effect.amount, {
          ...cause,
          rule: "CR 1.9.1"
        });
        any = true;
      }
      return any;
    }
    case "removeDamage": {
      const targets = pickTargets(game, ctx, effect.target);
      let any = false;
      for (const id of targets) {
        if (removeDamage(game, id, effect.amount, cause) > 0) any = true;
      }
      return any;
    }
    case "banish": {
      const targets = pickTargets(game, ctx, effect.target);
      let any = false;
      for (const id of targets) {
        if (game.card(id).zone !== "play") continue;
        banish(game, id, ctx.label);
        any = true;
      }
      return any;
    }
    case "exert":
    case "ready": {
      const value = effect.kind === "exert";
      const targets = pickTargets(game, ctx, effect.target);
      let any = false;
      for (const id of targets) {
        if (game.card(id).zone !== "play" || game.card(id).exerted === value) continue;
        game.setExerted(id, value, cause);
        any = true;
      }
      return any;
    }
    case "returnToHand": {
      const targets = pickTargets(game, ctx, effect.target);
      let any = false;
      for (const id of targets) {
        const card = game.card(id);
        if (card.zone !== "play") continue;
        game.setDamage(id, 0, { ...cause, rule: "CR 1.9.6" });
        game.moveCard(id, card.owner, "hand", null, cause);
        any = true;
      }
      return any;
    }
    case "draw": {
      const p = effect.who === "you" ? you : foe;
      return game.draw(p, effect.amount, cause).length > 0;
    }
    case "discard": {
      const p = effect.who === "you" ? you : foe;
      let any = false;
      for (let i = 0; i < effect.amount; i++) {
        const hand = game.player(p).hand;
        if (hand.length === 0) break;
        const id = game.decisions.chooseCardInHand(game, p, hand, ctx.label);
        if (!hand.includes(id)) throw new IllegalActionError(`carta ${id} nao esta na mao`, "CR 1.7.7");
        game.moveCard(id, p, "discard", null, cause);
        any = true;
      }
      return any;
    }
    case "gainLore": {
      const p = effect.who === "you" ? you : foe;
      game.addLore(p, effect.amount, cause);
      return effect.amount > 0;
    }
    case "modify": {
      const targets = pickTargets(game, ctx, effect.target);
      if (targets.length === 0) return false;
      addContinuousEffect(game, {
        label: effect.label ?? ctx.label,
        source: ctx.source,
        controller: you,
        modifiers: effect.modifiers,
        duration: effect.duration,
        cards: targets
        // lista travada: e o que define "aplicado"
      });
      return true;
    }
    case "modifyCost": {
      addContinuousEffect(game, {
        label: effect.label ?? ctx.label,
        source: ctx.source,
        controller: you,
        modifiers: [{ attr: "cost", amount: effect.amount }],
        duration: effect.duration,
        filter: effect.filter,
        usesRemaining: effect.uses ?? null
      });
      return true;
    }
    // [CR 1.11.1] Lore nunca fica negativo; addLore ja trata o piso.
    case "loseLore": {
      const p = effect.who === "you" ? you : foe;
      const before = game.player(p).lore;
      game.addLore(p, -effect.amount, cause);
      return game.player(p).lore !== before;
    }
    /**
     * [CR 1.9.5] Mover dano nao e causar dano: nao passa por substituicoes e
     * nao dispara gatilhos de "causar dano". E por isso que e um atomo proprio
     * em vez de removeDamage + dealDamage.
     */
    case "moveDamage": {
      const origens = pickTargets(game, ctx, effect.from);
      const destinos = pickTargets(game, ctx, effect.to);
      const origem = origens[0];
      const destino = destinos[0];
      if (origem === void 0 || destino === void 0) return false;
      const disponivel = game.card(origem).damage;
      const quantidade = effect.upTo ? Math.min(effect.amount, disponivel) : effect.amount;
      if (quantidade <= 0 || disponivel < quantidade) return false;
      game.setDamage(origem, disponivel - quantidade, { ...cause, rule: "CR 1.9.5" });
      game.setDamage(destino, game.card(destino).damage + quantidade, {
        ...cause,
        rule: "CR 1.9.5"
      });
      game.emit("damage-moved", { from: origem, to: destino, amount: quantidade }, {
        ...cause,
        rule: "CR 1.9.5"
      });
      return true;
    }
    case "millTop": {
      const p = effect.who === "you" ? you : foe;
      let any = false;
      for (let i = 0; i < effect.amount; i++) {
        const deck = game.player(p).deck;
        if (deck.length === 0) break;
        game.moveCard(deck[0], p, "discard", null, cause);
        any = true;
      }
      return any;
    }
    case "revealTop": {
      const alvos = effect.who === "each" ? [you, foe] : effect.who === "you" ? [you] : [foe];
      let any = false;
      for (const p of alvos) {
        const deck = game.player(p).deck;
        const topo = deck[0];
        if (topo === void 0) continue;
        game.emit("card-revealed", { card: topo, player: p }, { ...cause, rule: "CR 6.1.14" });
        game.journal.markIrreversible("revelar uma carta nao pode ser desfeito [CR 1.7.6.2]");
        any = true;
        const outcome = effect.then;
        if (!outcome) continue;
        if (matchesPredicate(game, topo, outcome.ifMatches) && game.decisions.confirmOptional(game, p, ctx.label)) {
          game.moveCard(topo, p, "hand", null, cause);
        } else {
          const destino = outcome.otherwise === "bottom" ? game.player(p).deck.length : 0;
          game.moveCard(topo, p, "deck", destino, cause);
        }
      }
      return any;
    }
    case "lookAtTop": {
      const p = effect.who === "you" ? you : foe;
      const olhadas = game.player(p).deck.slice(0, effect.amount);
      if (olhadas.length === 0) return false;
      const elegiveis = olhadas.filter(
        (c) => !effect.take.predicate || matchesPredicate(game, c, effect.take.predicate)
      );
      const max = Math.min(effect.take.count, elegiveis.length);
      let escolhidas = [];
      if (max > 0) {
        escolhidas = game.decisions.chooseFromCards(game, p, {
          pool: elegiveis,
          max,
          min: effect.take.upTo ? 0 : max,
          label: ctx.label
        });
        for (const id of escolhidas) {
          if (!elegiveis.includes(id)) {
            throw new IllegalActionError(`carta ilegal: ${id}`, "CR 1.7.7");
          }
          game.moveCard(id, p, "hand", null, cause);
        }
      }
      for (const id of olhadas) {
        if (escolhidas.includes(id)) continue;
        const destino = effect.rest === "bottom" ? game.player(p).deck.length : 0;
        game.moveCard(id, p, "deck", destino, cause);
      }
      return true;
    }
    case "drawUntil": {
      const alvos = effect.who === "each" ? [you, foe] : effect.who === "you" ? [you] : [foe];
      let any = false;
      for (const p of alvos) {
        const faltam = effect.size - game.player(p).hand.length;
        if (faltam > 0 && game.draw(p, faltam, cause).length > 0) any = true;
      }
      return any;
    }
    case "bindTarget": {
      const alvos = pickTargets(game, ctx, effect.target);
      if (alvos.length === 0) return false;
      return execute(game, effect.then, { ...ctx, bound: alvos });
    }
    case "toDeck": {
      const alvos = pickTargets(game, ctx, effect.target);
      let any = false;
      for (const id of alvos) {
        const dono = game.card(id).owner;
        if (game.card(id).zone !== "play") continue;
        game.setDamage(id, 0, { ...cause, rule: "CR 1.9.6" });
        const pos = effect.position === "bottom" ? game.player(dono).deck.length : 0;
        game.moveCard(id, dono, "deck", pos, cause);
        any = true;
      }
      return any;
    }
    case "opponentChooses": {
      const i = game.decisions.chooseOption(
        game,
        foe,
        effect.options.map((o) => o.label),
        ctx.label
      );
      const escolhida = effect.options[i];
      if (!escolhida) throw new IllegalActionError(`opcao invalida: ${i}`, "CR 1.7.7");
      game.emit("opponent-chose", { label: escolhida.label }, { ...cause, rule: "CR 6.1.5" });
      return execute(game, escolhida.effect, ctx);
    }
    case "mayPayInk": {
      const prontas = game.player(you).inkwell.filter((c) => !game.card(c).exerted);
      if (prontas.length < effect.amount) return false;
      if (!game.decisions.confirmOptional(game, you, ctx.label)) {
        game.emit("effect-declined", { label: ctx.label }, { ...cause, rule: "CR 6.1.7" });
        return false;
      }
      for (let i = 0; i < effect.amount; i++) {
        game.setExerted(prontas[i], true, { ...cause, rule: "CR 4.3.5" });
      }
      return execute(game, effect.then, ctx);
    }
    case "restrict": {
      addContinuousEffect(game, {
        label: effect.label ?? ctx.label,
        source: ctx.source,
        controller: you,
        modifiers: [],
        duration: effect.duration,
        filter: effect.filter,
        restricts: effect.what
      });
      return true;
    }
    case "grantKeywords": {
      const alvos = pickTargets(game, ctx, effect.target);
      if (alvos.length === 0) return false;
      addContinuousEffect(game, {
        label: effect.label ?? ctx.label,
        source: ctx.source,
        controller: you,
        modifiers: [],
        duration: effect.duration,
        cards: alvos,
        grantedKeywords: effect.keywords
      });
      return true;
    }
    case "grantTriggered": {
      const alvos = pickTargets(game, ctx, effect.target);
      if (alvos.length === 0) return false;
      addContinuousEffect(game, {
        label: effect.label ?? ctx.label,
        source: ctx.source,
        controller: you,
        modifiers: [],
        duration: effect.duration,
        cards: alvos,
        grantedAbilities: effect.abilities
      });
      return true;
    }
    /**
     * [CR 4.3.4] Jogar de graca continua sendo JOGAR: entra secando e dispara
     * os gatilhos de "ao ser jogada". So o pagamento e dispensado.
     */
    case "playFree": {
      const p = effect.who === "you" ? you : foe;
      const elegiveis = game.player(p).hand.filter(
        (id2) => matchesPredicate(game, id2, effect.predicate)
      );
      if (elegiveis.length === 0) return false;
      if (effect.optional && !game.decisions.confirmOptional(game, p, ctx.label)) return false;
      const escolhidas = game.decisions.chooseFromCards(game, p, {
        pool: elegiveis,
        max: 1,
        min: 1,
        label: ctx.label
      });
      const id = escolhidas[0];
      if (id === void 0 || !elegiveis.includes(id)) {
        throw new IllegalActionError("carta ilegal para jogar de graca", "CR 1.7.7");
      }
      game.moveCard(id, p, "play", null, { ...cause, rule: "CR 4.3.4" });
      const inst = game.card(id);
      const antes = inst.faceDown;
      game.journal.record(() => {
        inst.faceDown = antes;
      });
      inst.faceDown = false;
      if (game.def(id).type === "character") {
        game.setDrying(id, true, { ...cause, rule: "CR 5.1.1.11" });
      }
      game.emit("card-played", { card: id, free: true }, { ...cause, rule: "CR 4.3.4" });
      dispatchPlayed(game, id, p);
      return true;
    }
    case "forceDiscard": {
      const mao = game.player(foe).hand;
      if (effect.revealHand) {
        game.emit("hand-revealed", { player: foe, count: mao.length }, {
          ...cause,
          rule: "CR 6.1.14"
        });
        game.journal.markIrreversible("revelar a mao nao pode ser desfeito [CR 1.7.6.2]");
      }
      let any = false;
      for (let i = 0; i < effect.amount; i++) {
        const elegiveis = game.player(foe).hand.filter(
          (id) => !effect.predicate || matchesPredicate(game, id, effect.predicate)
        );
        if (elegiveis.length === 0) break;
        const escolhida = game.decisions.chooseFromCards(game, you, {
          pool: elegiveis,
          max: 1,
          min: 1,
          label: ctx.label
        })[0];
        if (escolhida === void 0 || !elegiveis.includes(escolhida)) {
          throw new IllegalActionError("carta ilegal para descarte", "CR 1.7.7");
        }
        game.moveCard(escolhida, foe, "discard", null, cause);
        any = true;
      }
      return any;
    }
    case "ifCondition": {
      const referencia = ctx.source ?? game.player(you).play[0] ?? null;
      const ok = referencia !== null && checkCondition(game, referencia, effect.condition);
      if (ok) return execute(game, effect.then, ctx);
      if (effect.otherwise) return execute(game, effect.otherwise, ctx);
      return false;
    }
  }
}
function matchesPredicate(game, id, p) {
  const def2 = game.def(id);
  if (p.types && !p.types.includes(def2.type)) return false;
  if (p.costAtMost !== void 0 && def2.cost > p.costAtMost) return false;
  if (p.classification && !def2.classifications.includes(p.classification)) return false;
  return true;
}
function checkCondition(game, reference, c) {
  switch (c.kind) {
    case "sourcePlayedViaShift":
      return game.card(reference).playedViaShift;
    case "all":
      return c.of.every((sub) => checkCondition(game, reference, sub));
    case "countAtLeast":
      return countFor(game, reference, c.what) >= c.value;
    case "countAtMost":
      return countFor(game, reference, c.what) <= c.value;
  }
}

// src/engine/abilities.ts
function staticConditionMet(game, source, cond) {
  if (!cond) return true;
  const card = game.card(source);
  if (cond.selfExerted && !card.exerted) return false;
  if (cond.hasCardsUnder) {
    const has = game.player(card.owner).under.some((c) => game.card(c).onTopOf === source);
    if (!has) return false;
  }
  if (cond.handAtLeast !== void 0 && game.player(card.owner).hand.length < cond.handAtLeast) return false;
  if (cond.yourFirstTurnOnTheDraw) {
    const st = game.state;
    const naoInicial = card.owner !== st.startingPlayer;
    if (!(naoInicial && st.turnNumber === 2 && st.activePlayer === card.owner)) return false;
  }
  return true;
}
function staticAffects(game, source, ability, target) {
  if (!staticConditionMet(game, source, ability.while)) return false;
  const spec = ability.affects;
  if (!spec) return source === target;
  const alvo = game.card(target);
  if (alvo.zone !== "play") return false;
  if (!spec.types.includes(game.def(target).type)) return false;
  const dono = game.card(source).owner;
  if (spec.owner === "yours" && alvo.owner !== dono) return false;
  if (spec.owner === "opposing" && alvo.owner === dono) return false;
  if (spec.self && target !== source) return false;
  for (const f of spec.filters ?? []) {
    switch (f.kind) {
      case "classification":
        if (!game.def(target).classifications.includes(f.value)) return false;
        break;
      case "classificationAny":
        if (!f.values.some((v) => game.def(target).classifications.includes(v))) return false;
        break;
      case "costAtMost":
        if (game.def(target).cost > f.value) return false;
        break;
      case "exerted":
        if (!alvo.exerted) return false;
        break;
      case "ready":
        if (alvo.exerted) return false;
        break;
      case "damaged":
        if (alvo.damage === 0) return false;
        break;
      // "personagens aqui": so quem esta NO local que e a fonte.
      case "atSourceLocation":
        if (alvo.atLocation !== source) return false;
        break;
      case "otherThanSource":
        if (target === source) return false;
        break;
      case "hasKeyword":
        if (!keywordsOf(game, target).some((k) => k.k === f.value)) return false;
        break;
      // Forca MODIFICADA, igual ao mesmo filtro em effects.ts: personagem com +2
      // de um efeito deixa de ser alvo de "3 ou menos".
      case "strengthAtMost":
        if ((game.def(target).strength ?? 0) + modifierTotal(game, target, "strength") > f.value) return false;
        break;
      case "strengthAtLeast":
        if ((game.def(target).strength ?? 0) + modifierTotal(game, target, "strength") < f.value) return false;
        break;
      default: {
        const _exaustivo = f;
        void _exaustivo;
        return false;
      }
    }
  }
  return true;
}
function forEachStaticAffecting(game, target, fn) {
  for (const p of [0, 1]) {
    for (const source of game.player(p).play) {
      for (const ability of staticAbilities(game, source)) {
        if (staticAffects(game, source, ability, target)) fn(ability, source);
      }
    }
  }
}
function abilitiesOf(game, id) {
  return game.def(id).abilities ?? [];
}
function triggeredAbilities(game, id) {
  return abilitiesOf(game, id).filter((a) => a.kind === "triggered");
}
function grantedTriggersFor(game, id) {
  const out = [];
  for (const e of game.state.continuousEffects) {
    if (!e.grantedAbilities || !e.cards?.includes(id)) continue;
    if (e.duration === "whileSourceInPlay" && (e.source === null || game.card(e.source).zone !== "play")) continue;
    for (const ability of e.grantedAbilities) out.push({ ability, controller: e.controller });
  }
  return out;
}
function activatedAbilities(game, id) {
  const printed = abilitiesOf(game, id).filter((a) => a.kind === "activated");
  const granted = [];
  forEachStaticAffecting(game, id, (ability) => {
    if (ability.grantsAbilities) granted.push(...ability.grantsAbilities);
  });
  return [...printed, ...granted];
}
function staticAbilities(game, id) {
  return abilitiesOf(game, id).filter((a) => a.kind === "static");
}
function dispatch(game, ev) {
  const ouvintes = /* @__PURE__ */ new Set();
  if (ev.card !== void 0) ouvintes.add(ev.card);
  for (const p of [0, 1]) {
    for (const id of game.player(p).play) ouvintes.add(id);
  }
  for (const ouvinte of ouvintes) {
    const precisaEstarEmJogo = ev.on !== "played" && ev.on !== "banished";
    if (precisaEstarEmJogo && game.card(ouvinte).zone !== "play") continue;
    const candidatas = [
      ...triggeredAbilities(game, ouvinte).map((ability) => ({ ability, controller: game.card(ouvinte).owner })),
      ...grantedTriggersFor(game, ouvinte)
    ];
    for (const { ability, controller } of candidatas) {
      if (ability.when.on !== ev.on) continue;
      if (ability.when.on === "dealsDamage" && ability.when.inChallenge && !ev.inChallenge) continue;
      if (!subjectMatches(game, ability, ouvinte, ev)) continue;
      const marca = 1e3 + triggeredAbilities(game, ouvinte).indexOf(ability);
      if (ability.oncePerTurn && game.card(ouvinte).abilitiesUsedThisTurn.includes(marca)) {
        continue;
      }
      const label = ability.text ?? `${game.def(ouvinte).fullName}: ${ev.on}`;
      addTrigger(game, controller, label, (g) => {
        const fez = execute(g, ability.effect, {
          controller,
          source: ouvinte,
          label,
          triggerDamage: ev.damageAmount
        });
        if (ability.oncePerTurn && fez) {
          const inst = g.card(ouvinte);
          const antes = inst.abilitiesUsedThisTurn;
          g.journal.record(() => {
            inst.abilitiesUsedThisTurn = antes;
          });
          inst.abilitiesUsedThisTurn = [...antes, marca];
        }
      }, ouvinte);
    }
  }
}
function subjectMatches(game, ability, listener, ev) {
  const subject = ability.subject ?? { scope: "self" };
  if (ev.card === void 0) {
    return game.card(listener).owner === ev.player;
  }
  if (subject.scope === "self") return ev.card === listener;
  const actor = ev.card;
  if (subject.scope === "yours" && game.card(actor).owner !== game.card(listener).owner) {
    return false;
  }
  if (subject.classification && !game.def(actor).classifications.includes(subject.classification)) {
    return false;
  }
  return true;
}
setDispatchPlayedHook((game, card, player) => {
  dispatch(game, { on: "played", card, player });
});

// src/engine/characteristics.ts
function strengthOf(game, id) {
  return (game.def(id).strength ?? 0) + modifierTotal(game, id, "strength");
}
function willpowerOf(game, id) {
  return (game.def(id).willpower ?? 0) + modifierTotal(game, id, "willpower");
}
function loreOf(game, id) {
  return Math.max(0, (game.def(id).lore ?? 0) + modifierTotal(game, id, "lore"));
}
function damageDealtBy(game, id) {
  const fonte = challengeDamageSource(game, id);
  const valor = fonte === "willpower" ? willpowerOf(game, id) : strengthOf(game, id);
  return Math.max(0, valor);
}
function challengeDamageSource(game, id) {
  const alvo = game.card(id);
  if (alvo.zone !== "play") return "strength";
  for (const p of [0, 1]) {
    for (const fonte of game.player(p).play) {
      for (const ability of staticAbilities(game, fonte)) {
        if (!ability.challengeDamageFrom || !ability.affects) continue;
        const dono = game.card(fonte).owner;
        if (ability.affects.owner === "yours" && alvo.owner !== dono) continue;
        if (ability.affects.owner === "opposing" && alvo.owner === dono) continue;
        if (!ability.affects.types.includes(game.def(id).type)) continue;
        return ability.challengeDamageFrom;
      }
    }
  }
  return "strength";
}

// src/engine/turn.ts
function readyStep(game) {
  const p = game.state.activePlayer;
  game.setStateField("phase", "start");
  game.setStateField("startStep", "ready");
  game.emit("step-begin", { step: "ready", player: p }, { rule: "CR 3.2.1" });
  expireUntilYourNextTurn(game, p);
  for (const id of [...game.player(p).play, ...game.player(p).inkwell]) {
    if (isRestricted(game, id, "ready")) {
      game.emit("ready-prevented", { card: id }, { rule: "CR 1.4.3" });
    } else {
      game.setExerted(id, false, { rule: "CR 3.2.1.1" });
    }
    const inst = game.card(id);
    if (inst.boostedThisTurn) {
      game.journal.record(() => {
        inst.boostedThisTurn = true;
      });
      inst.boostedThisTurn = false;
    }
    if (inst.abilitiesUsedThisTurn.length > 0) {
      const antes = inst.abilitiesUsedThisTurn;
      game.journal.record(() => {
        inst.abilitiesUsedThisTurn = antes;
      });
      inst.abilitiesUsedThisTurn = [];
    }
  }
  dispatch(game, { on: "startOfTurn", player: p });
  settle(game, { resolveBag: false });
}
function setStep(game) {
  if (game.state.winner !== null) return;
  const p = game.state.activePlayer;
  game.setStateField("startStep", "set");
  game.emit("step-begin", { step: "set", player: p }, { rule: "CR 3.2.2" });
  for (const id of game.player(p).play) {
    if (game.card(id).drying) game.setDrying(id, false, { rule: "CR 3.2.2.1" });
  }
  for (const id of game.player(p).play) {
    if (game.def(id).type !== "location") continue;
    const amount = loreOf(game, id);
    if (amount > 0) {
      game.addLore(p, amount, { rule: "CR 3.2.2.2", source: id });
    }
  }
  settle(game);
}
function drawStep(game) {
  if (game.state.winner !== null) return;
  const st = game.state;
  const p = st.activePlayer;
  game.setStateField("startStep", "draw");
  game.emit("step-begin", { step: "draw", player: p }, { rule: "CR 3.2.3" });
  const firstTurnOfGame = st.turnNumber === 1 && p === st.startingPlayer;
  if (firstTurnOfGame) {
    game.emit("draw-skipped", { player: p }, { rule: "CR 3.2.3.1" });
  } else {
    game.draw(p, 1, { rule: "CR 3.2.3.1" });
  }
  settle(game);
}
function beginTurn(game) {
  if (game.state.winner !== null) return;
  game.emit("turn-begin", {
    turn: game.state.turnNumber,
    player: game.state.activePlayer
  }, { rule: "CR 3.1.1" });
  readyStep(game);
  setStep(game);
  drawStep(game);
  if (game.state.winner !== null) return;
  game.setStateField("startStep", null);
  game.setStateField("phase", "main");
  game.emit("phase-begin", { phase: "main" }, { rule: "CR 3.3" });
}
function endTurn(game) {
  const st = game.state;
  if (st.winner !== null) return;
  const p = st.activePlayer;
  game.setStateField("phase", "end");
  game.emit("phase-begin", { phase: "end", player: p }, { rule: "CR 3.4" });
  dispatch(game, { on: "endOfTurn", player: p });
  settle(game);
  if (st.winner !== null) return;
  expireThisTurnEffects(game);
  if (st.winner !== null) return;
  settle(game, { endOfTurn: true });
  if (st.winner !== null) return;
  const next = otherPlayer(p);
  game.setPlayerField(p, "challengesThisTurn", 0);
  game.setPlayerField(next, "challengesThisTurn", 0);
  game.setPlayerField(next, "inkedThisTurn", 0);
  game.setPlayerField(next, "inkLimitThisTurn", 1);
  game.setStateField("activePlayer", next);
  game.setStateField("turnNumber", st.turnNumber + 1);
  game.emit("turn-end", { player: p, next }, { rule: "CR 3.4.2" });
  beginTurn(game);
}

// src/engine/mulligan.ts
var OPENING_HAND_SIZE = 7;
function drawOpeningHands(game) {
  const st = game.state;
  if (st.phase !== "setup") {
    throw new IllegalActionError("maos iniciais so podem ser compradas no setup");
  }
  const order = [st.startingPlayer, otherPlayer(st.startingPlayer)];
  for (const p of order) {
    game.draw(p, OPENING_HAND_SIZE, { rule: "CR 2.2.1.4" });
  }
  game.setStateField("phase", "mulligan");
  game.emit("opening-hands", { size: OPENING_HAND_SIZE }, { rule: "CR 2.2.1.4" });
}
function pendingAlter(game) {
  const st = game.state;
  const first = st.startingPlayer;
  const second = otherPlayer(first);
  if (!game.player(first).hasAlteredHand) return first;
  if (!game.player(second).hasAlteredHand) return second;
  return null;
}
function alterHand(game, p, cards) {
  const st = game.state;
  if (st.phase !== "mulligan") {
    throw new IllegalActionError("fora da etapa de alteracao de mao", "CR 2.2.2");
  }
  const expected = pendingAlter(game);
  if (expected !== p) {
    throw new IllegalActionError(
      `e a vez do jogador ${expected} alterar a mao`,
      "CR 2.2.2.2"
    );
  }
  game.transaction("alter-hand", () => {
    const hand = game.player(p).hand;
    for (const id of cards) {
      if (!hand.includes(id)) {
        throw new IllegalActionError(`carta ${id} nao esta na mao do jogador ${p}`);
      }
    }
    for (const id of cards) {
      const deck = game.player(p).deck;
      game.moveCard(id, p, "deck", deck.length, {
        rule: "CR 2.2.2.1",
        action: "alter-hand"
      });
      const inst = game.card(id);
      const before = inst.faceDown;
      game.journal.record(() => {
        inst.faceDown = before;
      });
      inst.faceDown = true;
    }
    const missing = OPENING_HAND_SIZE - game.player(p).hand.length;
    if (missing > 0) game.draw(p, missing, { rule: "CR 2.2.2.1" });
    game.setPlayerField(p, "hasAlteredHand", true);
    game.emit("hand-altered", { player: p, count: cards.length }, { rule: "CR 2.2.2.1" });
  });
  if (pendingAlter(game) === null) finishMulligan(game);
}
function finishMulligan(game) {
  const st = game.state;
  const order = [st.startingPlayer, otherPlayer(st.startingPlayer)];
  for (const p of order) {
    const altered = game.log.all().some(
      (e) => e.type === "hand-altered" && e.data.player === p && e.data.count > 0
    );
    if (altered) game.shuffleDeck(p, { rule: "CR 2.2.2.3" });
  }
  game.setStateField("turnNumber", 1);
  game.setStateField("activePlayer", st.startingPlayer);
  game.emit("game-begin", { startingPlayer: st.startingPlayer }, { rule: "CR 2.2.3" });
  beginTurn(game);
}

// src/engine/actions.ts
function requireMainPhase(game, p) {
  const st = game.state;
  if (st.winner !== null) throw new IllegalActionError("a partida ja terminou");
  if (st.phase !== "main") {
    throw new IllegalActionError(`turn action fora da fase principal (${st.phase})`, "CR 3.3");
  }
  if (st.activePlayer !== p) {
    throw new IllegalActionError("apenas o jogador ativo executa turn actions", "CR 4.1.1");
  }
  if (!bagIsEmpty(game)) {
    throw new IllegalActionError("ha habilidade esperando resolucao", "CR 4.1.2");
  }
}
function requireUsableCharacter(game, id, p, para = "cost") {
  const card = game.card(id);
  if (card.owner !== p) throw new IllegalActionError("a carta nao e sua");
  if (card.zone !== "play") throw new IllegalActionError("a carta nao esta em jogo");
  if (game.def(id).type !== "character") {
    throw new IllegalActionError("a carta nao e um personagem");
  }
  if (card.exerted) throw new IllegalActionError("o personagem esta exaurido", "CR 5.1.1.2");
  if (card.drying) {
    if (!(para === "challenge" && canChallengeWhileDrying(game, id))) {
      throw new IllegalActionError("a tinta do personagem ainda esta secando", "CR 5.1.1.11");
    }
  }
}
function inkCard(game, p, id) {
  requireMainPhase(game, p);
  game.transaction("ink-a-card", () => {
    const card = game.card(id);
    const player = game.player(p);
    if (card.owner !== p || card.zone !== "hand") {
      throw new IllegalActionError("a carta nao esta na sua mao");
    }
    if (player.inkedThisTurn >= player.inkLimitThisTurn) {
      throw new IllegalActionError("limite de tinta do turno atingido", "CR 4.2.3");
    }
    if (!game.def(id).inkwell) {
      throw new IllegalActionError("a carta nao tem simbolo de tinteiro", "CR 4.2.2");
    }
    game.emit("card-revealed", { card: id, reason: "ink" }, { rule: "CR 4.2.4" });
    game.journal.markIrreversible("revelar uma carta nao pode ser desfeito [CR 1.7.6.2]");
    game.moveCard(id, p, "inkwell", null, { rule: "CR 4.2.5", action: "ink-a-card" });
    const inst = game.card(id);
    const wasFaceDown = inst.faceDown;
    game.journal.record(() => {
      inst.faceDown = wasFaceDown;
    });
    inst.faceDown = true;
    game.setExerted(id, false, { rule: "CR 4.2.5" });
    game.setPlayerField(p, "inkedThisTurn", player.inkedThisTurn + 1);
  });
  settle(game);
}
function availableInk(game, p) {
  return game.player(p).inkwell.filter((id) => !game.card(id).exerted).length;
}
function payInk(game, p, amount, cause) {
  const ready = game.player(p).inkwell.filter((id) => !game.card(id).exerted);
  if (ready.length < amount) {
    throw new IllegalActionError(
      `tinta insuficiente: precisa de ${amount}, tem ${ready.length}`,
      "CR 4.3.5"
    );
  }
  for (let i = 0; i < amount; i++) {
    game.setExerted(ready[i], true, { rule: "CR 4.3.5", action: cause });
  }
}
function costToPlay(game, p, id) {
  const { total } = costModifiersFor(game, p, id);
  let proprio = 0;
  for (const ability of game.def(id).abilities ?? []) {
    if (ability.kind !== "static" || !ability.selfCost) continue;
    if (staticConditionMet(game, id, ability.selfCost.condition)) {
      proprio += ability.selfCost.amount;
    }
  }
  return Math.max(0, game.def(id).cost + total + proprio);
}
function playCard(game, p, id) {
  requireMainPhase(game, p);
  game.transaction("play-a-card", () => {
    const card = game.card(id);
    if (card.owner !== p || card.zone !== "hand") {
      throw new IllegalActionError("a carta nao esta na sua mao", "CR 4.3.1");
    }
    const def2 = game.def(id);
    const { consumed } = costModifiersFor(game, p, id);
    payInk(game, p, costToPlay(game, p, id), "play-a-card");
    consumeUses(game, consumed);
    game.moveCard(id, p, "play", null, { rule: "CR 4.3.6", action: "play-a-card" });
    const inst = game.card(id);
    const wasFaceDown = inst.faceDown;
    game.journal.record(() => {
      inst.faceDown = wasFaceDown;
    });
    inst.faceDown = false;
    if (def2.type === "character") {
      game.setDrying(id, true, { rule: "CR 5.1.1.11" });
      if (hasKeyword(game, id, "bodyguard") && game.decisions.confirmOptional(game, p, "entrar exaurido (Bodyguard)")) {
        game.setExerted(id, true, { rule: "CR 8 Bodyguard", action: "play-a-card" });
      }
    }
    game.emit("card-played", { card: id, type: def2.type, cost: def2.cost }, {
      rule: "CR 4.3",
      action: "play-a-card",
      source: id
    });
    dispatch(game, { on: "played", card: id, player: p });
    if (isSong(game, id)) dispatch(game, { on: "songPlayed", card: id, player: p });
    if (def2.type === "action") {
      game.moveCard(id, p, "discard", null, { rule: "CR 5.4.1.3", action: "play-a-card" });
    }
  });
  settle(game);
}
function quest(game, p, id) {
  requireMainPhase(game, p);
  game.transaction("quest", () => {
    requireUsableCharacter(game, id, p, "quest");
    if (isRestricted(game, id, "quest")) {
      throw new IllegalActionError("um efeito impede este personagem de fazer missao", "CR 1.4.3");
    }
    if (!canQuest(game, id)) {
      throw new IllegalActionError("personagem com Reckless nao pode fazer missao", "CR 8 Reckless");
    }
    game.setExerted(id, true, { rule: "CR 4.5.4", action: "quest" });
    const amount = loreOf(game, id);
    game.emit("quested", { card: id, lore: amount }, { rule: "CR 4.5", source: id });
    if (amount > 0) game.addLore(p, amount, { rule: "CR 4.5.5", source: id });
    if (hasKeyword(game, id, "support")) {
      const bonus = strengthOf(game, id);
      const outros = game.player(p).play.filter(
        (c) => c !== id && game.def(c).type === "character"
      );
      if (bonus > 0 && outros.length > 0) {
        const escolhido = outros.length === 1 ? outros[0] : game.decisions.chooseTargets(
          game,
          p,
          {
            spec: { count: 1, owner: "yours", types: ["character"] },
            pool: outros,
            max: 1,
            min: 1,
            label: "Support"
          }
        )[0];
        if (!outros.includes(escolhido)) {
          throw new IllegalActionError("alvo de Support ilegal", "CR 1.7.7");
        }
        addContinuousEffect(game, {
          label: "Support",
          source: id,
          controller: p,
          modifiers: [{ attr: "strength", amount: bonus }],
          duration: "thisTurn",
          cards: [escolhido]
        });
      }
    }
    dispatch(game, { on: "quests", card: id, player: p });
  });
  settle(game);
}
function challenge(game, p, attacker, target) {
  requireMainPhase(game, p);
  const opponent = otherPlayer(p);
  game.transaction("challenge", () => {
    requireUsableCharacter(game, attacker, p, "challenge");
    const targetCard = game.card(target);
    if (targetCard.owner !== opponent || targetCard.zone !== "play") {
      throw new IllegalActionError("o alvo nao e uma carta do oponente em jogo", "CR 4.6.5");
    }
    const targetType = game.def(target).type;
    if (targetType !== "character" && targetType !== "location") {
      throw new IllegalActionError("so personagens e locais podem ser desafiados", "CR 4.6.5");
    }
    if (targetType === "character" && !targetCard.exerted) {
      throw new IllegalActionError("o personagem alvo esta preparado", "CR 4.6.5.1");
    }
    if (isRestricted(game, attacker, "challenge")) {
      throw new IllegalActionError("um efeito impede este personagem de desafiar", "CR 1.4.3");
    }
    const restricao = challengeRestriction(game, attacker, target);
    if (restricao) throw new IllegalActionError(restricao.reason, restricao.rule);
    game.setExerted(attacker, true, { rule: "CR 4.6.6", action: "challenge" });
    game.emit("challenge-declared", { attacker, target, targetType }, {
      rule: "CR 4.6.6",
      source: attacker
    });
    game.setPlayerField(p, "challengesThisTurn", game.player(p).challengesThisTurn + 1);
    dispatch(game, { on: "challenges", card: attacker, player: p });
    if (targetType === "character") {
      dispatch(game, { on: "challenged", card: target, player: opponent });
    }
  });
  settle(game);
  if (game.state.winner !== null) return;
  if (game.card(attacker).zone !== "play" || game.card(target).zone !== "play") {
    game.emit("challenge-ended-early", { attacker, target }, { rule: "CR 4.6.9" });
    return;
  }
  game.transaction("challenge-damage", () => {
    const targetType = game.def(target).type;
    const dealtToTarget = Math.max(0, damageDealtBy(game, attacker) + challengerBonus(game, attacker));
    const dealtToAttacker = targetType === "location" ? 0 : damageDealtBy(game, target);
    if (dealtToTarget > 0) {
      dealDamage(game, target, dealtToTarget, {
        rule: "CR 4.6.7",
        source: attacker,
        action: "challenge-damage"
      }, { inChallenge: true });
    }
    if (dealtToAttacker > 0) {
      dealDamage(game, attacker, dealtToAttacker, {
        rule: "CR 4.6.7",
        source: target,
        action: "challenge-damage"
      }, { inChallenge: true });
    }
    game.emit("challenge-damage", {
      attacker,
      target,
      toTarget: dealtToTarget,
      toAttacker: dealtToAttacker
    }, { rule: "CR 4.6.7" });
  });
  settle(game);
}
function isSong(game, id) {
  return game.def(id).type === "action" && game.def(id).classifications.includes("Song");
}
function singSong(game, p, song, singers) {
  requireMainPhase(game, p);
  game.transaction("sing", () => {
    const card = game.card(song);
    if (card.owner !== p || card.zone !== "hand" || !isSong(game, song)) {
      throw new IllegalActionError("a carta nao e uma cancao na sua mao", "CR 4.3.1");
    }
    if (singers.length === 0) throw new IllegalActionError("nenhum cantor escolhido");
    if (new Set(singers).size !== singers.length) {
      throw new IllegalActionError("um cantor nao pode cantar duas vezes");
    }
    const together = game.def(song).keywords.find((k) => k.k === "singTogether");
    let capacidade = 0;
    for (const s of singers) {
      requireUsableCharacter(game, s, p, "cost");
      capacidade += singCapacity(game, s);
    }
    if (together) {
      if (singers.length < 2) {
        throw new IllegalActionError("Sing Together exige mais de um cantor", "CR 8 Sing Together");
      }
      if (capacidade < together.n) {
        throw new IllegalActionError(
          `capacidade ${capacidade} menor que Sing Together ${together.n}`,
          "CR 8 Sing Together"
        );
      }
    } else {
      if (singers.length !== 1) {
        throw new IllegalActionError("apenas cancoes com Sing Together aceitam varios cantores");
      }
      if (capacidade < game.def(song).cost) {
        throw new IllegalActionError(
          `o cantor so alcanca custo ${capacidade}`,
          "CR 8 Singer"
        );
      }
    }
    for (const s of singers) {
      game.setExerted(s, true, { rule: "CR 8 Singer", action: "sing" });
    }
    game.moveCard(song, p, "play", null, { rule: "CR 5.4.1.2", action: "sing" });
    const inst = game.card(song);
    const antes = inst.faceDown;
    game.journal.record(() => {
      inst.faceDown = antes;
    });
    inst.faceDown = false;
    game.emit("song-sung", { song, singers }, { rule: "CR 8 Singer", source: song });
    dispatch(game, { on: "played", card: song, player: p });
    dispatch(game, { on: "songPlayed", card: song, player: p });
    game.moveCard(song, p, "discard", null, { rule: "CR 5.4.1.3", action: "sing" });
  });
  settle(game);
}
function aceitaShift(game, id, onto) {
  if (shiftAnyNameHook?.(game.def(onto).defId)) return true;
  const nomes = new Set(game.def(id).names);
  return game.def(onto).names.some((n) => nomes.has(n));
}
var shiftAnyNameHook = null;
function playWithShift(game, p, id, onto) {
  requireMainPhase(game, p);
  const alvos = Array.isArray(onto) ? onto : [onto];
  game.transaction("shift", () => {
    const card = game.card(id);
    if (card.owner !== p || card.zone !== "hand") {
      throw new IllegalActionError("a carta nao esta na sua mao", "CR 4.3.1");
    }
    const combo = keywordsOf(game, id).find((k) => k.k === "comboShift");
    const shiftCost = combo ? combo.n : game.def(id).shift;
    if (shiftCost === null || shiftCost === void 0) {
      throw new IllegalActionError("a carta nao tem Shift", "CR 6.3");
    }
    if (alvos.length === 0) throw new IllegalActionError("nenhum alvo de Shift");
    if (alvos.length > 1 && !combo) {
      throw new IllegalActionError("so Combo Shift aceita mais de um alvo", "CR 8 Combo Shift");
    }
    if (new Set(alvos).size !== alvos.length) {
      throw new IllegalActionError("o mesmo personagem nao pode ser alvo duas vezes");
    }
    for (const alvoId of alvos) {
      const alvo = game.card(alvoId);
      if (alvo.owner !== p || alvo.zone !== "play" || game.def(alvoId).type !== "character") {
        throw new IllegalActionError("alvo de Shift invalido", "CR 5.1.1.5");
      }
      if (!aceitaShift(game, id, alvoId)) {
        throw new IllegalActionError("os nomes nao coincidem", "CR 5.2.6");
      }
    }
    if (alvos.length > 1) {
      const nomes = new Set(game.def(id).names);
      const casados = alvos.map((a) => game.def(a).names.find((n) => nomes.has(n)) ?? "");
      if (new Set(casados).size !== casados.length) {
        throw new IllegalActionError(
          "Combo Shift exige um personagem de cada nome",
          "CR 8 Combo Shift"
        );
      }
    }
    payInk(game, p, shiftCost, "shift");
    const damage = Math.max(...alvos.map((a) => game.card(a).damage));
    const exerted = alvos.some((a) => game.card(a).exerted);
    const atLocation = alvos.map((a) => game.card(a).atLocation).find((l) => l !== null) ?? null;
    for (const alvoId of alvos) {
      game.moveCard(alvoId, p, "under", null, { rule: "CR 5.1.1.5", action: "shift" });
      const under = game.card(alvoId);
      const beforeTop = under.onTopOf;
      game.journal.record(() => {
        under.onTopOf = beforeTop;
      });
      under.onTopOf = id;
      game.setDamage(alvoId, 0, { rule: "CR 5.1.1.5" });
    }
    game.moveCard(id, p, "play", null, { rule: "CR 5.1.1.6", action: "shift" });
    const top = game.card(id);
    const beforeFaceDown = top.faceDown;
    const beforeLoc = top.atLocation;
    game.journal.record(() => {
      top.faceDown = beforeFaceDown;
      top.atLocation = beforeLoc;
    });
    top.faceDown = false;
    top.atLocation = atLocation;
    game.setDamage(id, damage, { rule: "CR 5.1.1.6" });
    game.setExerted(id, exerted, { rule: "CR 5.1.1.6" });
    game.setDrying(id, false, { rule: "CR 5.1.1.6" });
    const beforeShiftFlag = top.playedViaShift;
    game.journal.record(() => {
      top.playedViaShift = beforeShiftFlag;
    });
    top.playedViaShift = true;
    game.emit("shifted", { card: id, onto: alvos.join(","), cost: shiftCost }, {
      rule: "CR 5.1.1.6",
      source: id,
      action: "shift"
    });
    dispatch(game, { on: "played", card: id, player: p });
  });
  settle(game);
}
function useAbility(game, p, id, index) {
  requireMainPhase(game, p);
  const ability = activatedAbilities(game, id)[index];
  if (!ability) throw new IllegalActionError("habilidade inexistente", "CR 6.3");
  game.transaction("use-ability", () => {
    const card = game.card(id);
    if (card.owner !== p || card.zone !== "play") {
      throw new IllegalActionError("a carta nao esta em jogo sob seu controle", "CR 4.4.2");
    }
    if (ability.cost.oncePerTurn && card.abilitiesUsedThisTurn.includes(index)) {
      throw new IllegalActionError("habilidade ja usada neste turno", "CR 6.1.13.2");
    }
    if (ability.cost.exertSelf) {
      if (card.exerted) {
        throw new IllegalActionError("a carta ja esta exaurida", "CR 6.3.1");
      }
      if (game.def(id).type === "character" && card.drying) {
        throw new IllegalActionError("a tinta ainda esta secando", "CR 6.3.1.1");
      }
    }
    if (ability.cost.ink) payInk(game, p, ability.cost.ink, "use-ability");
    if (ability.cost.exertSelf) {
      game.setExerted(id, true, { rule: "CR 6.3.1", action: "use-ability" });
    }
    if (ability.cost.banishSelf) {
      banishForCost(game, id);
    }
    if (ability.cost.oncePerTurn) {
      const antes = card.abilitiesUsedThisTurn;
      game.journal.record(() => {
        card.abilitiesUsedThisTurn = antes;
      });
      card.abilitiesUsedThisTurn = [...antes, index];
    }
    const label = ability.text ?? `${game.def(id).fullName}: habilidade`;
    game.emit("ability-activated", { card: id, index, label }, { rule: "CR 4.4", source: id });
    execute(game, ability.effect, { controller: p, source: id, label });
  });
  settle(game);
}
function banishForCost(game, id) {
  const owner = game.card(id).owner;
  game.setDamage(id, 0, { rule: "CR 1.9.6" });
  game.moveCard(id, owner, "discard", null, { rule: "CR 6.3.1", action: "cost" });
  game.emit("banished", { card: id, reason: "custo de habilidade" }, { rule: "CR 6.3.1" });
}
function moveToLocation(game, p, character, location) {
  requireMainPhase(game, p);
  game.transaction("move-to-location", () => {
    const char = game.card(character);
    if (char.owner !== p || char.zone !== "play" || game.def(character).type !== "character") {
      throw new IllegalActionError("personagem invalido", "CR 4.7.1");
    }
    const loc = game.card(location);
    if (loc.owner !== p || loc.zone !== "play" || game.def(location).type !== "location") {
      throw new IllegalActionError("local invalido", "CR 4.7.2");
    }
    if (char.atLocation === location) {
      throw new IllegalActionError("o personagem ja esta neste local");
    }
    const cost = game.def(location).moveCost ?? 0;
    payInk(game, p, cost, "move-to-location");
    const before = char.atLocation;
    game.journal.record(() => {
      char.atLocation = before;
    });
    char.atLocation = location;
    game.emit("moved-to-location", { card: character, location, cost, from: before }, {
      rule: "CR 4.7.4",
      action: "move-to-location"
    });
  });
  settle(game);
}
function legalActions(game) {
  const st = game.state;
  if (st.phase !== "main" || st.winner !== null) return [];
  const p = st.activePlayer;
  const me = game.player(p);
  const foe = game.player(otherPlayer(p));
  const out = [{ kind: "endTurn" }];
  const ink = availableInk(game, p);
  for (const id of me.hand) {
    if (me.inkedThisTurn < me.inkLimitThisTurn && game.def(id).inkwell) {
      out.push({ kind: "ink", card: id });
    }
    if (costToPlay(game, p, id) <= ink) out.push({ kind: "play", card: id });
    const combo = keywordsOf(game, id).find((k) => k.k === "comboShift");
    const shiftCost = combo ? combo.n : game.def(id).shift;
    if (shiftCost !== null && shiftCost !== void 0 && shiftCost <= ink) {
      const casaveis = me.play.filter(
        (a) => game.def(a).type === "character" && aceitaShift(game, id, a)
      );
      for (const alvo of casaveis) out.push({ kind: "shift", card: id, onto: alvo });
      if (combo) {
        const nomes = new Set(game.def(id).names);
        const nomeDe = (a) => game.def(a).names.find((n) => nomes.has(n)) ?? "";
        for (let i = 0; i < casaveis.length; i++) {
          for (let j = i + 1; j < casaveis.length; j++) {
            if (nomeDe(casaveis[i]) === nomeDe(casaveis[j])) continue;
            out.push({ kind: "shift", card: id, onto: [casaveis[i], casaveis[j]] });
          }
        }
      }
    }
  }
  const prontos = me.play.filter((id) => {
    const c = game.card(id);
    return game.def(id).type === "character" && !c.exerted && !c.drying;
  });
  for (const song of me.hand) {
    if (!isSong(game, song)) continue;
    if (game.def(song).keywords.some((k) => k.k === "singTogether")) continue;
    for (const s of prontos) {
      if (singCapacity(game, s) >= game.def(song).cost) {
        out.push({ kind: "sing", song, singers: [s] });
      }
    }
  }
  const usable = me.play.filter((id) => {
    const c = game.card(id);
    return game.def(id).type === "character" && !c.exerted && !c.drying;
  });
  const podeDesafiar = me.play.filter((id) => {
    const c = game.card(id);
    if (game.def(id).type !== "character" || c.exerted) return false;
    return !c.drying || canChallengeWhileDrying(game, id);
  });
  for (const id of usable) {
    if (canQuest(game, id) && !isRestricted(game, id, "quest")) {
      out.push({ kind: "quest", card: id });
    }
  }
  for (const id of podeDesafiar) {
    for (const target of foe.play) {
      const t = game.card(target);
      const type = game.def(target).type;
      const alvoValido = type === "character" && t.exerted || type === "location";
      if (!alvoValido) continue;
      if (isRestricted(game, id, "challenge")) continue;
      if (challengeRestriction(game, id, target)) continue;
      out.push({ kind: "challenge", attacker: id, target });
    }
  }
  for (const id of me.play) {
    const card = game.card(id);
    const type = game.def(id).type;
    const boost = keywordsOf(game, id).find((k) => k.k === "boost");
    if (boost && !card.boostedThisTurn && boost.n <= ink && me.deck.length > 0) {
      out.push({ kind: "boost", card: id });
    }
    activatedAbilities(game, id).forEach((ability, index) => {
      if (ability.cost.exertSelf) {
        if (card.exerted) return;
        if (type === "character" && card.drying) return;
      }
      if ((ability.cost.ink ?? 0) > ink) return;
      if (ability.cost.oncePerTurn && card.abilitiesUsedThisTurn.includes(index)) return;
      out.push({ kind: "ability", card: id, index });
    });
  }
  for (const id of me.play) {
    if (game.def(id).type !== "character") continue;
    for (const loc of me.play) {
      if (game.def(loc).type !== "location") continue;
      if (game.card(id).atLocation === loc) continue;
      if ((game.def(loc).moveCost ?? 0) <= ink) out.push({ kind: "move", character: id, location: loc });
    }
  }
  return out;
}
function applyAction(game, action) {
  const p = game.state.activePlayer;
  switch (action.kind) {
    case "ink":
      return inkCard(game, p, action.card);
    case "play":
      return playCard(game, p, action.card);
    case "quest":
      return quest(game, p, action.card);
    case "challenge":
      return challenge(game, p, action.attacker, action.target);
    case "move":
      return moveToLocation(game, p, action.character, action.location);
    case "ability":
      return useAbility(game, p, action.card, action.index);
    case "shift":
      return playWithShift(game, p, action.card, action.onto);
    case "sing":
      return singSong(game, p, action.song, action.singers);
    case "boost":
      return useBoost(game, p, action.card);
    case "endTurn":
      return;
  }
}
function useBoost(game, p, id) {
  requireMainPhase(game, p);
  const boost = keywordsOf(game, id).find((k) => k.k === "boost");
  if (!boost) throw new IllegalActionError("a carta nao tem Boost", "CR 8 Boost");
  game.transaction("boost", () => {
    const card = game.card(id);
    if (card.owner !== p || card.zone !== "play") {
      throw new IllegalActionError("a carta nao esta em jogo sob seu controle");
    }
    if (card.boostedThisTurn) {
      throw new IllegalActionError("Boost ja usado neste turno", "CR 8 Boost");
    }
    const deck = game.player(p).deck;
    if (deck.length === 0) {
      throw new IllegalActionError("deck vazio: nao ha carta para por sob o personagem");
    }
    payInk(game, p, boost.n, "boost");
    putUnder(game, deck[0], id, "boost");
    const before = card.boostedThisTurn;
    game.journal.record(() => {
      card.boostedThisTurn = before;
    });
    card.boostedThisTurn = true;
  });
  settle(game);
}
function putUnder(game, card, under, action) {
  const owner = game.card(under).owner;
  game.moveCard(card, owner, "under", null, { rule: "CR 5.1.1.5", action });
  const inst = game.card(card);
  const beforeTop = inst.onTopOf;
  const beforeFace = inst.faceDown;
  game.journal.record(() => {
    inst.onTopOf = beforeTop;
    inst.faceDown = beforeFace;
  });
  inst.onTopOf = under;
  inst.faceDown = true;
  game.emit("card-put-under", { card, under }, { rule: "CR 5.1.1.5", action, source: under });
  dispatch(game, { on: "cardPutUnder", card: under, player: owner });
}

// src/decks/parse.ts
function normalizeFullName(input) {
  return input.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u00A0\u2007\u202F]/g, " ").replace(/\s+-\s*|\s*-\s+/g, " - ").replace(/\s+/g, " ").trim();
}
var NAME_EXCEPTIONS = /* @__PURE__ */ new Set(["chip 'n' dale"]);
function namesOf(cardName) {
  const name = normalizeFullName(cardName);
  if (NAME_EXCEPTIONS.has(name.toLowerCase())) return [name];
  if (!name.includes("&")) return [name];
  const parts = name.split("&").map((s) => s.trim()).filter(Boolean);
  return [name, ...parts];
}
function splitFullName(fullName) {
  const normalized = normalizeFullName(fullName);
  const i = normalized.indexOf(" - ");
  if (i < 0) return { name: normalized, version: null };
  return {
    name: normalized.slice(0, i).trim(),
    version: normalized.slice(i + 3).trim()
  };
}

// src/tools/smoke-fixtures.ts
function def(defId, over) {
  const fullName = over.fullName ?? `${defId} - Teste`;
  const { name, version } = splitFullName(fullName);
  return {
    defId,
    name,
    version,
    fullName,
    names: namesOf(name),
    cost: 2,
    inkwell: true,
    inks: ["Amber"],
    type: "character",
    strength: 2,
    willpower: 2,
    lore: 1,
    moveCost: null,
    classifications: ["Storyborn"],
    shift: null,
    keywords: [],
    printedText: null,
    abilities: [],
    implemented: true,
    ...over
  };
}
function makeSmokeCatalog() {
  const defs = /* @__PURE__ */ new Map();
  for (let i = 1; i <= 10; i++) {
    defs.set(`c${i}`, def(`c${i}`, {
      fullName: `Carta ${i} - Teste`,
      cost: i % 5 + 1,
      strength: i % 4 + 1,
      willpower: i % 3 + 2,
      lore: i % 3,
      inkwell: i % 4 !== 0
    }));
  }
  defs.set("boost1", def("boost1", {
    fullName: "Impulso - Teste",
    cost: 3,
    keywords: [{ k: "boost", n: 1 }]
  }));
  defs.set("evasivo", def("evasivo", {
    fullName: "Evasivo - Teste",
    cost: 2,
    keywords: [{ k: "evasive" }]
  }));
  defs.set("guarda", def("guarda", {
    fullName: "Guarda - Teste",
    cost: 3,
    willpower: 4,
    keywords: [{ k: "bodyguard" }]
  }));
  defs.set("local", def("local", {
    fullName: "Lugar - Teste",
    type: "location",
    cost: 3,
    strength: null,
    willpower: 5,
    lore: 1,
    moveCost: 1,
    classifications: ["Location"]
  }));
  return defs;
}
function smokeDeck() {
  const cards = {};
  for (let i = 1; i <= 10; i++) cards[`c${i}`] = 4;
  cards["boost1"] = 4;
  cards["evasivo"] = 4;
  cards["guarda"] = 4;
  cards["local"] = 4;
  return { cards };
}

// web/trace.ts
function jogarPartida(seed, maxTurnos = 400) {
  const g = createGame({
    defs: makeSmokeCatalog(),
    decks: [smokeDeck(), smokeDeck()],
    seed,
    startingPlayer: 0
  });
  drawOpeningHands(g);
  alterHand(g, 0, []);
  alterHand(g, 1, []);
  let turnos = 0;
  while (g.state.winner === null && turnos < maxTurnos) {
    const acoes = legalActions(g);
    const escolha = acoes[g.botRng.int(acoes.length)];
    if (escolha.kind === "endTurn") {
      endTurn(g);
      turnos++;
      continue;
    }
    applyAction(g, escolha);
  }
  const eventos = g.log.all().map((e) => ({
    seq: e.seq,
    type: e.type,
    rule: e.cause.rule,
    texto: descrever(e.type, e.data)
  }));
  return {
    seed,
    vencedor: g.state.winner,
    motivo: g.state.endReason,
    turnos,
    eventos,
    loreFinal: [g.player(0).lore, g.player(1).lore]
  };
}
function descrever(type, data) {
  const partes = Object.entries(data).filter(([, v]) => v !== void 0 && v !== null).map(([k, v]) => `${k}=${String(v)}`);
  return partes.length > 0 ? partes.join(" ") : "\u2014";
}
if (typeof document === "undefined") {
  const r = jogarPartida("web-check");
  const vencedor = r.vencedor === null ? "ninguem" : `jogador ${r.vencedor}`;
  console.log(`bundle OK \u2014 seed ${r.seed}: ${vencedor} venceu (${r.motivo})`);
  console.log(`  ${r.turnos} turnos, ${r.eventos.length} eventos, lore ${r.loreFinal.join(" x ")}`);
} else {
  montarPagina();
}
function montarPagina() {
  const $ = (id) => document.getElementById(id);
  const seedInput = $("seed");
  const filtro = $("filtro");
  let atual = null;
  function render() {
    if (!atual) return;
    const vencedor = atual.vencedor === null ? "empate/limite" : `Jogador ${atual.vencedor}`;
    $("resultado").textContent = `${vencedor} \u2014 ${atual.motivo ?? "sem motivo"}`;
    $("stats").textContent = `${atual.turnos} turnos \xB7 ${atual.eventos.length} eventos \xB7 lore ${atual.loreFinal.join(" \xD7 ")}`;
    const termo = filtro.value.trim().toLowerCase();
    const linhas = atual.eventos.filter((e) => !termo || e.type.includes(termo) || (e.rule ?? "").toLowerCase().includes(termo)).map((e) => `
        <tr>
          <td class="seq">${e.seq}</td>
          <td class="tipo">${e.type}</td>
          <td class="regra">${e.rule ?? ""}</td>
          <td class="dados">${e.texto}</td>
        </tr>`).join("");
    $("log").innerHTML = linhas;
    $("contagem").textContent = `${$("log").childElementCount} linhas`;
  }
  function rodar() {
    const seed = seedInput.value.trim() || "web-1";
    const t0 = performance.now();
    atual = jogarPartida(seed);
    const ms = (performance.now() - t0).toFixed(1);
    $("tempo").textContent = `${ms} ms`;
    render();
  }
  $("rodar").addEventListener("click", rodar);
  $("aleatorio").addEventListener("click", () => {
    seedInput.value = `seed-${Math.floor(Math.random() * 1e5)}`;
    rodar();
  });
  filtro.addEventListener("input", render);
  seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") rodar();
  });
  rodar();
}
export {
  jogarPartida
};
