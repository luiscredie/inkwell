// Milestone 0 fixture tests for the Inkwell release validator.
// Run: node tools/validate.test.mjs   (no deps; uses an in-memory host)
import { validateRelease } from './validate-release.mjs';

function memHost(files){
  const enc = new TextEncoder();
  const bytes = {};
  for(const k in files){ bytes[k] = typeof files[k]==='string' ? files[k] : JSON.stringify(files[k]); }
  // trivial deterministic "hash" for fixture tests (not real sha256)
  const fakeHash = s => 'h'+[...s].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7).toString(16);
  return {
    async readText(rel){ if(!(rel in bytes)) throw new Error('nope'); return bytes[rel]; },
    async bytes(rel){ return { toString:()=>bytes[rel], _s:bytes[rel] }; },
    sha256(buf){ return fakeHash(buf._s!=null?buf._s:String(buf)); },
    async size(rel){ return enc.encode(bytes[rel]).length; },
    async exists(rel){ return rel in bytes; },
    _fakeHash: fakeHash,
  };
}

let pass=0, failN=0;
function check(name, cond){ if(cond){ pass++; console.log('  ✓', name); } else { failN++; console.log('  ✗', name); } }

const cards = { schema_version:3, generated_at:'2026-07-26T00:00:00Z', image_base_path:'images/',
  cards:[ { card_id:'LOR9-45', name_en:'Dumbo', card_type:'Character', abilities:[{ability_id:'LOR9-45-A1',type:'keyword'}] } ] };
const prices = { schema_version:2, generated_at:'2026-07-26T00:00:00Z', currency:'BRL', prices:{ 'LOR9-45':{ n:503, nl:440 } } };
const pt = { schema_version:1, generated_at:'2026-07-26T00:00:00Z', cards:{ 'LOR9-45':{ ability_count:1, abilities:[{ability_id:'LOR9-45-A1', text:'PT'}] } } };
const ph = { schema_version:1, generated_at:'2026-07-26T00:00:00Z', series:[{date:'2026-07-26', prices:{'LOR9-45':{nl:440}}}] };
function manifest(over={}){ return { manifest_version:1, generated_at:'2026-07-26T00:00:00Z',
  schema:{cards:3,prices:2,cards_pt:1,price_history:1},
  artifacts:{ cards:{path:'data/cards.json'}, prices:{path:'data/prices.json'}, cards_pt:{path:'data/cards.pt.json',optional:true}, price_history:{path:'data/price-history.json',optional:true}, ...over } }; }
function base(){ return { 'data-manifest.json':manifest(), 'data/cards.json':cards, 'data/prices.json':prices, 'data/cards.pt.json':pt, 'data/price-history.json':ph }; }

console.log('Inkwell validator fixtures:');

// valid current fixture passes
let r = await validateRelease(memHost(base()));
check('valid fixture passes', r.ok && r.errors.length===0);

// one changed byte fails hash validation
{ const f=base(); const m=manifest(); const h=memHost(f); m.artifacts.cards.sha256=h.sha256({_s:JSON.stringify(cards)}); f['data-manifest.json']=m;
  const bad={...cards, cards:[{...cards.cards[0], name_en:'Dumbo!'}]}; f['data/cards.json']=bad;
  r=await validateRelease(h===h?memHost(f):h); check('changed byte fails sha256', !r.ok && r.errors.some(e=>/sha256/.test(e))); }

// wrong artifact schema fails
{ const f=base(); f['data/prices.json']={...prices, schema_version:9}; r=await validateRelease(memHost(f)); check('wrong schema fails', !r.ok && r.errors.some(e=>/schema_version/.test(e))); }

// unsafe manifest path fails
{ const f=base(); const m=manifest({cards:{path:'../secret.json'}}); f['data-manifest.json']=m; r=await validateRelease(memHost(f)); check('unsafe path fails', !r.ok && r.errors.some(e=>/unsafe/.test(e))); }

// duplicate card_id fails
{ const f=base(); f['data/cards.json']={...cards, cards:[cards.cards[0], cards.cards[0]]}; r=await validateRelease(memHost(f)); check('duplicate card_id fails', !r.ok && r.errors.some(e=>/duplicate/.test(e))); }

// orphan PT ability -> warning (EN fallback)
{ const f=base(); f['data/cards.pt.json']={...pt, cards:{'LOR9-45':{abilities:[{ability_id:'NOPE-1',text:'x'}]}}}; r=await validateRelease(memHost(f)); check('orphan PT ability warns', r.warnings.some(w=>/overlay abilities/.test(w))); }

// orphan price -> warning
{ const f=base(); f['data/prices.json']={...prices, prices:{...prices.prices, 'ZZ-1':{n:1}}}; r=await validateRelease(memHost(f)); check('orphan price warns', r.warnings.some(w=>/priced ids/.test(w))); }

// malformed price-history fails
{ const f=base(); f['data/price-history.json']={...ph, series:[{date:'bad'}]}; r=await validateRelease(memHost(f)); check('malformed history fails', !r.ok && r.errors.some(e=>/price_history/.test(e))); }

// optional artifact absent -> still ok
{ const f=base(); delete f['data/price-history.json']; r=await validateRelease(memHost(f)); check('optional absent ok', r.ok); }

console.log(`\n${pass} passed, ${failN} failed`);
if(failN) process.exit(1);
