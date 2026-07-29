# Inkwell — padrão de tradução PT-BR

Este pacote melhora o overlay `cards.pt.json` sem alterar o contrato de dados.
Ele é uma tradução comunitária para legibilidade no Inkwell, não uma tradução
oficial publicada pela Ravensburger.

## Princípios congelados

- Nomes das cartas continuam em inglês.
- `card_id`, `ability_id`, `ability_count` e `source_fingerprint` não mudam.
- Regras devem preservar números, símbolos e funcionamento da carta inglesa.
- Reimpressões com o mesmo texto inglês devem usar a mesma tradução.
- Uma correção incerta vira pendência editorial; ela não deve inventar uma regra.

## Glossário

| Inglês | PT-BR usado no Inkwell |
|---|---|
| quest | buscar Lore |
| exert / exerted | exertar / exertado |
| ready | preparar / preparado |
| draw | comprar |
| inkwell | tinteiro |
| deck | baralho |
| hand | mão |
| discard | descarte |
| banish | banir |
| challenge | desafiar |
| opposing / opponent | adversário |
| chosen | escolhido |
| damage | dano |
| song | canção |
| play a card | jogar uma carta |
| for free | sem pagar o custo |
| lore | Lore |

## Keywords

| Inglês | PT-BR |
|---|---|
| Shift | Transformar |
| Evasive | Evasivo |
| Bodyguard | Guarda-costas |
| Ward | Proteção |
| Support | Apoio |
| Rush | Ímpeto |
| Boost | Impulso |
| Resist | Resistir |
| Challenger | Desafiante |
| Singer | Cantor |
| Sing Together | Cantar Juntos |
| Reckless | Imprudente |
| Vanish | Desvanecer |

## Uso

Na raiz do projeto:

```powershell
python .\tools\refine_cards_pt.py `
  --english .\site\data\cards.json `
  --portuguese .\site\data\cards.pt.json `
  --output .\site\data\cards.pt.improved.json `
  --report .\site\data\translation-report.json
```

Para bloquear o processo enquanto existir qualquer pendência editorial, acrescente
`--strict`. O código de saída será `2` se o relatório ainda tiver achados.

Antes de substituir o arquivo publicado:

1. revisar os `ability_id` listados no relatório;
2. executar os testes;
3. renomear o arquivo aprovado para `cards.pt.json`;
4. regenerar o checksum e o tamanho em `site/data-manifest.json`;
5. executar `validate_release.py --root site`;
6. fazer o smoke test EN/PT.
