// Static release-contract checks for the single-file UI and packaging.
// These tests guard defects that data fixtures cannot see.
// Run: node tools/ui-contract.test.mjs
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [html, smoke, workflow, deployWorkflow, packageText] = await Promise.all([
  read('../site/index.html'),
  read('./smoke.spec.mjs'),
  read('../.github/workflows/validate.yml'),
  read('../.github/workflows/deploy-pages.yml'),
  read('../package.json'),
]);
const packageJson = JSON.parse(packageText);

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

const sortSelect = '<select data-testid="collection-sort"';
check(
  'collection contains exactly one sort select',
  html.split(sortSelect).length - 1 === 1 &&
    html.split('value="{{ sort }}" onChange="{{ onSort }}"').length - 1 === 1
);
check(
  'set-number sort uses natural number, set order, and card_id tie-break',
  html.includes('<option value="setnum"') &&
    html.includes("if(s==='setnum')") &&
    html.includes('this.collNum(a.card_number)-this.collNum(b.card_number)') &&
    html.includes('String(a.card_id).localeCompare(b.card_id)')
);
check(
  'builder uses 120-card pages and modal keeps full collection navigation ids',
  html.includes('const bTotal=pool.length; const BPS=120') &&
    html.includes('this._navIds=all.map(c=>c.card_id)') &&
    html.includes('all.slice(page*this.PAGE_SIZE,(page+1)*this.PAGE_SIZE)')
);

const didMountStart = html.indexOf('async componentDidMount()');
const didMountEnd = html.indexOf('async bootData()', didMountStart);
const didMountBlock = html.slice(didMountStart, didMountEnd);
check(
  'modal keyboard listener is lifecycle-scoped and guarded',
  html.includes('_modalKeyBound = false') &&
    html.includes('componentDidUpdate(_prevProps, prevState)') &&
    html.includes('if(!wasOpen&&isOpen) this.bindModalKeys()') &&
    html.includes('else if(wasOpen&&!isOpen) this.unbindModalKeys()') &&
    html.includes('componentWillUnmount(){ this.unbindModalKeys();') &&
    !didMountBlock.includes("document.addEventListener('keydown'")
);
check(
  'modal has exactly one keyboard navigation path',
  html.split("document.addEventListener('keydown'").length - 1 === 1 &&
    !html.includes('onKeyDown="{{ onModalKey }}"') &&
    !html.includes('V.onModalKey=')
);
check(
  'modal navigation includes controls and bounded card stepping',
  html.includes('data-testid="modal-prev"') &&
    html.includes('data-testid="modal-next"') &&
    html.includes('if(j<0||j>=list.length) return') &&
    html.includes('V.navPrevDisabled=') &&
    html.includes('V.navNextDisabled=')
);

check(
  'all deck add paths validate copy limits before mutation',
  html.includes('validForDeck(card, deck, forAdd=false)') &&
    html.includes("fail('COPY_LIMIT','Copy limit reached ('+limit+' across reprints)'") &&
    html.includes('validForDeck(card,deck,true)') &&
    html.includes('_inc:()=>this.tryAddToDeck(e.card,deck)') &&
    html.includes('const v=this.validForDeck(c,deck,true)')
);
check(
  'package validator targets the site deploy root',
  packageJson.scripts?.validate ===
    'python3 tools/validate_release.py --root site --quick'
);
check(
  'workflow validates and serves site as the deploy root',
  workflow.includes('validate_release.py --root site --quick') &&
    workflow.includes('(cd site && python3 -m http.server 8080 &)')
);
check(
  'Pages deploy waits for green CI and publishes site as the artifact root',
  deployWorkflow.includes('workflows: ["Inkwell release checks"]') &&
    deployWorkflow.includes("github.event.workflow_run.conclusion == 'success'") &&
    deployWorkflow.includes('uses: actions/upload-pages-artifact@v3') &&
    deployWorkflow.includes('path: site') &&
    deployWorkflow.includes('test ! -f index.html')
);
check(
  'browser smoke contains no conditional existence skips',
  !/if\s*\(\s*await\s+[^)]*\.count\(\)/.test(smoke)
);
check(
  'browser smoke verifies invalid-add rejection and loaded art',
  smoke.includes('Copy limit reached') &&
    smoke.includes('toHaveText(countBefore)') &&
    smoke.includes('toHaveText(totalBefore)') &&
    smoke.includes('image.naturalWidth > 0')
);
check(
  'browser smoke verifies exact modal identity movement and boundaries',
  smoke.includes("press('ArrowRight')") &&
    smoke.includes("press('ArrowLeft')") &&
    smoke.includes("press('Escape')") &&
    smoke.includes("toHaveAttribute('data-cid', expectedNextId)") &&
    smoke.includes('toBeDisabled()')
);
// ---- M1P Checkpoint A: Overview player-first + price movers ----
check(
  'Overview orders gameplay KPIs before Collection Value',
  html.includes("kpiReady") && html.includes("kpiMatchAct") && html.includes("kpiCollProg") &&
    html.indexOf("this.t('kpiReady')") < html.indexOf("this.t('collValue')")
);
check('Overview keeps Collection Value present', html.includes("this.t('collValue')"));
check('Overview uses empty state not misleading zero', html.includes("totCards>0?this.fmt(value):'—'"));
check(
  'Prices has gainers and losers boxes',
  html.includes('{{ gainersTitle }}') && html.includes('{{ losersTitle }}') &&
    html.includes('moversTitle:') && html.includes('gainersTitle:')
);
check('Prices shows insufficient-history state', html.includes('{{ moversNoHistory }}') && html.includes('moversInsufficient'));
check(
  'Price movers expose latest/1d/7d/30d controls',
  html.includes("{k:'latest'") && html.includes("{k:'1d'") && html.includes("{k:'7d'") && html.includes("{k:'30d'")
);
check('Price movers computed by pure static function', html.includes('static computeMovers(series, period, resolveName)'));
check(
  'Price movers use lowest-first and finish identity',
  html.includes("finishFoil") && html.includes("finishNormal") && html.includes("r.id+'|'+r.finish")
);
check('Price mover row opens the correct card modal', html.includes('_open:()=>this.openCard(r.id)'));
check(
  'Price movers boxes are responsive (auto-fit stacks on mobile)',
  html.includes('grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:22px')
);
check('browser smoke covers Overview order and price movers', smoke.includes('kpi-ready') && smoke.includes('collection-value') && smoke.includes('price-movers'));
check('Player Home consumes the portfolio optimizer (not independent readiness)', html.includes('Component.computeDeckPortfolioPlan(invH, pDecksH') && html.includes('buildable=PH.decksBuildable'));
check(
  'activeDeckId loads, imports, and syncs with the profile',
  html.includes('activeDeckId:m.activeDeckId||null') &&
    html.includes('activeDeckId:j.activeDeckId||null') &&
    html.includes('activeDeckId:this.state.activeDeckId||null') &&
    html.includes('learnDone:m.learnDone, activeDeckId:m.activeDeckId||null')
);
check(
  'activeDeckId is normalized when its deck is missing or deleted',
  html.includes("!d.decks.some(dk=>dk.id===d.activeDeckId)") &&
    html.includes("this.state.activeDeckId===id?((decks[0]||{}).id||null)")
);
check(
  'Match deletion has one cleanup-aware implementation',
  html.split('delMatch(id){').length - 1 === 1 &&
    html.includes('if(this.state.selectedMatch===id) this.closeMatch()')
);
check(
  'legality uses structured issues and blocks invalid imports before save',
  html.includes("add('MAX_INKS'") &&
    html.includes('issues:[{code:') &&
    html.includes('const blockers=this.importBlockers(deck)') &&
    html.indexOf('const blockers=this.importBlockers(deck)') <
      html.indexOf('this.setState({decks:[...st.decks,deck]', html.indexOf('importDeck = ()=>'))
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
