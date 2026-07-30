# Recuperação de imagens — Disney → LigaLorcana

O agente agora usa `site/lorcana-card-images/image_manifest.json` como
checkpoint. Por padrão, ele processa somente cartas que:

- não possuem `image_file`; ou
- apontam para um arquivo local ausente/inválido.

Ordem de resolução:

1. reutiliza uma URL já descoberta no manifesto;
2. consulta a galeria oficial Disney/Ravensburger;
3. se ainda faltar, consulta a página específica da LigaLorcana usando nome,
   set e número;
4. só aceita a página da Liga quando título, nome completo e número conferem;
5. valida assinatura e `Content-Type` antes de publicar o arquivo.

O manifesto anterior é mesclado com os novos resultados. Uma execução parcial
ou com `--limit` nunca remove entradas válidas já publicadas.

## Comando recomendado

No PowerShell, a partir da raiz `inkwell`:

```powershell
python .\tools\lorcana_image_agent.py `
  --workers 4 `
  --retries 3 `
  --timeout 30 `
  --liga-delay 0.65
```

Não use `--overwrite`: o modo padrão já trabalha apenas nas pendentes.

Se uma execução anterior gravou `cards.json` sem o prefixo `images/`, repare
sem consultar a internet nem baixar novamente:

```powershell
python .\tools\lorcana_image_agent.py --repair-paths-only
```

Para conferir os caminhos sem baixar:

```powershell
python .\tools\lorcana_image_agent.py --show-paths
```

Para teste pequeno sem truncar o manifesto:

```powershell
python .\tools\lorcana_image_agent.py --limit 10
```

## Validação e publicação

```powershell
python .\tools\validate_card_art.py --root .\site
python .\tools\refresh_data_manifest.py --root .\site
python .\tools\validate_release.py --root .\site --quick
```

Depois, revise `download_summary.json`. Ele informa quantas cartas foram
resolvidas pela Disney, quantas pela LigaLorcana e se a Liga respondeu com
403/429. Somente então faça commit das novas imagens, dos manifestos e do
`cards.json` atualizado.
