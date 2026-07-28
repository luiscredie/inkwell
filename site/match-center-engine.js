/*
 * Inkwell Match Center legacy core — Claude handoff
 *
 * Extracted from engine(3).js. Removed on purpose:
 * - hard-coded Dale/Toys/Sid decks;
 * - LORCANA_SEED historical games;
 * - legacy app persistence and authentication;
 * - legacy collection/card-art code;
 * - embedded self-test.
 *
 * The current user's saved deck is mandatory. Use:
 *   state.decks -> selected deck
 *   deck.cards  -> { card_id: quantity }
 *   this.byId   -> global cards lookup
 *   state.matches -> existing user matches
 *
 * This source supplies parser, deterministic coach, duplicate hash, batch
 * parsing, saved-deck adapter, and an event timeline. The legacy sources did
 * not contain a full deterministic board-state replay; exact_board_state is
 * therefore explicitly false.
 */
(function (root) {
  // No seed deck: the current user's saved deck is mandatory.
  const DECK = [];

  const ARCHETYPES = ["Toys","Dwarves","Sapphire/Steel Control","Detective","Locations","Princesses","Amethyst/Sapphire Evasive","Amber/Emerald Aggro","Amber/Amethyst Evasive","Emerald/Sapphire Control","Amber/Ruby Toys",
    "Amber/Sapphire","Amber/Steel","Amethyst/Emerald","Amethyst/Ruby","Amethyst/Steel","Emerald/Ruby","Emerald/Steel","Ruby/Sapphire","Ruby/Steel",
    "Other / Unknown"];
  const WIN_CATS = ["Out-raced (go-wide tempo)","Dale + Mulan board clear","Ground them out (Ohana/Boost)","Removal denied their clock","Opponent conceded behind","Closed to 20 lore"];
  const LOSS_CATS = ["Couldn't stabilize vs aggro","Out-removed by control","Evasive out-raced me","Locations ticked me out","Dale answered / no combo online","Slow start / mulligan whiff","Never built a clock","Flooded / drew no threats"];

  const COMBO_DEFS = [
    {key:"dale",        label:"Dale resolved"},
    {key:"mulanElite",  label:"Mulan – Elite Archer"},
    {key:"tripleShot",  label:"Triple Shot fired"},
    {key:"sword",       label:"Sword double-swing"},
    {key:"ohana",       label:"Ohana / Stitch heal-draw"},
    {key:"reuben",      label:"Reuben Lunch Special"},
    {key:"snowboarder", label:"Stitch draw engine"},
    {key:"gastonLock",  label:"Gaston lock landed"},
    {key:"pressure",    label:"Pressure sung/cast"},
    {key:"boost",       label:"Boost / Webby value"}
  ];

  // archetype signature pools
  const DWARVES = ["Doc","Grumpy","Happy","Sleepy","Bashful","Sneezy","Dopey","Merida"];
  const TOYS = ["Woody","Jessie","Bullseye","Hamm","Rex","Lenny","Bo Peep","Sarge","Grandmother Willow","Alien","Bullseye - Loyal Horse"];
  const LOC_NAMES = ["Zootopia","Island of Nomanisan","Castle Wyvern","Sleepy Hollow","Leviathan's Lair","Casa Madrigal","The Library","Police Headquarters"];
  const CONTROL = ["The Headless Horseman","Demona","Yzma","Hades","Cheshire Cat","Isis Vanderchill","Be King Undisputed","Elsa - The Fifth Spirit","Maui - Half-Shark","Olaf - Helping Hand"];
  const DETECTIVE = ["Basil","Magica","Clarice"];
  const PRINCESS = ["Cinderella","Aurora","Ariel","Belle","Tiana","Rapunzel","Moana","Fauna - Good-Natured Fairy","Tod"];
  const AGGRO_ARCH = {"Toys":1,"Dwarves":1,"Amber/Emerald Aggro":1,"Amber/Ruby Toys":1};
  const EVASIVE_ARCH = {"Amethyst/Sapphire Evasive":1,"Amber/Amethyst Evasive":1};
  const CONTROL_ARCH = {"Sapphire/Steel Control":1,"Emerald/Sapphire Control":1};

  function firstName(c){ return c.split(" - ")[0].trim(); }

  function parseLog(raw, deckList, options){
    options = options || {};
    const lines = raw.replace(/\r/g,"").split("\n").map(l=>l.trim()).filter(Boolean);
    const cards = {1:new Set(),2:new Set()};
    const playedBy = {1:new Set(),2:new Set()};
    const oppCards = new Set();          // opponent card names for archetype guess
    const add=(p,c)=>{ if(c) cards[p].add(c.trim()); };

    let firstTurnPlayer=null, curTurn=0, curPlayer=null;
    const mull={1:0,2:0};
    const lore={1:0,2:0};
    const loreByTurn={1:{},2:{}};
    const cross={1:{c10:null,c20:null},2:{c10:null,c20:null}};
    const firstQuest={1:null,2:null};
    const questers={1:{},2:{}};
    const turnsTaken={1:0,2:0};
    const abilByPlayer={1:new Set(),2:new Set()};
    const gastonLock={1:false,2:false};
    let winner=null, method="unknown";
    let loserBanish={1:0,2:0};           // bodies each player lost
    let lastChal=null;                   // {who, atk, def}
    let lastRemovalBy=null;              // player who just used a "banishes X" effect

    const reHand=/^Player (\d)'s starting hand:\s*(.+)$/;
    const reMull=/^Player (\d) mulliganed (\d+) cards?:\s*(.+?)\. Drew:\s*(.+)$/;
    const reKept=/^Player (\d) kept/;
    const reTurn=/^--- Turn (\d+) ---$/;
    const reBegin=/^Player (\d)'s turn begins$/;
    const rePlay=/^Player (\d) played (.+?) \(cost/;
    const reShift=/^Player (\d) shifted (.+?) onto/;
    const reQuest=/Player (\d) quested with (.+?) \(\+(\d+) \[LORE\], (\d+) -> (\d+)\)/;
    const reLoreArrow=/\[LORE\][^\d]*?(\d+) -> (\d+)/;
    const reBan=/^(.+?) was banished$/;
    const reChal=/^Player (\d) challenged (.+?) with (.+?)(?: \||$)/;
    const reBanishes=/banishes (.+?)$/;
    const reInkField=/^(.+?) was put into Player (\d)'s inkwell from field$/;
    const reWon=/^Player (\d) won/;
    const reConcede=/^Player (\d) conceded$/;
    const reWon20=/Player (\d) won with (\d+) \[LORE\]/;
    const reActivated=/activated ([A-Z][A-Z0-9'! ]+?) on /;
    const reAbil=/'s ([A-Z][A-Z0-9'! ]{2,}?) (?:draws|gives|deals|gains|removes|banishes|grants|returns|chose|had|puts|moves|Returned|drew|-)/;

    for(const ln of lines){
      let m;
      if(m=ln.match(reHand)){ m[2].split(",").forEach(c=>add(+m[1],c)); continue; }
      if(m=ln.match(reMull)){ mull[+m[1]]=+m[2]; m[4].split(",").forEach(c=>add(+m[1],c)); continue; }
      if(reKept.test(ln)){ continue; }
      if(m=ln.match(reTurn)){ curTurn=+m[1]; lastChal=null; lastRemovalBy=null; continue; }
      if(m=ln.match(reBegin)){ curPlayer=+m[1]; if(firstTurnPlayer===null)firstTurnPlayer=curPlayer; turnsTaken[curPlayer]++; continue; }
      if(m=ln.match(rePlay)){ add(+m[1],m[2]); playedBy[+m[1]].add(m[2].trim()); continue; }
      if(m=ln.match(reShift)){ add(+m[1],m[2]); playedBy[+m[1]].add(m[2].trim()); }
      // ability attribution to current player
      if(m=ln.match(reActivated)){ abilByPlayer[curPlayer]&&abilByPlayer[curPlayer].add(m[1].trim()); }
      if(m=ln.match(reAbil)){ if(curPlayer) abilByPlayer[curPlayer].add(m[1].trim()); }
      if(/TOP THAT!/.test(ln) && !/no effect/.test(ln) && !/not met/.test(ln) && curPlayer){ gastonLock[curPlayer]=true; }

      // quest (explicit player + lore)
      if(m=ln.match(reQuest)){
        const p=+m[1], name=m[2].trim(), gained=+m[3], nv=+m[5];
        lore[p]=nv; loreByTurn[p][curTurn]=nv;
        questers[p][name]=(questers[p][name]||0)+gained;
        if(firstQuest[p]===null) firstQuest[p]=curTurn;
        if(nv>=10&&cross[p].c10===null)cross[p].c10=curTurn;
        if(nv>=20&&cross[p].c20===null)cross[p].c20=curTurn;
        continue;
      }
      // any other lore change (passive locations, gains) -> active player
      if(/\[LORE\]/.test(ln) && (m=ln.match(reLoreArrow)) && curPlayer){
        const nv=+m[2];
        if(nv>=lore[curPlayer]){ lore[curPlayer]=nv; loreByTurn[curPlayer][curTurn]=nv;
          if(nv>=10&&cross[curPlayer].c10===null)cross[curPlayer].c10=curTurn;
          if(nv>=20&&cross[curPlayer].c20===null)cross[curPlayer].c20=curTurn; }
        continue;
      }
      // board control bookkeeping
      if(m=ln.match(reChal)){ lastChal={who:+m[1], def:m[2].trim(), atk:m[3].trim().replace(/ \|.*$/,"")}; lastRemovalBy=null; continue; }
      if(reBanishes.test(ln)){ lastRemovalBy=curPlayer; continue; }
      if(m=ln.match(reInkField)){ loserBanish[+m[2]]++; continue; }
      if(m=ln.match(reBan)){
        const X=m[1].trim(); let loser=null;
        if(lastRemovalBy){ loser = lastRemovalBy===1?2:1; lastRemovalBy=null; }
        else if(lastChal && X===lastChal.def){ loser = lastChal.who===1?2:1; }
        else if(lastChal && X===lastChal.atk){ loser = lastChal.who; }
        else { loser = curPlayer ? (curPlayer===1?2:1) : null; } // default: active player removed opp body
        if(loser) loserBanish[loser]++;
        continue;
      }
      if(m=ln.match(reConcede)){ method="concession"; continue; }
      if(m=ln.match(reWon20)){ winner=+m[1]; lore[+m[1]]=Math.max(lore[+m[1]],+m[2]); if(method==="unknown")method="20 lore"; continue; }
      if(m=ln.match(reWon)){ winner=+m[1]; if(/concession/.test(ln))method="concession"; continue; }
    }

    // identify me
    const DL=Array.isArray(deckList)?deckList.filter(Boolean):[];
    if(!DL.length) throw new Error('A saved user deck with resolved cards is required');
    const inDL=c=>DL.some(d=>c===d||c.split(" - ")[0].trim()===d.split(" - ")[0].trim());
    const score=p=>[...cards[p]].filter(inDL).length;
    const me = score(1)>=score(2)?1:2; const opp = me===1?2:1;
    // opponent cards for archetype
    cards[opp].forEach(c=>oppCards.add(c));

    const result = winner!==null ? (winner===me?"W":"L") : "W";

    // combos for me
    const A=abilByPlayer[me], P=playedBy[me];
    const combos={
      dale:        P.has("Dale - Ready for His Shot"),
      mulanElite:  P.has("Mulan - Elite Archer"),
      tripleShot:  A.has("TRIPLE SHOT"),
      sword:       A.has("WORTHY WEAPON"),
      ohana:       A.has("OHANA MEANS FAMILY")||A.has("OHANA"),
      reuben:      A.has("LUNCH SPECIAL"),
      snowboarder: A.has("BRING YOUR FRIENDS"),
      gastonLock:  gastonLock[me],
      pressure:    P.has("This Growing Pressure")||A.has("THIS GROWING PRESSURE"),
      boost:       A.has("LATEST ENTRY")||/boosted/.test("") // boost handled below
    };
    // boost: scan raw for "Player me boosted"
    combos.boost = combos.boost || new RegExp("Player "+me+" boosted").test(raw);

    // archetype guess
    const oc=[...oppCards].map(firstName);
    const ocFull=[...oppCards];
    const hasPassiveLoc = /Set step: .+ grants Player/.test(raw) && !( /Set step: .+ grants Player "+me/.test(raw));
    let arch="Other / Unknown";
    const controlHits = CONTROL.filter(c=>ocFull.some(o=>o.includes(c)||o.startsWith(c))).length;
    const locCards = LOC_NAMES.filter(l=>ocFull.some(c=>c.includes(l))).length;
    const oppPassiveLore = new RegExp("Set step: [^\\n]+grants Player "+opp).test(raw);
    if(DWARVES.filter(d=>oc.includes(d)).length>=2) arch="Dwarves";
    else if(["Woody","Jessie","Bullseye","Hamm","Rex","Lenny"].filter(d=>oc.includes(d)).length>=2 || (oc.includes("Grandmother Willow")&&oc.includes("Woody"))) arch="Toys";
    else if(controlHits>=2) arch="Sapphire/Steel Control";          // control before locations: a splashed Library shouldn't read as Locations
    else if(locCards>=2 || oppPassiveLore) arch="Locations";
    else if(PRINCESS.some(pp=>ocFull.some(o=>o===pp||o.startsWith(firstName(pp))))) arch="Princesses";
    else if(DETECTIVE.filter(d=>oc.includes(d)).length>=2) arch="Detective";

    const myTurns=turnsTaken[me]||1;
    const cross10MyTurn = cross[me].c10? Math.ceil(cross[me].c10/2):null;
    const firstQuestMyTurn = firstQuest[me]? Math.ceil(firstQuest[me]/2):null;

    // category guess
    let winCat="", lossCat="";
    if(result==="W"){
      if(combos.tripleShot) winCat="Dale + Mulan board clear";
      else if(method==="concession") winCat="Opponent conceded behind";
      else winCat="Out-raced (go-wide tempo)";
    } else {
      if(arch==="Locations") lossCat="Locations ticked me out";
      else if(arch==="Sapphire/Steel Control") lossCat="Out-removed by control";
      else if(arch==="Toys"||arch==="Dwarves") lossCat=(lore[me]<=2?"Never built a clock":"Couldn't stabilize vs aggro");
      else if(lore[me]>=15) lossCat="Out-removed by control";
      else lossCat="Never built a clock";
    }

    const game = {
      id:"g"+Math.random().toString(36).slice(2,9),
      dateAdded:new Date().toISOString().slice(0,10),
      me, onPlay: firstTurnPlayer===me, mulligan: mull[me],
      myLore: lore[me], oppLore: lore[opp], margin: lore[me]-lore[opp],
      cross10: cross[me].c10, cross20: cross[me].c20,
      cross10MyTurn, firstQuest: firstQuest[me], firstQuestMyTurn,
      myTurns, gameTurns: curTurn, lorePerTurn:+(lore[me]/myTurns).toFixed(2),
      result, method,
      removedByMe: loserBanish[opp], myLost: loserBanish[me],
      questers: questers[me], combos,
      loreByTurn: loreByTurn[me], oppLoreByTurn: loreByTurn[opp],
      oppCards: [...oppCards].sort(),
      archetype: arch, winCat, lossCat, venue:"", notes:""
    };

    // ---- Match coach layer (parserVersion 2) — deterministic, no external AI ----
    attachCoachLayer(game, raw, options);
    return game;
  }

  // ---------- rawHash: deterministic, non-crypto, used only for dup detection ----------
  function rawHash(raw){
    const s = String(raw||"").replace(/\s+/g," ").trim();
    let h1=0x811c9dc5, h2=0x9e3779b9;
    for(let i=0;i<s.length;i++){
      const c=s.charCodeAt(i);
      h1 = (h1 ^ c); h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + c) >>> 0; h2 = ((h2<<5) ^ (h2>>>2) ^ c) >>> 0;
    }
    return (h1>>>0).toString(16).padStart(8,"0") + (h2>>>0).toString(16).padStart(8,"0") + s.length.toString(16);
  }

  // ---------- Strategy text -> structured hints ----------
  function parseStrategyHints(text, deckList){
    const hints = { archetypeHint:null, targetFirstQuestTurn:null, targetCross10Turn:null, targetCloseTurn:null,
      keyCards:[], winHint:'', lossHint:'', warnings:[] };
    const original = String(text||'');
    if(!original.trim()) return hints;
    const t = original.toLowerCase();

    const archs = ['aggro','tempo','control','midrange','combo','grind','locations','evasive'];
    for(const a of archs){ if(t.includes(a)){ hints.archetypeHint=a; break; } }

    let m = t.match(/cross(?:es|ing)?\s*(?:10|ten)[^\d]{0,18}(?:turn|t)\s*(\d+)/) || t.match(/(?:turn|t)\s*(\d+)[^\d]{0,12}cross(?:es|ing)?\s*(?:10|ten)/);
    if(m) hints.targetCross10Turn = +m[1];
    m = t.match(/first\s*quest[^\d]{0,18}(?:turn|t)\s*(\d+)/) || t.match(/quest(?:ing)?\s*from\s*(?:turn|t)\s*(\d+)/);
    if(m) hints.targetFirstQuestTurn = +m[1];
    m = t.match(/close(?:s|ing)?[^\d]{0,22}(?:by\s*)?(?:turn|t)\s*(\d+)/) || t.match(/(?:by\s*)?(?:turn|t)\s*(\d+)[^\d]{0,12}(?:close|win)/);
    if(m) hints.targetCloseTurn = +m[1];

    // key cards named in the strategy — match against this deck's card list
    if(deckList && deckList.length){
      const seen=new Set();
      deckList.forEach(full=>{
        const name = firstName(full||'');
        if(name && name.length>2 && original.toLowerCase().includes(name.toLowerCase()) && !seen.has(name)){
          seen.add(name); hints.keyCards.push(name);
        }
      });
    }

    m = original.match(/[^.]*\bwins?\b[^.]*\./i);
    if(m) hints.winHint = m[0].trim();
    m = original.match(/[^.]*\bloses?\b[^.]*\./i);
    if(m) hints.lossHint = m[0].trim();

    const warnPhrases = ['do not overcommit',"don't overcommit",'preserve a second wave','preserve second wave',
      'race before removal stabilizes','do not overextend',"don't overextend",'save your removal','play around',
      'do not durdle',"don't durdle",'bait removal'];
    warnPhrases.forEach(p=>{ if(t.includes(p)) hints.warnings.push(original.substring(t.indexOf(p), t.indexOf(p)+p.length)); });

    return hints;
  }

  // ---------- Win condition classifier ----------
  function classifyWinCondition(game, hints){
    hints = hints || {};
    const ev=[];
    if(game.result!=="W") return { primary:"", secondary:"", evidence:[], confidence:0 };

    if(game.method==="concession"){
      ev.push(`Opponent conceded at ${game.oppLore} lore while you were at ${game.myLore}.`);
      return { primary:"Opponent conceded behind", secondary:"", evidence:ev, confidence:0.85 };
    }

    const comboHit = game.combos && Object.keys(game.combos).find(k=>game.combos[k] && ["tripleShot","sword","pressure","gastonLock"].includes(k));
    if(comboHit){
      ev.push(`Combo flag "${comboHit}" fired and you closed the game.`);
      return { primary:"Combo payoff", secondary:"Board control into lore", evidence:ev, confidence:0.7 };
    }

    if(game.removedByMe>=4 && game.margin>0){
      ev.push(`Removed ${game.removedByMe} opposing bodies while keeping a lore lead of ${game.margin}.`);
      return { primary:"Board control into lore", secondary:"Removal lock", evidence:ev, confidence:0.65 };
    }

    if(game.firstQuestMyTurn && game.firstQuestMyTurn<=3 && game.cross10MyTurn && game.cross10MyTurn<=6){
      ev.push(`First quest on your turn ${game.firstQuestMyTurn}, crossed 10 lore by your turn ${game.cross10MyTurn}.`);
      return { primary:"Fast lore race", secondary:"", evidence:ev, confidence:0.7 };
    }

    if(game.cross10MyTurn){
      ev.push(`Crossed 10 lore by your turn ${game.cross10MyTurn} and closed from there.`);
      return { primary:"Steady lore clock", secondary:"", evidence:ev, confidence:0.6 };
    }

    if(game.removedByMe>=2){
      ev.push(`Removed ${game.removedByMe} bodies to deny the opponent's clock.`);
      return { primary:"Removal lock", secondary:"", evidence:ev, confidence:0.5 };
    }

    if(Object.keys(game.questers||{}).length<=1 && game.myLore>=10){
      ev.push("Lore climbed with barely any tracked quests — likely a location or passive source.");
      return { primary:"Location/passive lore", secondary:"", evidence:ev, confidence:0.4 };
    }

    if(game.gameTurns>=24){
      ev.push(`Game ran ${game.gameTurns} turns — a long grind to close it out.`);
      return { primary:"Resource grind", secondary:"", evidence:ev, confidence:0.45 };
    }

    ev.push("No single dominant signal in the log — worth a manual look.");
    return { primary:"Unknown / manual review", secondary:"", evidence:ev, confidence:0.25 };
  }

  // ---------- Loss condition classifier ----------
  function classifyLossCondition(game, hints){
    hints = hints || {};
    const ev=[];
    if(game.result!=="L") return { primary:"", secondary:"", evidence:[], confidence:0 };

    if(game.myLore<5){
      ev.push(`Finished at only ${game.myLore} lore — the clock never really started.`);
      if(hints.targetCross10Turn) ev.push(`Strategy targets crossing 10 by turn ${hints.targetCross10Turn}; you never crossed 10.`);
      return { primary:"Never built a lore clock", secondary:"", evidence:ev, confidence:0.75 };
    }

    if(game.removedByMe>=4 && game.myLore<12){
      ev.push(`Removed ${game.removedByMe} bodies but only reached ${game.myLore} lore — winning combat, not the race.`);
      return { primary:"Too much control, not enough questing", secondary:"", evidence:ev, confidence:0.65 };
    }

    if(AGGRO_ARCH[game.archetype]){
      ev.push(`Opponent read as ${game.archetype} — a fast board that likely out-turned you.`);
      return { primary:"Out-raced by aggro", secondary:"", evidence:ev, confidence:0.55 };
    }
    if(EVASIVE_ARCH[game.archetype]){
      ev.push(`Opponent read as ${game.archetype} — evasive bodies are hard to block/challenge.`);
      return { primary:"Out-raced by evasives", secondary:"", evidence:ev, confidence:0.55 };
    }
    if(CONTROL_ARCH[game.archetype]){
      ev.push(`Opponent read as ${game.archetype} — likely removed your board piece by piece.`);
      return { primary:"Out-removed by control", secondary:"", evidence:ev, confidence:0.55 };
    }
    if(game.archetype==="Locations"){
      ev.push("Opponent read as Locations — passive lore that doesn't trade in combat.");
      return { primary:"Locations ticked me out", secondary:"", evidence:ev, confidence:0.55 };
    }

    if(hints.keyCards && hints.keyCards.length && game.combos){
      const missing = !Object.keys(game.combos).some(k=>game.combos[k]);
      if(missing){
        ev.push(`Strategy names ${hints.keyCards.slice(0,3).join(', ')} but no combo flags fired this game.`);
        return { primary:"Combo never came online", secondary:"", evidence:ev, confidence:0.45 };
      }
    }

    if(game.mulligan>=4 && game.firstQuestMyTurn && game.firstQuestMyTurn>=5){
      ev.push(`Mulliganed ${game.mulligan} cards and didn't quest until your turn ${game.firstQuestMyTurn}.`);
      return { primary:"Bad mulligan / slow start", secondary:"", evidence:ev, confidence:0.5 };
    }

    if(game.myLore>=15){
      ev.push(`Reached ${game.myLore} lore before losing — the plan mostly worked, the close didn't.`);
      return { primary:"Could not close after stabilizing", secondary:"", evidence:ev, confidence:0.55 };
    }

    if(Object.keys(game.questers||{}).length===0){
      ev.push("No tracked quests at all — likely flooded or missing threats in hand.");
      return { primary:"Flooded / drew no threats", secondary:"", evidence:ev, confidence:0.5 };
    }

    if(hints.targetFirstQuestTurn && game.firstQuestMyTurn && game.firstQuestMyTurn>hints.targetFirstQuestTurn){
      ev.push(`Strategy targets first quest by turn ${hints.targetFirstQuestTurn}; first quest landed on turn ${game.firstQuestMyTurn}.`);
      return { primary:"Too much control, not enough questing", secondary:"", evidence:ev, confidence:0.4 };
    }

    ev.push("No single dominant signal in the log — worth a manual look.");
    return { primary:"Unknown / manual review", secondary:"", evidence:ev, confidence:0.25 };
  }

  // ---------- Plan score (0-100) ----------
  function computePlanScore(game, hints){
    hints = hints || {};
    let score = 70;
    const reasons = [];
    let hadTarget = false;

    if(hints.targetCross10Turn){
      hadTarget = true;
      if(game.cross10MyTurn!=null){
        const diff = game.cross10MyTurn - hints.targetCross10Turn;
        if(diff<=0){ score+=10; reasons.push(`Crossed 10 lore on turn ${game.cross10MyTurn}, at or ahead of your turn-${hints.targetCross10Turn} target.`); }
        else { score-=Math.min(22, diff*4); reasons.push(`Crossed 10 lore on turn ${game.cross10MyTurn}, ${diff} turn(s) behind your turn-${hints.targetCross10Turn} target.`); }
      } else {
        score-=25; reasons.push(`Never crossed 10 lore — target was turn ${hints.targetCross10Turn}.`);
      }
    }
    if(hints.targetFirstQuestTurn){
      hadTarget = true;
      if(game.firstQuestMyTurn!=null){
        const diff = game.firstQuestMyTurn - hints.targetFirstQuestTurn;
        if(diff<=0){ score+=8; reasons.push(`First quest landed on turn ${game.firstQuestMyTurn}, on schedule.`); }
        else { score-=Math.min(18, diff*3); reasons.push(`First quest landed on turn ${game.firstQuestMyTurn}, ${diff} turn(s) late.`); }
      } else {
        score-=15; reasons.push("Never recorded a quest.");
      }
    }
    if(hints.targetCloseTurn && game.result==="W"){
      const myCloseTurn = game.cross20MyTurn || (game.myTurns||null);
      if(myCloseTurn && myCloseTurn<=hints.targetCloseTurn){ score+=8; reasons.push(`Closed by your turn ${myCloseTurn}, inside the turn-${hints.targetCloseTurn} target.`); }
    }

    if(game.result==="W"){
      if(game.margin!=null && game.margin<3){ score-=5; reasons.push("Won, but by a thin margin — plan execution could be tighter."); }
    } else {
      if(!hadTarget){
        // no explicit targets in the strategy — judge on general clock health
        if(game.myLore>=10){ score+=5; reasons.push("Lost, but the lore clock was actually running (10+ lore) — a matchup/cards loss, not a plan failure."); }
        else { score-=10; reasons.push("Lost with a clock that never got going."); }
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const label = score>=80?"On plan":score>=50?"Partly on plan":"Off plan";
    return { score, label, reasons };
  }

  // ---------- Key turning points ----------
  function keyTurningPoints(game){
    const pts=[];
    if(game.firstQuest!=null){
      pts.push({ turn:game.firstQuest, label:"First quest", evidence:`Your first quest landed on turn ${game.firstQuest} (your turn ${game.firstQuestMyTurn}).`, impact:"positive" });
    }
    if(game.cross10!=null){
      pts.push({ turn:game.cross10, label:"Crossed 10 lore", evidence:`Reached 10 lore on turn ${game.cross10} (your turn ${game.cross10MyTurn}).`, impact:"positive" });
    }
    const myLBT=game.loreByTurn||{}, oppLBT=game.oppLoreByTurn||{};
    const bigJump=(byTurn,label,impact)=>{
      let prev=0;
      Object.keys(byTurn).map(Number).sort((a,b)=>a-b).forEach(turn=>{
        const v=byTurn[turn], delta=v-prev;
        if(delta>=5) pts.push({ turn, label, evidence:`+${delta} lore in one step (turn ${turn}), reaching ${v}.`, impact });
        prev=v;
      });
    };
    bigJump(myLBT, "Big lore swing (you)", "positive");
    bigJump(oppLBT, "Big lore swing (opponent)", "negative");
    if(game.combos){
      Object.keys(game.combos).forEach(k=>{ if(game.combos[k]) pts.push({ turn:null, label:"Combo: "+k, evidence:`Combo flag "${k}" fired.`, impact:"positive" }); });
    }
    if(game.removedByMe>=3) pts.push({ turn:null, label:"Heavy removal", evidence:`Removed ${game.removedByMe} opposing bodies.`, impact:"positive" });
    if(game.myLost>=4) pts.push({ turn:null, label:"Heavy losses", evidence:`Lost ${game.myLost} of your own bodies.`, impact:"negative" });
    // sort by turn (nulls last), cap at 6
    pts.sort((a,b)=>(a.turn==null)-(b.turn==null) || (a.turn||0)-(b.turn||0));
    return pts.slice(0,6);
  }

  // ---------- Coach report ----------
  const MATCHUP_TIPS = {
    "Toys":"Against go-wide Toys, stabilize first — don't trade one-for-one into a wider board, then wipe with your best combat turn.",
    "Dwarves":"Against Dwarves, don't durdle early; they can curve out fast. Lock their best enabler before clearing.",
    "Sapphire/Steel Control":"Against control, bait removal with mid-value bodies before committing your best threats; preserve a second wave.",
    "Emerald/Sapphire Control":"Against control, play around a wipe — don't overcommit your whole hand in one turn.",
    "Locations":"Against Locations, pressure the location-support characters early or race harder — locations don't trade in combat.",
    "Princesses":"Against Princesses, save your best removal for their evasive or Ward-protected threats.",
    "Amethyst/Sapphire Evasive":"Against evasive decks, race with your own clock — ground removal often can't reach them.",
    "Amber/Amethyst Evasive":"Against evasive decks, prioritize removing their support pieces since the evasive bodies dodge blocks.",
    "Amber/Emerald Aggro":"Against aggro, stabilize the board before turn 4-5, then take over with your own plan.",
    "Detective":"Against value/Detective decks, apply pressure so they're forced to answer instead of developing."
  };

  function buildCoachReport(game, hints, winCond, lossCond, planScore, options){
    hints = hints||{}; options = options||{};
    const whatWorked=[], whatFailed=[], nextGameFocus=[], deckImprovementIdeas=[];
    let headline='', summary='', mulliganAdvice='', matchupAdvice='';

    if(game.result==="W"){
      headline = `Win via ${winCond.primary||'unclear conditions'}`;
      summary = `You beat ${game.archetype} at ${game.myLore}-${game.oppLore}. ${(winCond.evidence||[])[0]||''}`.trim();
      whatWorked.push(...(winCond.evidence||[]));
      if(planScore.score<70) whatFailed.push("Won, but off the plan's own targets — see plan score reasons.");
      nextGameFocus.push(planScore.score<70 ? "Tighten execution toward your saved strategy's turn targets next game." : "Keep repeating this line — it matched your saved strategy.");
    } else {
      headline = `Loss via ${lossCond.primary||'unclear conditions'}`;
      summary = `You lost to ${game.archetype} at ${game.myLore}-${game.oppLore}. ${(lossCond.evidence||[])[0]||''}`.trim();
      whatFailed.push(...(lossCond.evidence||[]));
      if(game.removedByMe>=2) whatWorked.push(`Still removed ${game.removedByMe} opposing bodies before losing.`);
      if(game.cross10MyTurn) whatWorked.push(`Did cross 10 lore (your turn ${game.cross10MyTurn}) before losing.`);
      if(lossCond.primary==="Never built a lore clock") nextGameFocus.push("Prioritize your first quest over board answers in the opening turns.");
      else if(lossCond.primary==="Too much control, not enough questing") nextGameFocus.push("Once the board is safe, redirect removal-holding characters into questing.");
      else if(lossCond.primary==="Could not close after stabilizing") nextGameFocus.push("Once ahead on lore, prioritize closing over grinding extra value.");
      else nextGameFocus.push("Re-tag this game's loss reason by hand if the guess looks off, then watch for the pattern repeating.");
    }

    mulliganAdvice = game.mulligan>=4
      ? "You mulliganed heavily this game — consider keeping slightly looser hands if this keeps happening."
      : (game.mulligan===0 && game.firstQuestMyTurn && game.firstQuestMyTurn>=5)
        ? "Kept the opening hand with no mulligan but still had a slow start — worth mulliganing more aggressively for early plays."
        : "Mulligan count looked reasonable for this game.";

    matchupAdvice = MATCHUP_TIPS[game.archetype] || "Log a few more games against this archetype to build a specific read.";

    if(hints.warnings && hints.warnings.length){
      nextGameFocus.push("Strategy reminder: "+hints.warnings[0]+".");
    }

    // repeated-pattern deck-improvement ideas, using prior games if provided
    const prior = (options.existingGames||[]).filter(g=>g && g.result);
    if(prior.length>=4){
      const losses = prior.filter(g=>g.result==="L");
      if(losses.length>=3){
        const sameLossCount = losses.filter(g=>(g.lossCondition&&g.lossCondition.primary)===lossCond.primary && lossCond.primary).length;
        if(lossCond.primary && sameLossCount>=2){
          deckImprovementIdeas.push(`"${lossCond.primary}" has shown up in ${sameLossCount+1} losses now — consider a tech change or sideboard plan for it.`);
        }
        const neverClock = losses.filter(g=>(g.myLore||0)<5).length;
        if(neverClock>=3) deckImprovementIdeas.push(`${neverClock} losses ended under 5 lore — the deck may want a faster or more resilient opening.`);
      }
    }

    const confidence = Math.round((((winCond.confidence||0)+(lossCond.confidence||0)) * (game.result==="W"?1:1) + (planScore.score/100)) / 2 * 100) / 100;

    return {
      headline, summary,
      whatWorked, whatFailed, nextGameFocus,
      mulliganAdvice, matchupAdvice, deckImprovementIdeas,
      confidence: Math.max(0, Math.min(1, confidence))
    };
  }

  // ---------- Attach the whole coach layer onto a freshly parsed game ----------
  function attachCoachLayer(game, raw, options){
    options = options || {};
    const deckList = options.deckList || null;
    const hints = parseStrategyHints(options.deckStrategy||'', deckList);
    const winCondition = classifyWinCondition(game, hints);
    const lossCondition = classifyLossCondition(game, hints);
    const planScore = computePlanScore(game, hints);
    const turningPoints = keyTurningPoints(game);
    const coach = buildCoachReport(game, hints, winCondition, lossCondition, planScore, options);

    game.parserVersion = 2;
    game.rawHash = rawHash(raw);
    game.planScore = planScore;
    game.winCondition = winCondition;
    game.lossCondition = lossCondition;
    game.keyTurningPoints = turningPoints;
    game.coach = coach;

    if(options.existingGames && options.existingGames.length){
      const dup = options.existingGames.find(g=>g && g.rawHash && g.rawHash===game.rawHash);
      game.isDuplicateOfId = dup ? dup.id : null;
    } else {
      game.isDuplicateOfId = null;
    }
    return game;
  }

  // ---------- Batch parsing (low-risk helper) ----------
  function parseManyLogs(rawText, deckList, options){
    options = options || {};
    const out = { games:[], errors:[], duplicates:[] };
    const chunks = String(rawText||"").split(/\n{3,}/).map(c=>c.trim()).filter(Boolean);
    const existing = (options.existingGames||[]).slice();
    chunks.forEach((chunk, idx)=>{
      try{
        const g = parseLog(chunk, deckList, {...options, existingGames: existing.concat(out.games)});
        if(g.isDuplicateOfId){ out.duplicates.push(g); }
        else { out.games.push(g); }
      }catch(e){
        out.errors.push({ index:idx, message:(e&&e.message)||String(e) });
      }
    });
    return out;
  }



  // ---------- Inkwell current-user adapters ----------
  function normalizeCount(value){
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function resolveSavedDeck(deck, cardsById){
    if(!deck || !deck.id) throw new Error("A saved user deck with a stable id is required");
    const entries = Object.entries(deck.cards || {});
    if(!entries.length) throw new Error("The selected saved deck has no cards");
    const names = [];
    const unresolvedCardIds = [];
    for(const [cardId, rawCount] of entries){
      const count = normalizeCount(rawCount);
      if(!count) continue;
      const card = cardsById && cardsById[cardId];
      if(!card || !String(card.name_en || "").trim()){
        unresolvedCardIds.push(cardId);
        continue;
      }
      names.push(String(card.name_en).trim());
    }
    if(unresolvedCardIds.length){
      throw new Error("Saved deck contains unresolved card_id values: " + unresolvedCardIds.join(", "));
    }
    if(!names.length) throw new Error("The selected saved deck has no resolvable cards");
    return {
      deckId: deck.id,
      deckName: deck.name || deck.title || "Saved deck",
      deckList: names,
      strategy: String(deck.strategy || deck.notes || "").trim()
    };
  }

  function classifyReplayLine(line){
    if(/^--- Turn \d+ ---$/.test(line)) return "turn";
    if(/^Player \d+'s turn begins$/.test(line)) return "turn_begin";
    if(/^Player \d+ played /.test(line)) return "play";
    if(/^Player \d+ shifted /.test(line)) return "shift";
    if(/^Player \d+ quested /.test(line)) return "quest";
    if(/^Player \d+ challenged /.test(line)) return "challenge";
    if(/ was banished$/.test(line)) return "banish";
    if(/\[LORE\]/.test(line)) return "lore";
    if(/^Player \d+ conceded$/.test(line)) return "concede";
    if(/^Player \d+ won/.test(line)) return "result";
    if(/mulliganed/.test(line)) return "mulligan";
    if(/starting hand:/.test(line)) return "starting_hand";
    return "log";
  }

  function buildReplayTimeline(raw){
    const lines = String(raw || "").replace(/\r/g, "").split("\n")
      .map(line=>line.trim()).filter(Boolean);
    let turn = 0;
    let activePlayer = null;
    const lore = {1:0, 2:0};
    const ink = {1:0, 2:0};
    const chars = {1:[], 2:[]};   // characters currently in play, by display name
    const events = [];
    const addChar=(p,name)=>{ if(!name) return; name=name.trim(); if(!chars[p].includes(name)) chars[p].push(name); };
    const removeChar=(name)=>{ if(!name) return; name=name.trim(); for(const p of [1,2]){ const i=chars[p].indexOf(name); if(i>=0){ chars[p].splice(i,1); return; } } };
    for(const line of lines){
      let match = line.match(/^--- Turn (\d+) ---$/);
      if(match) turn = Number(match[1]);
      match = line.match(/^Player (\d)'s turn begins$/);
      if(match) activePlayer = Number(match[1]);
      const explicitPlayer = line.match(/^Player (\d)/);
      const player = explicitPlayer ? Number(explicitPlayer[1]) : activePlayer;
      const loreArrow = line.match(/\[LORE\][^\d]*?(\d+) -> (\d+)/);
      if(loreArrow && player) lore[player] = Number(loreArrow[2]);
      // board mutations
      let mm;
      if(mm=line.match(/^Player (\d) added (.+?) to ink$/)) ink[Number(mm[1])]++;
      if(mm=line.match(/^Player (\d) played (.+?) \(cost/)) addChar(Number(mm[1]), mm[2]);
      if(mm=line.match(/^Player (\d) shifted (.+?) onto (.+?) \(/)) { addChar(Number(mm[1]), mm[2]); removeChar(mm[3]); }
      if(mm=line.match(/^(.+?) was banished$/)) removeChar(mm[1]);
      const type = classifyReplayLine(line);
      events.push({
        index: events.length,
        turn,
        player: player || null,
        type,
        text: line,
        lore: {1:lore[1], 2:lore[2]},
        board: {
          1:{ink:ink[1], lore:lore[1], chars:chars[1].slice()},
          2:{ink:ink[2], lore:lore[2], chars:chars[2].slice()}
        }
      });
    }
    return {
      schema_version: 2,
      fidelity: "event_timeline_with_board",
      exact_board_state: false,
      events
    };
  }

  function createMatchFromSavedDeck(input){
    input = input || {};
    const raw = String(input.raw || "").trim();
    if(!raw) throw new Error("A raw game log is required");
    const resolved = resolveSavedDeck(input.deck, input.cardsById || {});
    const existing = Array.isArray(input.existingMatches)
      ? input.existingMatches.filter(m=>m && m.deck_id===resolved.deckId)
      : [];
    const parsed = parseLog(raw, resolved.deckList, {
      deckTitle: resolved.deckName,
      deckStrategy: resolved.strategy,
      deckList: resolved.deckList,
      existingGames: existing
    });
    const date = input.date || new Date().toISOString().slice(0,10);
    return {
      ...parsed,
      id: "m" + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36),
      deck_id: resolved.deckId,
      result: parsed.result === "W" ? "win" : "loss",
      outcome_code: parsed.result,
      date,
      raw_log: raw,
      source: "imported_log",
      replay: buildReplayTimeline(raw)
    };
  }

  root.INKWELL_MATCH_LEGACY = {
    parseLog,
    parseManyLogs,
    resolveSavedDeck,
    createMatchFromSavedDeck,
    buildReplayTimeline,
    ARCHETYPES,
    WIN_CATS,
    LOSS_CATS,
    COMBO_DEFS,
    parseStrategyHints,
    classifyWinCondition,
    classifyLossCondition,
    computePlanScore,
    buildCoachReport,
    keyTurningPoints,
    rawHash
  };
  if(typeof module!=="undefined" && module.exports){
    module.exports = root.INKWELL_MATCH_LEGACY;
  }
})(typeof globalThis!=="undefined"?globalThis:this);
