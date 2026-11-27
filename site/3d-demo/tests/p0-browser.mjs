/**
 * Inkwell 3D P0 browser regression. Run from repository root:
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   python3 -m http.server 8000 --directory site
 *   INKWELL_3D_URL=http://127.0.0.1:8000/3d-demo/ node site/3d-demo/tests/p0-browser.mjs
 * Screenshots are written to a local temporary directory, never committed.
 * Chromium emulation is NOT a substitute for physical iOS Safari / Android Chrome tests.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const url=process.env.INKWELL_3D_URL || 'http://127.0.0.1:8000/3d-demo/';
const output=await mkdtemp(join(tmpdir(),'inkwell-3d-p0-'));
const browser=await chromium.launch({headless:true});
let failures=0;
for(const width of [320,375,390,430,1280]){
  const mobile=width<850;
  const page=await browser.newPage({viewport:{width,height:850},deviceScaleFactor:1,reducedMotion:'reduce'});
  try{
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('.hero-stories .fan .card3d').first().waitFor();
    // Repeated open requests must not schedule overlapping binder transitions.
    await page.evaluate(()=>{binderOpening=true;openBinder();if(!binderOpening)throw Error('Opening guard lost');binderOpening=false;});
    const hero=await page.locator('.hero-stories .fan .card3d').evaluateAll(cards=>cards.map(c=>{
      const r=c.getBoundingClientRect();
      return {left:r.left,right:r.right,filter:getComputedStyle(c).filter};
    }));
    assert(hero.length>=3,'Missing featured cards');
    if(mobile){
      assert(hero.every(c=>!c.filter.includes('blur(')),'Blurred featured card');
      // CSS filters on ancestors blur the entire card even when the card itself has filter:none.
      const ancestorBlur=await page.locator('.hero-stories .fan .card3d').evaluateAll(cards=>cards.map(card=>{
        const blurred=[];
        for(let node=card;node&&node.nodeType===1;node=node.parentElement){
          const style=getComputedStyle(node);
          if(/blur\s*\(/i.test(style.filter)||/blur\s*\(/i.test(style.backdropFilter||'')){
            blurred.push(node.className||node.tagName);
          }
        }
        return blurred;
      }));
      assert(ancestorBlur.every(chain=>chain.length===0),
        'Featured card blurred by ancestor or backdrop filter: '+JSON.stringify(ancestorBlur));
      // Verify that the central featured card is actually visible at its center,
      // rather than covered by an overlay or another transformed card.
      const visibility=await page.locator('.hero-stories .fan .card3d').nth(1).evaluate(card=>{
        const rect=card.getBoundingClientRect();
        const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
        const top=document.elementFromPoint(x,y);
        return {insideViewport:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,
          unobscured:!!top&&(top===card||card.contains(top)),
          opacity:getComputedStyle(card).opacity};
      });
      assert(visibility.insideViewport,'Central featured card outside viewport');
      assert(visibility.unobscured,'Central featured card obscured at its center');
      assert(Number(visibility.opacity)>0.9,'Central featured card is faded');
    }
    // Verify actual CSS animation durations with reduced-motion disabled.
    // JS completes page turning after 160ms; visual animations must not outlast it.
    await page.emulateMedia({reducedMotion:'no-preference'});
    const animationDurations=await page.evaluate(()=>{
      const sheet=[...document.styleSheets].find(s=>s.href?.endsWith('/experience.css'));
      const text=[...(sheet?.cssRules||[])].map(r=>r.cssText).join(' ');
      return {
        leaf:/\.binder-leaf\s*\{[^}]*animation:\s*leaf-in\s+\.16s/.test(text),
        next:/is-turning-next[^}]*page-turn-next\s+\.16s/.test(text),
        prev:/is-turning-prev[^}]*page-turn-prev\s+\.16s/.test(text)
      };
    });
    assert(Object.values(animationDurations).every(Boolean),'Binder CSS animation exceeds 160ms interaction window');
    await page.emulateMedia({reducedMotion:'reduce'});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(overflow<=2,`Horizontal overflow: ${overflow}px`);
    await page.screenshot({path:join(output,`home-${width}.png`),fullPage:true});
    await page.evaluate(()=>navigate('Coleção'));
    // Leaving Collection while an opening is pending must release the opening guard.
    await page.evaluate(()=>{
      const original=window.setTimeout;
      let pending;
      window.setTimeout=(fn,ms,...args)=>{if(ms===160){pending=()=>fn(...args);return 1}return original(fn,ms,...args)};
      try{
        openBinder();
        if(!binderOpening||!pending)throw Error('Opening was not scheduled');
        navigate('Feed');
        if(binderOpening)throw Error('Navigation left opening guard active');
        pending();
        if(binderOpen||binderOpening)throw Error('Stale timer reopened binder after navigation');
        navigate('Coleção');
      }finally{window.setTimeout=original}
    });
    // A delayed opening must not resurrect a binder that was closed meanwhile.
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{
      const original=window.setTimeout;
      let pending;
      window.setTimeout=(fn,ms,...args)=>{if(ms===160){pending=()=>fn(...args);return 1}return original(fn,ms,...args)};
      try{
        openBinder();
        if(!binderOpening||!pending)throw Error('Opening did not schedule a transition');
        closeBinder();
        pending();
        if(binderOpen||binderOpening)throw Error('Cancelled opening reopened the binder');
      }finally{window.setTimeout=original}
    });
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button',{name:/Abrir meu fichário/}).click();
    await page.locator('.binder-book:not(.is-closed)').waitFor();
    const slots=await page.locator('.binder-page .binder-pocket').count();
    assert.equal(slots,mobile?9:18,'Wrong number of pockets');
    const stage=page.locator('[data-binder-swipe]');
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    // Allow the shortened 160ms turn to settle, with a small scheduling margin.
    await page.waitForTimeout(210);
    assert.equal(await stage.count(),1,'Binder stage missing after navigation');
    assert.equal(await stage.evaluate(el=>document.activeElement===el),true,'Keyboard focus lost after page turn');
    const pageLabel=await page.locator('.binder-page').first().getAttribute('aria-label');
    assert(pageLabel?.includes(mobile?'Página 2':'Página 3'),`Page did not advance: ${pageLabel}`);
    // Vertical scrolling should not accidentally trigger a page turn.
    const stableLabel=pageLabel;
    await stage.dispatchEvent('touchstart',{touches:[{clientX:160,clientY:200}]});
    await stage.dispatchEvent('touchend',{changedTouches:[{clientX:170,clientY:310}]});
    assert.equal(await page.locator('.binder-page').first().getAttribute('aria-label'),stableLabel,'Vertical gesture changed page');
    // Interrupted touch must clear its start point and never advance the binder.
    await stage.dispatchEvent('touchstart',{touches:[{clientX:230,clientY:150}]});
    await stage.dispatchEvent('touchcancel',{changedTouches:[{clientX:140,clientY:150}]});
    await stage.dispatchEvent('touchend',{changedTouches:[{clientX:140,clientY:150}]});
    assert.equal(await page.locator('.binder-page').first().getAttribute('aria-label'),stableLabel,'Cancelled touch changed page');
    assert.equal(await page.evaluate(()=>binderTouchX===null&&binderTouchY===null&&binderGestureAt===0),true,'Cancelled touch left gesture state');
    // Dispatch a horizontal touch gesture through the DOM handlers, not by calling
    // the implementation functions directly. Verify page direction and position.
    // P0 #171: measure synchronous gesture-to-state feedback, not animation completion.
    // This is a browser-emulated latency guard; physical device frame timing is separate.
    const gestureFeedback=await stage.evaluate(el=>{
      const before=binderPage;
      const start=performance.now();
       return {before,start};
    });
    await stage.dispatchEvent('touchstart',{touches:[{clientX:230,clientY:200}]});
    const gestureStart=await page.evaluate(()=>performance.now());
    await stage.dispatchEvent('touchend',{changedTouches:[{clientX:140,clientY:202}]});
    const feedback=await page.evaluate(()=>({now:performance.now(),page:binderPage}));
    assert.notEqual(feedback.page,gestureFeedback.before,'Swipe did not update binder state immediately');
    assert(feedback.now-gestureStart<150,'Swipe-to-state feedback exceeded 150ms in browser emulation');
    await page.waitForTimeout(210);
    const swipedLabel=await page.locator('.binder-page').first().getAttribute('aria-label');
    assert.notEqual(swipedLabel,stableLabel,'Horizontal touch swipe did not turn page');
    await stage.dispatchEvent('touchstart',{touches:[{clientX:140,clientY:200}]});
    await stage.dispatchEvent('touchend',{changedTouches:[{clientX:230,clientY:202}]});
    await page.waitForTimeout(210);
    assert.equal(await page.locator('.binder-page').first().getAttribute('aria-label'),stableLabel,
      'Reverse touch swipe did not restore page');
    // Desktop mouse/pen drags should capture the pointer so release outside the stage is handled.
    await page.evaluate(()=>{
      const stage=document.querySelector('[data-binder-swipe]');
      const captured=[];
      const event={pointerId:71,pointerType:'mouse',button:0,clientX:230,clientY:150,
        target:stage,currentTarget:{setPointerCapture:id=>captured.push(id),hasPointerCapture:()=>true,releasePointerCapture:id=>captured.push(-id)}};
      binderPointerStart(event);
      if(captured[0]!==71)throw Error('Pointer capture missing');
      binderPointerEnd({...event,clientX:140,clientY:150});
      if(captured[1]!==-71)throw Error('Pointer capture not released');
      if(binderPointerId!==null)throw Error('Pointer state not cleared');
    });
    // The actual DOM handler must forward the PointerEvent to cleanup.
    assert.equal(await stage.getAttribute('onpointercancel'),'binderPointerCancel(event)',
      'DOM pointercancel handler does not forward event');
    // Browser may release pointer capture without pointerup (e.g. interrupted drag).
    assert.equal(await stage.getAttribute('onlostpointercapture'),'binderPointerCancel(event)',
      'Lost pointer capture is not wired to gesture cleanup');
    // Cancelled drag must clear state and release capture without turning a page.
    await page.evaluate(()=>{
      const stage=document.querySelector('[data-binder-swipe]');
      const released=[];
      const target={setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture:id=>released.push(id)};
      binderPointerStart({pointerId:72,pointerType:'mouse',button:0,clientX:230,clientY:150,target:stage,currentTarget:target});
      const before=binderPage;
      binderPointerCancel({pointerId:72,currentTarget:target});
      if(released[0]!==72||binderPointerId!==null||binderTouchX!==null||binderPage!==before)
        throw Error('Cancelled pointer drag did not clean up safely');
    });
    await page.evaluate(()=>{
      const stage=document.querySelector('[data-binder-swipe]');
      const target={setPointerCapture(){},hasPointerCapture:()=>false};
      binderPointerStart({pointerId:73,pointerType:'mouse',button:0,clientX:230,clientY:150,target:stage,currentTarget:target});
      const before=binderPage;
      stage.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:73,bubbles:true}));
      if(binderPointerId!==null||binderTouchX!==null||binderPage!==before)
        throw Error('Lost pointer capture left stale binder drag state');
    });
    // A horizontal swipe must not also activate the card under the pointer.
    await page.evaluate(()=>{
      binderGestureStart({clientX:230,clientY:150});
      binderGestureEnd({clientX:140,clientY:153});
      binderCardClick(0,{currentTarget:document.querySelector('.binder-pocket .card3d')}); // Simulate trailing synthesized click.
    });
    assert.equal(await page.locator('#overlay.open').count(),0,'Swipe accidentally opened a card');
    // Switch to Feed while the guard is still active, and dispatch a real DOM click.
    // Previously this assertion passed with a null currentTarget because Feed was not rendered.
    await page.evaluate(()=>navigate('Feed'));
    const feedCard=page.locator('.hero-stories .card3d').first();
    await feedCard.waitFor();
    await feedCard.evaluate(el=>el.click());
    assert.equal(await page.locator('#overlay.open').count(),1,'Swipe guard blocked a real Feed card click');
    await page.evaluate(()=>{closeModal();navigate('Coleção')});
    // binderOpen is preserved across navigation; do not assume the cover reappears.
    await page.locator('.binder-book:not(.is-closed)').waitFor();
    await page.evaluate(()=>{binderDragClickUntil=0;binderCardClick(0)});
    assert.equal(await page.locator('#overlay.open').count(),1,'Normal card tap was blocked');
    await page.evaluate(()=>closeModal());
    await page.screenshot({path:join(output,`binder-${width}.png`),fullPage:true});
    // Reduced motion is enabled in every viewport; page should remain usable.
    assert.equal(await page.locator('.binder-pocket').count(),mobile?9:18,'Binder pockets lost after turn');
    assert.deepEqual(errors,[],'Browser JavaScript errors');
    console.log('PASS',width);
  }catch(e){failures++;console.error('FAIL',width,e.message)}
  finally{await page.close()}
}
await browser.close();
console.log('Screenshots:',output);
if(failures)process.exitCode=1;
