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
let reducedMotion=false, coverPresent=true;
const context = vm.createContext({
  document:{querySelector(){return coverPresent?cover:null}},
  window:{matchMedia(){return {matches:reducedMotion}},setTimeout(fn,ms){assert.equal(ms,160);timers.push(fn)}},
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
// Race: user reopens before the cancelled opening's timer has fired.
vm.runInContext('openBinder()',context);
assert.equal(timers.length,2,'Reopening should schedule one new timer');
timers.shift()(); // stale callback from the first opening
assert.equal(state().binderOpen,false,'Stale callback must not reopen binder');
assert.equal(state().binderOpening,true,'Stale callback must not cancel newer opening');
timers.shift()(); // current opening
assert.equal(state().binderOpen,true,'Latest opening must complete');
assert.equal(state().binderOpening,false,'Opening flag must clear after completion');
assert(renders>=2,'UI updates missing');
// Accessibility: reduced-motion users must open without scheduling a timer.
vm.runInContext('closeBinder()',context);
reducedMotion=true;
const beforeReduced=timers.length;
vm.runInContext('openBinder()',context);
assert.equal(state().binderOpen,true,'Reduced-motion opening should complete synchronously');
assert.equal(state().binderOpening,false,'Reduced-motion opening must not leave a pending guard');
assert.equal(timers.length,beforeReduced,'Reduced-motion opening must not schedule a timer');

// Graceful fallback when the cover element is not mounted.
vm.runInContext('closeBinder()',context);
reducedMotion=false;
coverPresent=false;
const beforeNoCover=timers.length;
vm.runInContext('openBinder()',context);
assert.equal(state().binderOpen,true,'Missing cover must not trap the user');
assert.equal(state().binderOpening,false,'Missing cover must not leave a pending guard');
assert.equal(timers.length,beforeNoCover,'Missing cover must not schedule a timer');
console.log('PASS binder opening: duplicate, cancellation, stale timer race, reopening, reduced motion, missing cover');
