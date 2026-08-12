/**
 * Integracao com o Inkwell Brasil.
 *
 * Esta e a UNICA fronteira entre o simulador e o site. Tudo que o simulador
 * precisa do Inkwell entra por aqui:
 *   - o catalogo de cartas (`site/data/cards.json`)
 *   - as imagens (`site/lorcana-card-images/` via `image_base_path`)
 *   - as listas de deck do jogador
 *
 * O caminho e de MAO UNICA: o simulador nunca escreve no site. Assim o Luis
 * continua atualizando o catalogo sem risco de quebrar o jogo.
 *
 * Tres formas de receber decks, em ordem de precedencia:
 *   1. postMessage do Inkwell    — integracao embutida em iframe
 *   2. parametros de URL         — link direto de um deck salvo
 *   3. colar a lista na tela     — uso avulso
 */

import { loadInkwellCatalog, type InkwellCard } from "../src/decks/catalog.js";
import { parseDeckList } from "../src/decks/parse.js";
import { resolveDeck, type DeckReport } from "../src/decks/resolve.js";
import { applyImplementations } from "../src/cards/registry.js";
import type { CardDef } from "../src/engine/types.js";

export interface InkwellConfig {
  /** Caminho do catalogo. O padrao assume o simulador em `site/sim/`. */
  catalogUrl: string;
}

export const CONFIG_PADRAO: InkwellConfig = {
  catalogUrl: "../data/cards.json",
};

export interface Catalogo {
  defs: Map<string, CardDef>;
  /** Base absoluta das imagens, derivada do proprio catalogo. */
  imageBase: string;
  total: number;
  codificadas: number;
}

interface CatalogoCru {
  cards: InkwellCard[];
  image_base_path?: string;
}

/**
 * Carrega o catalogo e aplica as implementacoes.
 *
 * A base de imagens e `site/lorcana-card-images/`, irma de `site/data/`. NAO seguir
 * `image_base_path`: o app principal do Inkwell tambem o ignora para arquivo local
 * (`imgLocal()` tem o caminho fixo), entao seguir o campo leva a pasta errada.
 */
export async function carregarCatalogo(config: InkwellConfig): Promise<Catalogo> {
  const resposta = await fetch(config.catalogUrl);
  if (!resposta.ok) {
    throw new Error(`catalogo indisponivel (${resposta.status}) em ${config.catalogUrl}`);
  }
  const cru = (await resposta.json()) as CatalogoCru;
  const { defs } = loadInkwellCatalog(cru.cards);
  const aplicado = applyImplementations(defs);

  // O Inkwell guarda a arte em site/lorcana-card-images/ e o app principal ignora
  // image_base_path para arquivo local (imgLocal() tem caminho fixo). Resolver
  // image_base_path contra a URL do catalogo dava site/data/images/, que nao existe.
  const base = new URL("../lorcana-card-images/", new URL(config.catalogUrl, location.href));
  return {
    defs,
    imageBase: base.href,
    total: defs.size,
    codificadas: aplicado.implemented,
  };
}

/**
 * URL da arte da carta.
 *
 * `image_file` no catalogo atual VEM com o prefixo `images/` e com nomes em
 * underscore (`Aurora_-_Holding_Court__LOR9-6.jpg`). O prefixo e removido
 * porque a base ja aponta para a pasta da arte; o `encodeURI` fica como rede de
 * seguranca caso algum arquivo futuro tenha espaco no nome.
 */
export function urlDaImagem(catalogo: Catalogo, def: CardDef): string | null {
  const arquivo = def.imageFile;
  if (!arquivo) return null;
  // image_file no catalogo do Inkwell vem sem prefixo de pasta, e nomes tem espacos.
  return new URL(encodeURI(arquivo.replace(/^images\//, "")), catalogo.imageBase).href;
}

export interface DeckCarregado {
  nome: string;
  report: DeckReport;
}

export function resolverLista(nome: string, texto: string, catalogo: Catalogo): DeckCarregado {
  return { nome, report: resolveDeck(parseDeckList(texto), catalogo.defs) };
}

// --- entrada de decks ------------------------------------------------------

export interface ListasRecebidas {
  origem: "postMessage" | "url" | "manual";
  decks: { nome: string; lista: string }[];
}

/**
 * Contrato de integracao com o Inkwell.
 *
 * A pagina que embute o simulador manda:
 *
 *   iframe.contentWindow.postMessage({
 *     type: "inkwell-sim:load-decks",
 *     decks: [
 *       { nome: "Princesses Yellow Green", lista: "4 Aurora - Holding Court\n..." },
 *       { nome: "Evasives Red Purple",     lista: "..." },
 *     ],
 *   }, location.origin);
 *
 * A lista aceita tanto o formato do Liga Lorcana quanto o do Dreamborn — o
 * parser trata os dois. O simulador responde com:
 *
 *   { type: "inkwell-sim:ready" }        assim que o catalogo carrega
 *   { type: "inkwell-sim:decks-loaded", jogavel: boolean, erros: string[] }
 *   { type: "inkwell-sim:game-over", vencedor: 0 | 1, motivo: string }
 */
export function ouvirInkwell(aoReceber: (listas: ListasRecebidas) => void): void {
  window.addEventListener("message", (evento) => {
    // So aceita mensagem da mesma origem: o simulador nunca confia em terceiros.
    if (evento.origin !== location.origin) return;
    const dado = evento.data as { type?: string; decks?: { nome: string; lista: string }[] };
    if (dado?.type !== "inkwell-sim:load-decks" || !Array.isArray(dado.decks)) return;
    aoReceber({ origem: "postMessage", decks: dado.decks });
  });
}

export function avisarInkwell(mensagem: Record<string, unknown>): void {
  if (window.parent === window) return;
  window.parent.postMessage(mensagem, location.origin);
}

/** `?deck1=<lista url-encoded>&deck2=<...>` — para link direto de um deck salvo. */
export function listasDaUrl(): ListasRecebidas | null {
  const p = new URLSearchParams(location.search);
  const d1 = p.get("deck1");
  const d2 = p.get("deck2");
  if (!d1 || !d2) return null;
  return {
    origem: "url",
    decks: [
      { nome: p.get("nome1") ?? "Seu deck", lista: d1 },
      { nome: p.get("nome2") ?? "Deck do oponente", lista: d2 },
    ],
  };
}

// --- decks salvos no navegador ---------------------------------------------

export interface DeckSalvo {
  nome: string;
  lista: string;
  chave: string;
}

/**
 * Le decks que o Inkwell tenha salvo no localStorage.
 *
 * ATENCAO — isto e leitura TOLERANTE, nao um contrato. Eu nao conheco o formato
 * real em que o Inkwell guarda os decks, entao aqui vao os formatos plausiveis;
 * o que nao casar e ignorado em silencio, sem quebrar nada.
 *
 * O caminho CONFIAVEL e o postMessage `inkwell-sim:load-decks`, onde o site
 * manda a lista no formato que ele ja usa para exportar. Quando o formato de
 * armazenamento for confirmado, esta funcao vira uma leitura direta e o resto
 * das heuristicas sai daqui.
 *
 * Somente leitura: o simulador nunca escreve no armazenamento do site.
 */
export function lerDecksSalvos(): DeckSalvo[] {
  const achados: DeckSalvo[] = [];
  let armazenamento: Storage;
  try { armazenamento = window.localStorage; } catch { return achados; }

  for (let i = 0; i < armazenamento.length; i++) {
    const chave = armazenamento.key(i);
    if (!chave) continue;
    let valor: unknown;
    try { valor = JSON.parse(armazenamento.getItem(chave) ?? ""); } catch { continue; }
    for (const candidato of Array.isArray(valor) ? valor : [valor]) {
      const deck = interpretarDeck(candidato, chave);
      if (deck) achados.push(deck);
    }
  }
  return achados;
}

type Registro = Record<string, unknown>;

function interpretarDeck(valor: unknown, chave: string): DeckSalvo | null {
  if (!valor || typeof valor !== "object") return null;
  const r = valor as Registro;
  const nome = String(r.nome ?? r.name ?? r.title ?? r.deckName ?? chave);
  const bruto = r.lista ?? r.list ?? r.cards ?? r.deck ?? r.cartas;
  const lista = paraTexto(bruto);
  return lista ? { nome, lista, chave } : null;
}

/** Converte os formatos plausiveis para o texto que o parser ja entende. */
function paraTexto(bruto: unknown): string | null {
  if (typeof bruto === "string" && bruto.includes("\n")) return bruto;

  // { "Aurora - Holding Court": 4, ... }
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    const linhas = Object.entries(bruto as Record<string, unknown>)
      .filter(([, q]) => typeof q === "number" && q > 0)
      .map(([nome, q]) => `${q} ${nome}`);
    return linhas.length > 0 ? linhas.join("\n") : null;
  }

  // [{ nome|name|fullName|card_id, qty|quantity|count }]
  if (Array.isArray(bruto)) {
    const linhas: string[] = [];
    for (const item of bruto) {
      if (!item || typeof item !== "object") continue;
      const r = item as Registro;
      const nome = r.fullName ?? r.name_en ?? r.nome ?? r.name ?? r.card;
      const qty = r.qty ?? r.quantity ?? r.count ?? r.qtd;
      if (typeof nome !== "string" || typeof qty !== "number" || qty <= 0) continue;
      const id = r.card_id ?? r.cardId ?? r.id;
      // Anexa a impressao quando existir: resolve nome com varias impressoes.
      const sufixo = typeof id === "string" ? ` (${id.replace(/^LOR/, "")})` : "";
      linhas.push(`${qty} ${nome}${sufixo}`);
    }
    return linhas.length > 0 ? linhas.join("\n") : null;
  }
  return null;
}
