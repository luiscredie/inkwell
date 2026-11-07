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
    const hero=await page.locator('.hero-stories .fan .card3d').evaluateAll(cards=>cards.map(c=>{
      const r=c.getBoundingClientRect();
      return {left:r.left,right:r.right,filter:getComputedStyle(c).filter};
    }));
    assert(hero.length>=3,'Missing featured cards');
    if(mobile)assert(hero.every(c=>!c.filter.includes('blur(')),'Blurred featured card');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(overflow<=2,`Horizontal overflow: ${overflow}px`);
    await page.screenshot({path:join(output,`home-${width}.png`),fullPage:true});
    await page.evaluate(()=>navigate('Coleção'));
    await page.getByRole('button',{name:/Abrir meu fichário/}).click();
    await page.locator('.binder-book:not(.is-closed)').waitFor();
    const slots=await page.locator('.binder-page .binder-pocket').count();
    assert.equal(slots,mobile?9:18,'Wrong number of pockets');
    const stage=page.locator('[data-binder-swipe]');
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    assert.equal(await stage.count(),1,'Binder stage missing after navigation');
    await page.screenshot({path:join(output,`binder-${width}.png`),fullPage:true});
    assert.deepEqual(errors,[],'Browser JavaScript errors');
    console.log('PASS',width);
  }catch(e){failures++;console.error('FAIL',width,e.message)}
  finally{await page.close()}
}
await browser.close();
console.log('Screenshots:',output);
if(failures)process.exitCode=1;
