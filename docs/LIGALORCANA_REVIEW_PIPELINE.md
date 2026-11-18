# LigaLorcana — pipeline de revisão (sem publicação)

Este fluxo é **isolado** do Inkwell live e do PR #248. Não altera `site/data`, banco nem preços de produção.

## Estrutura de arquivos

- `coletas/ligalorcana/coleta/coleta_<timestamp UTC>.json`: arquivo bruto com `schema=inkwell-ligalorcana-local-v1`, imutável.
- `coletas/ligalorcana/tratados/AAAA-MM-DD/coleta_<timestamp>/cartas.json` e `cartas.csv`: dados com nome decodificado e centavos preservados.
- `coletas/ligalorcana/tratados/relatorios/coleta_<timestamp>.json`: rejeições, problemas de preço e auditoria.
- `coletas/ligalorcana/data/AAAA-MM-DD/coleta_<timestamp>.json`: contrato intermediário para importação revisada, com `publicavel=false`.

**Nunca mover/apagar o bruto**: mantém a trilha de auditoria. A pasta `data` aqui não é `site/data`; não alimenta a aplicação automaticamente.

## Como funciona

1. Uma extensão Chrome coleta as cartas e, após autorização OAuth, pode enviar JSON para a branch `feature/ligalorcana-review-pipeline`.
2. Um PR draft de código e/ou dados nessa branch dispara `ligalorcana-stage.yml` ao receber novos arquivos `coletas/ligalorcana/coleta/*.json` (sujeito às regras de execução do Actions).
3. O workflow chama `tools/ligalorcana_stage.py`, cria os arquivos em `tratados` e `data` e registra as pendências.
4. Claude recebe o JSON `data/AAAA-MM-DD` e o relatório. Valida contra o catálogo e o integrador do PR #248, pede aprovação e **só então** pode propor atualização do site.

O arquivo tratado não é publicação automática e não significa que os registros estejam integralmente corretos. `missing`, `partial` e `invalid_order` exigem revisão. É proibido transformar valor ausente em zero ou trocar valores para satisfazer mínimo ≤ médio ≤ máximo.

## Execução local de teste

```shell
python tools/ligalorcana_stage.py --source caminho/para/coleta_2026-11-18T00-16-32-015Z.json --root build/ligalorcana-review
```

A execução de Action e OAuth precisa de validação real antes de depender de upload automático. Sem autorização de merge e publicação.
