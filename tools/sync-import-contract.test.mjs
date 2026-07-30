import fs from 'node:fs';
import assert from 'node:assert/strict';

const html=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/inkwell_profiles.sql',import.meta.url),'utf8');
let passed=0;
const check=(name,fn)=>{ fn(); passed++; console.log('✓',name); };

const start=html.indexOf('static mergeCollections(');
const end=html.indexOf('\n  importCollection =',start);
assert.ok(start>0&&end>start,'mergeCollections source not found');
const src=html.slice(start,end).replace(/^static mergeCollections/,'function mergeCollections');
const mergeCollections=Function(`${src}; return mergeCollections;`)();

const existing={A:{n:2,f:0},B:{n:1,f:1}};
const incoming={A:{n:1,f:2},C:{n:3,f:0}};

check('safe merge keeps existing-only cards',()=>{
  assert.deepEqual(mergeCollections(existing,incoming,'merge-max'),{A:{n:2,f:2},B:{n:1,f:1},C:{n:3,f:0}});
});
check('sum mode adds quantities',()=>{
  assert.deepEqual(mergeCollections(existing,incoming,'merge-sum'),{A:{n:3,f:2},B:{n:1,f:1},C:{n:3,f:0}});
});
check('replace mode is explicitly destructive',()=>{
  assert.deepEqual(mergeCollections(existing,incoming,'replace'),incoming);
});
check('file read opens preview before mutation',()=>{
  const body=html.slice(html.indexOf('importCollection ='),html.indexOf('setImportMode=',html.indexOf('importCollection =')));
  assert.match(body,/importPreview:\{collection:coll/);
  assert.doesNotMatch(body,/setState\(\{collection:coll\}/);
});
check('apply creates a rollback snapshot',()=>{
  assert.match(html,/inkwell_preimport_/);
  assert.match(html,/Component\.mergeCollections/);
});
check('sync uses revision compare-and-swap',()=>{
  assert.match(html,/select\('data,updated_at,schema,revision'\)/);
  assert.match(html,/rpc\('sync_inkwell_profile'/);
  assert.match(html,/preserveSyncConflict/);
});
check('database enables RLS and owner policies',()=>{
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/auth\.uid\(\).*user_id/s);
  assert.match(sql,/revision_conflict/);
});
check('sync and import UI are bilingual',()=>{
  for(const key of ['syncTitle','syncConflict','importPreviewTitle','importMergeMaxDesc','importReplaceWarning']){
    assert.equal((html.match(new RegExp(key+":",'g'))||[]).length,2,key);
  }
});

console.log(`\n${passed} passed, 0 failed`);

