// Corrige o total da Coleção (foils contadas pelo preço normal).
// Uso, na raiz do repo inkwell:  node corrige-total-colecao.mjs
import fs from 'node:fs';

const ANTIGO = 'const n=e.n||0,f=e.f||0; tn+=n; tf+=f; tval+=this.priceOr0(c)*(n+f); }';
const NOVO   = 'const n=e.n||0,f=e.f||0; tn+=n; tf+=f; tval+=this.priceOr0(c)*n+(this.foilPrice(c)??this.priceOr0(c))*f; }';

const alvos = ['site/index.html', 'Inkwell.dc.html'];

for (const p of alvos) {
  if (!fs.existsSync(p)) { console.error('FALTA: ' + p + ' — rode na raiz do repo inkwell.'); process.exit(1); }
}

for (const p of alvos) {
  const txt = fs.readFileSync(p, 'utf8');
  const n = txt.split(ANTIGO).length - 1;
  if (n === 0 && txt.includes(NOVO)) { console.log('ja corrigido: ' + p); continue; }
  if (n !== 1) { console.error('ABORTADO: ' + p + ' tem ' + n + ' ocorrencias, esperava 1.'); process.exit(1); }
  fs.writeFileSync(p, txt.split(ANTIGO).join(NOVO));
  console.log('corrigido: ' + p);
}

const a = fs.readFileSync(alvos[0]);
const b = fs.readFileSync(alvos[1]);
if (!a.equals(b)) { console.error('ABORTADO: os dois arquivos nao ficaram identicos.'); process.exit(1); }
console.log('espelho byte a byte: OK');
