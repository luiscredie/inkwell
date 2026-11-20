// Testes puros do parser; nao acessam a LigaLorcana e nao sao testes fim a fim.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(__dirname+'/worker.js','utf8');
const ctx={importScripts(){},chrome:{runtime:{onMessage:{addListener(){}},onStartup:{addListener(){}}},alarms:{onAlarm:{addListener(){}}}},URL,Date,Blob,Uint8Array,TextEncoder,console,setTimeout};vm.createContext(ctx);vm.runInContext(code,ctx);
assert.deepEqual(Array.from(vm.runInContext('extractPart([]).values',ctx)),[null,null,null]);
assert.equal(vm.runInContext('extractPart([]).state',ctx),'no_offers');
assert.equal(vm.runInContext('extractPart(undefined).state',ctx),'missing');
assert.equal(vm.runInContext('extractPart({p:"4,60",m:"5,54",g:"10,00"}).values[0]',ctx),460);
assert.equal(vm.runInContext('extractPart({p:"20",m:"10",g:"30"}).state',ctx),'invalid_order');
assert.equal(vm.runInContext('keyOf({idcard:10,edition_id:2,num:"007"})',ctx),'10|2|007');
const snapshot={url:'https://www.ligalorcana.com.br/?view=cards/card&card=Exemplo%20(23)&ed=D23&num=23',raw:[{idcard:345,id:900,idkey:'foo',code:'D23',num:23,name:'Exemplo',price:{'0':[{p:'1,00',m:'2,00',g:'3,00'}],'2':[]}}],scripts:[]};
ctx.snapshot=snapshot;
let result=vm.runInContext('parseCard(snapshot,"D23")',ctx);assert.equal(result.row.idcard,'345');assert.equal(result.row.foil_status,'no_offers');assert.equal(result.row.normal_max_centavos,300);assert.equal(result.row.name,'Exemplo');assert.equal(result.row.edition_name,'Exemplo');
const suffix={...snapshot,url:'https://www.ligalorcana.com.br/?view=cards/card&card=Oswald%20-%20The%20Lucky%20Rabbit%20(6b)&ed=D23&num=6b',raw:[{idcard:1195,id:4,idkey:'4_6b',code:'D23',num:'6b',name:'D23 Promos',price:{'0':[], '2':[]}}]};ctx.suffix=suffix;const rr=vm.runInContext('parseCard(suffix,"D23")',ctx);assert.equal(rr.row.name,'Oswald - The Lucky Rabbit');assert.equal(rr.row.edition_name,'D23 Promos');
const mike={...snapshot,url:'https://www.ligalorcana.com.br/?view=cards/card&card=Mike%20Wazowski%20-%20Heroic%20Climber%20(Enchanted)%20(226)&ed=LOR13&num=226',raw:[{idcard:3000,id:19,idkey:'19_226',code:'LOR13',num:'226',name:'Attack of the Vine!',price:{'0':[{p:'890,99',m:'982,50',g:'975,00'}],'2':[]}}]};
ctx.mike=mike;
const mr=vm.runInContext('parseCard(mike,"LOR13")',ctx);
assert.equal(mr.row.normal_status,'ok');
assert.equal(mr.row.normal_min_centavos,89099);
assert.equal(mr.row.normal_med_centavos,98250);
assert.equal(mr.row.normal_max_centavos,97500);
assert.equal(mr.row.foil_status,'no_offers');
console.log('Parser: pre�o m�dio acima do m�ximo aceito sem alterar centavos.');

// Failed cards are quarantined; no fabricated prices or false capture marker.
assert.equal(vm.runInContext('transientCardFailure("cards_editions nao acess�vel")',ctx),true);
assert.equal(vm.runInContext('MAX_CARD_READ_TRIES',ctx),3);
ctx.job={pending:{},failures:{url:3},cardIndex:102,queue:Array(267).fill('url'),log:[]};
vm.runInContext('recordMissing(job,"LOR12","url","cards_editions nao acess�vel")',ctx);
assert.equal(ctx.job.pending.url.edition,'LOR12');
assert.equal(ctx.job.pending.url.attempts,3);
assert.equal(new URL(vm.runInContext('sourceUrl({url:"https://www.ligalorcana.com.br/?view=cards/card"},{queue:["https://www.ligalorcana.com.br/?view=cards/card&ed=LOR12&num=121"],cardIndex:0})',ctx)).searchParams.get('num'),'121');
console.log('Testes adicionais de pend�ncias e URL de impressao aprovados.');

ctx.targetUrl='https://www.ligalorcana.com.br/?view=cards%2Fcard&card=Jack%E2%80%90Jack+Parr+-+Incredible+Potential+%28121%29&ed=LOR12&num=121';
ctx.landing={url:'https://www.ligalorcana.com.br/?view=cards%2Fcard&card=Jack-Jack+Parr+-+Incredible+Potential&tipo=1'};
assert.equal(vm.runInContext('sameCardPage(landing,targetUrl)',ctx),true);
assert.equal(vm.runInContext('sameCardPage({url:"https://www.ligalorcana.com.br/?view=cards%2Fcard&card=Other"},targetUrl)',ctx),false);
console.log('URL reescrita do Jack-Jack reconhecida sem confundir outra carta.');

// O nome da carta The Robot Queen nao deve disparar um bloqueio falso.
assert.equal(vm.runInContext('pausableMessage("The Robot Queen - LOR10")',ctx),false);
assert.equal(vm.runInContext('pausableMessage("CAPTCHA verification required")',ctx),true);
console.log("Detector de bloqueio: palavra robot ignorada, CAPTCHA explicito mantido.");

// LOR12 #121: legacy URL double-encoded as HTML entity must resolve to real U+2010 link.
ctx.jackBad='https://www.ligalorcana.com.br/?view=cards/card&card=Jack%26amp%3B8208%3BJack%20Parr%20-%20Incredible%20Potential%20(121)&ed=LOR12&num=121';
const fixed=vm.runInContext('correctedCardUrl(jackBad)',ctx);
assert.equal(new URL(fixed).searchParams.get('card'),'Jack-Jack Parr - Incredible Potential (121)');
assert.equal(new URL(fixed).searchParams.get('num'),'121');
assert.equal(new URL(fixed).searchParams.get('ed'),'LOR12');
assert.equal(vm.runInContext('sameCardPage({url:correctedCardUrl(jackBad)},correctedCardUrl(jackBad))',ctx),true);
assert.equal(vm.runInContext('blockEvidence({txt:"The Robot Queen",title:"LOR10"})',ctx),null);
assert.equal(vm.runInContext('CAPTCHA_WAIT_MS',ctx),600000);
assert.equal(vm.runInContext('MAX_CAPTCHA_RECHECKS',ctx),2);
assert.equal(vm.runInContext('extractPart({p:"8,90",m:"25,00",g:"20,00"}).state',ctx),'ok');
assert.equal(vm.runInContext('extractPart({p:"30,00",m:"25,00",g:"20,00"}).state',ctx),'invalid_order');
console.log('URL Jack-Jack, bloqueio, espera de 10 minutos e pre�os aprovados.');

// LOR1 must NOT be confused with LOR10/LOR11/LOR12/LOR13/LOR14.
const ed1='https://www.ligalorcana.com.br/?view=cards/search&card=edid=1%20ed=LOR1';
const otherCodes=[10,11,12,13,14];
for(const n of otherCodes){
 const url='https://www.ligalorcana.com.br/?view=cards/search&card=edid=9%20ed=LOR'+n;
 ctx.testLink={url,label:'LOR'+n};
 assert.equal(vm.runInContext('isEditionLink(testLink,"LOR1")',ctx),false, 'LOR1 must not match LOR'+n);
}
ctx.correctLOR1={url:ed1,label:'The First Chapter'};
assert.equal(vm.runInContext('isEditionLink(correctLOR1,"LOR1")',ctx),true);
ctx.linksForOne=[{url:'https://www.ligalorcana.com.br/?view=cards/search&card=edid=9%20ed=LOR10',label:'LOR10'}];
assert.equal(vm.runInContext('editionListingUrl("LOR1",linksForOne)',ctx),ed1);
assert.equal(vm.runInContext('edOf(editionListingUrl("LOR1",linksForOne))',ctx),'LOR1');
console.log('LOR1: link canonico edid=1; correspondencia exata sem falso match LOR10-14.');

// LOR2 #34: alternate URL provided by the user has tipo=1 but no ed/num.
// Retain the source printing ID, and never accept a mismatched printing.
ctx.sleepyBad='https://www.ligalorcana.com.br/?view=cards/card&card=Sleepy%27s%20Flute%20(34)&ed=LOR2&num=34';
const sleepy0=vm.runInContext('correctedCardUrl(sleepyBad,0)',ctx);
const sleepy1=vm.runInContext('correctedCardUrl(sleepyBad,1)',ctx);
assert.equal(sleepy0,ctx.sleepyBad);
assert.equal(sleepy1,'https://www.ligalorcana.com.br/?view=cards%2Fcard&card=Sleepy%27s+Flute&tipo=1');
assert.equal(new URL(sleepy1).searchParams.get('ed'),null);
assert.equal(vm.runInContext('sameCardPage({url:correctedCardUrl(sleepyBad,1)},correctedCardUrl(sleepyBad,1))',ctx),true);
ctx.sleepyJob={queue:[ctx.sleepyBad],cardIndex:0,failures:{[ctx.sleepyBad]:1}};
ctx.sleepyPage={url:sleepy1};
assert.equal(vm.runInContext('sourceUrl(sleepyPage,sleepyJob)',ctx),ctx.sleepyBad);
const sp={url:sleepy1,raw:[{code:'LOR2',num:'34',idcard:414,id:2,idkey:'2_34',name:'Rise of the Floodborn',price:{'0':[{p:'2.00',m:'3.00',g:'4.00'}],'2':[]}}],scripts:[]};
ctx.sp=sp;
const good=vm.runInContext('parseCard(sp,"LOR2",sourceUrl(sp,sleepyJob))',ctx);
assert.equal(good.row.code,'LOR2');assert.equal(good.row.num,'34');assert.equal(good.row.idcard,'414');
assert.equal(good.row.normal_min_centavos,200);assert.equal(good.row.foil_status,'no_offers');
ctx.spBad={...sp,raw:[{...sp.raw[0],code:'LOR9',num:'34',idcard:991,id:15}]};
const bad=vm.runInContext('parseCard(spBad,"LOR2",sourceUrl(spBad,sleepyJob))',ctx);
assert.ok(bad.error,'A different printing cannot be captured as LOR2-34');
assert.equal(new URL(vm.runInContext('correctedCardUrl(jackBad,1)',ctx)).searchParams.get('card'),'Jack-Jack Parr - Incredible Potential (121)');
console.log('LOR2 Sleepy tipo=1 retry validates printing, keeps source ID and rejects mismatched editions.');

// DLPC1 promo number appears twice in bad Liga listing link: 1/PD1 + 1-PD1.
ctx.promoBad='https://www.ligalorcana.com.br/?view=cards/card&card=Beast%20-%20Snowfield%20Troublemaker%20(1%2FPD1)%20(1-PD1)&ed=DLPC1&num=1-PD1';
const promoA=vm.runInContext('correctedCardUrl(promoBad,0)',ctx);
const promoB=vm.runInContext('correctedCardUrl(promoBad,1)',ctx);
assert.equal(new URL(promoA).searchParams.get('card'),'Beast - Snowfield Troublemaker (1/PD1)');
assert.equal(new URL(promoB).searchParams.get('card'),'Beast - Snowfield Troublemaker');
for (const u of [promoA,promoB]) {
 assert.equal(new URL(u).searchParams.get('ed'),'DLPC1');
 assert.equal(new URL(u).searchParams.get('num'),'1-PD1');
}
assert.equal(vm.runInContext('correctedCardUrl(promoBad,2)',ctx),promoB);
ctx.normalPromo='https://www.ligalorcana.com.br/?view=cards/card&card=Other%20(2-PD1)&ed=DLPC1&num=2-PD1';
assert.equal(vm.runInContext('correctedCardUrl(normalPromo,0)',ctx),ctx.normalPromo,'No single suffix stripping');
ctx.d23Url='https://www.ligalorcana.com.br/?view=cards/card&card=Oswald%20(6b)&ed=D23&num=6b';
assert.equal(vm.runInContext('correctedCardUrl(d23Url,0)',ctx),ctx.d23Url);
const cardData={url:promoA,raw:[{idcard:1234,id:7,idkey:'7_1-PD1',code:'DLPC1',num:'1-PD1',name:'Disney Lorcana Promo Cards',price:{'0':{p:'1.00',m:'2.00',g:'3.00'},'2':[]}}],scripts:[]};
ctx.cardData=cardData;
let promoResult=vm.runInContext('parseCard(cardData,"DLPC1")',ctx);
assert.equal(promoResult.row.idcard,'1234');
assert.equal(promoResult.row.num,'1-PD1');
assert.equal(promoResult.row.code,'DLPC1');
assert.equal(promoResult.row.name,'Beast - Snowfield Troublemaker');
ctx.badPromoData={...cardData,raw:[{...cardData.raw[0],num:'2-PD1'}]};
assert.ok(vm.runInContext('parseCard(badPromoData,"DLPC1")',ctx).error,'Never capture wrong promo printing');
ctx.promoSlashData={...cardData,raw:[{...cardData.raw[0],num:'1/PD1'}]};
assert.equal(vm.runInContext('parseCard(promoSlashData,"DLPC1")',ctx).row.idcard,'1234');
ctx.promoJob={queue:[ctx.promoBad],cardIndex:0,failures:{}};
ctx.promoA=promoA;
assert.equal(vm.runInContext('sourceUrl({url:promoA},promoJob)',ctx),promoA);
console.log('DLPC1: double promo suffix URL corrected, printing identity preserved, mismatched card rejected.');
