// M3V V5 Match Center product-contract tests. No browser or dependencies.
// Run: node tools/match-center-v5.test.mjs
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const start=html.indexOf('  static computeMatchCenterInsights(');
const end=html.indexOf('\n  matchConditionLabel(',start);
if(start<0||end<0) throw new Error('computeMatchCenterInsights not found');
const method=html.slice(start,end).replace(/^\s*static\s+computeMatchCenterInsights/,'function computeMatchCenterInsights');
const compute=new Function(method+'; return computeMatchCenterInsights;')();

let pass=0,fail=0;
function ck(name,ok){ if(ok){pass++;console.log('✓ '+name);}else{fail++;console.error('✗ '+name);} }
const W=(id,date,deck='A',extra={})=>({id,date,deck_id:deck,result:'win',source:'imported_log',planScore:{score:80},...extra});
const L=(id,date,reason='Out-raced by aggro',deck='A',extra={})=>({id,date,deck_id:deck,result:'loss',source:'imported_log',lossCondition:{primary:reason},planScore:{score:55},myLore:8,...extra});

const empty=compute([],[]);
ck('empty history recommends first match',empty.practiceCode==='first_match'&&empty.total===0);

const streak=compute([W('w1','2026-07-30'),W('w2','2026-07-29'),L('l1','2026-07-28')],[{id:'A',name:'Hero'}]);
ck('current winning streak is deterministic',streak.streak===2&&streak.streakResult==='win');
ck('target review prefers most recent loss when present',streak.targetMatchId==='l1');

const recurring=compute([
  L('l1','2026-07-30','Out-raced by aggro'),W('w1','2026-07-29'),L('l2','2026-07-28','Out-raced by aggro'),L('l3','2026-07-27','Could not close after stabilizing')
],[{id:'A',name:'Hero'}]);
ck('recurring loss wins practice priority',recurring.practiceCode==='recurring_loss');
ck('recurring loss count and condition preserved',recurring.practiceCount===2&&recurring.practiceCondition==='Out-raced by aggro');

const plan=compute([W('w','2026-07-30','A',{planScore:{score:45}}),L('l','2026-07-29','Unknown / manual review','A',{planScore:{score:50}})],[{id:'A',name:'Hero'}]);
ck('low plan adherence becomes practice',plan.practiceCode==='plan_execution'&&plan.averagePlan===48);

const close=compute([L('a','2026-07-30','Unknown / manual review','A',{myLore:17}),W('w','2026-07-29'),L('b','2026-07-28','Could not close after stabilizing','A',{myLore:18})],[{id:'A',name:'Hero'}]);
ck('two high-lore losses become closing practice',close.practiceCode==='close_game');

const ten=[
  W('10','2026-07-30'),W('9','2026-07-29'),W('8','2026-07-28'),W('7','2026-07-27'),L('6','2026-07-26'),
  W('5','2026-07-25'),L('4','2026-07-24'),L('3','2026-07-23'),L('2','2026-07-22'),L('1','2026-07-21')
];
const trend=compute(ten,[{id:'A',name:'Hero'}]);
ck('last-five win rate is correct',trend.recentWr===80);
ck('previous-five win rate is correct',trend.previousWr===20);
ck('trend uses percentage-point delta',trend.trend===60);
ck('detailed-log coverage is explicit',trend.importedPct===100);

const decks=compute([W('a','2026-07-30','A'),L('b','2026-07-29','Unknown / manual review','B'),W('c','2026-07-28','A')],[{id:'A',name:'Alpha'},{id:'B',name:'Beta'}]);
ck('deck performance uses saved deck ids',decks.deckStats[0].id==='A'&&decks.deckStats[0].name==='Alpha');
ck('deck performance record is correct',decks.deckStats[0].games===2&&decks.deckStats[0].wins===2&&decks.deckStats[0].wr===100);

const original=[W('x','2026-07-30'),L('y','2026-07-29')], snapshot=JSON.stringify(original);
compute(original,[{id:'A',name:'Alpha'}]);
ck('analytics never mutates persisted matches',JSON.stringify(original)===snapshot);

ck('V5 practice hero is present',html.includes('data-testid="match-practice"'));
ck('V5 trend panel is present',html.includes('data-testid="match-trend"'));
ck('V5 saved-deck performance is present',html.includes('data-testid="match-deck-performance"'));
ck('V5 detail exposes action and evidence',html.includes('{{ mc.detail.nextAction }}')&&html.includes('{{ mc.detail.facts }}'));
ck('V5 match rows expose lore, score, condition, and replay',html.includes('{{ m.lore }}')&&html.includes('{{ m.score }}')&&html.includes('{{ m.condition }}')&&html.includes('{{ m.hasReplay }}'));
ck('V5 does not add a persisted data field',!html.includes('matchCenterInsights:this.state')&&!html.includes('practiceCode:this.state'));

ck('fullscreen replay buttons use top-level runtime handlers',
  html.includes('onClick="{{ replayFsClose }}"')&&
  html.includes('onClick="{{ replayFsPrev }}"')&&
  html.includes('onClick="{{ replayFsToggle }}"')&&
  html.includes('onClick="{{ replayFsNext }}"')&&
  html.includes('onClick="{{ replayFsToggleHidden }}"'));
ck('fullscreen replay controls have stable browser targets',
  ['replay-fullscreen-close','replay-fullscreen-prev','replay-fullscreen-play','replay-fullscreen-next','replay-hidden-toggle']
    .every(id=>html.includes(`data-testid="${id}"`)));
ck('fullscreen replay opens at the first event and reuses the guarded keyboard path',
  html.includes("replayFull:true,replayIndex:0,replayPlaying:false")&&
  html.includes("()=>this.bindModalKeys()")&&
  html.includes("if(this.state.replayFull)")&&
  !html.includes("_replayFullKeyBound"));
const victoryLayerStart=html.indexOf('<sc-if value="{{ rf.showVictory }}"');
const victoryLayerEnd=html.indexOf('</sc-if>',victoryLayerStart);
const victoryLayer=html.slice(victoryLayerStart,victoryLayerEnd);
ck('fullscreen victory layer cannot intercept controls',
  victoryLayerStart>=0&&victoryLayer.includes('pointer-events:none'));

const logic=(html.match(/<script type="text\/x-dc"[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/)||[])[1];
if(!logic) throw new Error('component logic not found');
class LogicStub { constructor(){ this.state={}; } }
const Component=new Function('DCLogic','React',logic+'\n;return Component;')(LogicStub,{createElement(){return null;}});
const c=new Component();
const listeners=new Set();
const oldDocument=globalThis.document;
globalThis.document={addEventListener(type,fn){if(type==='keydown')listeners.add(fn);},removeEventListener(type,fn){if(type==='keydown')listeners.delete(fn);}};
c.state={matches:[{id:'r1',replay:{events:[{text:'one'},{text:'two'}]}}],selectedMatch:'r1',replayIndex:1,replayPlaying:false,replayFull:false,replayShowHidden:false};
c.setState=(patch,cb)=>{ const p=typeof patch==='function'?patch(c.state):patch; c.state={...c.state,...p}; if(cb)cb(); };
c.replayFullOpen();
ck('fullscreen open resets a replay parked at its last event',c.state.replayFull===true&&c.state.replayIndex===0);
ck('fullscreen reuses the single scoped key listener without duplication',listeners.size===1&&(c.bindModalKeys(),listeners.size===1));
c.replayStep(1);
ck('fullscreen next advances the selected replay',c.state.replayIndex===1);
c.state.replayIndex=0;
c._modalKeyHandler({key:'ArrowRight',preventDefault(){}});
ck('shared keyboard handler advances fullscreen replay',c.state.replayIndex===1);
c.replayFullToggleHidden();
ck('fullscreen hidden-info control changes state',c.state.replayShowHidden===true);
c.replayFullClose();
ck('fullscreen close stops playback and removes its key listener',c.state.replayFull===false&&c.state.replayPlaying===false&&listeners.size===0);
globalThis.document=oldDocument;

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
