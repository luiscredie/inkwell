import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Zero-dependency regression of the actual binder-opening functions in index.html.
// Run: node site/3d-demo/tests/binder-opening-unit.mjs
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('let binderOpening=false,binderOpenGeneration=0;');
const end = html.indexOf('let binderTouchY=', start);
assert(start !== -1 && end > start, 'Cannot locate binder opening implementation');
const source = html.slice(start, end);
const timers = [];
const cover = {classList:{add(name){assert.equal(name,'is-opening')}}};
let renders=0;
const context = vm.createContext({
  document:{querySelector(){return cover}},
  window:{matchMedia(){return {matches:false}},setTimeout(fn,ms){assert.equal(ms,160);timers.push(fn)}},
  updateTiles(){renders++},render(){renders++},
  screen:'Coleção',collectionView:'fichario',binderOpen:false,binderPage:3,
});
vm.runInContext(source,context);
const state=()=>vm.runInContext('({binderOpen,binderOpening,binderOpenGeneration,binderPage})',context);
vm.runInContext('openBinder();openBinder()',context);
assert.equal(timers.length,1,'Repeated opening must schedule only one timer');
assert.equal(state().binderOpening,true);
vm.runInContext('closeBinder()',context);
assert.equal(state().binderOpening,false);
assert.equal(state().binderPage,0);
timers.shift()();
assert.equal(state().binderOpen,false,'Cancelled callback must not reopen binder');
vm.runInContext('openBinder()',context);
assert.equal(timers.length,1,'Opening after cancellation must work');
timers.shift()();
assert.equal(state().binderOpen,true,'Latest opening must complete');
assert(renders>=2,'UI updates missing');
console.log('PASS binder opening: duplicate, cancellation, reopening');
