# Inkwell Android: teste integrado no aparelho

**Versão de testes, não publicada. 2ª rodada (24/11).** Branch `test/android-integrado`, PR draft #329. Reúne o app (#325), o Scanner 2.0 com página 3×3 (#324, com a correção tocando na foto), o scanner contínuo (#328) e o Início com motivo do erro e recuperação automática (#331). Nada disso está no site nem nas lojas.

## 1. Identificação do APK

| | |
|---|---|
| Nome do app no celular | **Inkwell Teste** (ícone do Inkwell) |
| Pacote | `br.com.inkwell.app.teste`: instala ao lado de qualquer outro Inkwell, sem substituir |
| Versão | `0.1.0-teste-integrado` (instala por cima da 1ª rodada, mantém o login) |
| Arquivo | **`Inkwell-Android-Teste-Integrado-45ba96b-release.apk`** (11,1 MB) |
| Branch e commit | `test/android-integrado` · `45ba96b91731d6607b6201804a68cf6821687b07` |
| SHA-256 | `024fb0c6e02f00cc1b72c98696d5ca5ff35e6c190fa7e13189473e0d0a4f6184` |
| Download | https://github.com/luiscredie/inkwell/actions/runs/45512596305/artifacts/14976766749 (entre no GitHub; o artefato vale 90 dias) |
| Conteúdo | Páginas embarcadas no app (abre sem internet). Imagens das cartas e preços vêm de `inkwell.com.br` |

## 2. Antes de começar (importante)

- **O app usa a sua conta e a sua coleção de verdade** (o mesmo banco do site). O login é real.
- **Nos testes de scanner, termine com "Descartar a lista"**, a não ser no passo 7, que grava **uma** carta de propósito e mostra como desfazer. Nada é gravado antes de "Adicionar N cartas à coleção".
- **Entre com o código de 6 a 8 dígitos do e-mail, não pelo link.** Nesta versão, o link do e-mail abre o navegador, não o app. Passkeys provavelmente não funcionam dentro do app (motivo em `docs/mobile-dominios.md`).
- Precisa de internet para as imagens das cartas e os preços.

## 3. Instalar

1. No celular, abra o link do artefato que eu enviar (página do GitHub Actions; entre na sua conta do GitHub). Baixe o arquivo `.zip`.
   - Se eu enviar o `.apk` direto pela conversa, pule para o passo 3.
2. Abra o `.zip` no app **Arquivos** (ou "Meus arquivos") e toque em **Extrair**.
3. Toque no arquivo `.apk`. O Android vai pedir para **permitir instalar apps desta fonte**: permita só para o app usado (Arquivos ou o navegador).
4. Se aparecer o aviso do **Play Protect** ("app não verificado"), toque em **Mais detalhes → Instalar mesmo assim**. É esperado num APK de teste, sem assinatura de loja.
5. Abra **Inkwell Teste**.

Para remover depois: segure o ícone, toque em **Desinstalar** e, nas configurações, volte a desativar "instalar apps desconhecidos" para aquele app.

## 4. Roteiro da 2ª rodada (10 a 15 minutos)

Foco: o que travou na 1ª rodada (correção do 3×3, tempo e Início). Marque ✅ ou ❌; em qualquer ❌, tire uma captura (seção 5) e siga.

| # | Passo | O que deve acontecer | ✅/❌ |
|---|---|---|---|
| 1 | Abrir **Inkwell Teste** e entrar com o código do e-mail | Início carrega coleção e decks. Se algo não carregar, a caixa agora diz **por quê** (sem internet, conexão caiu, sessão, servidor): **anote a frase exata**. | |
| 2 | **Modo avião** ligado → fechar e abrir o app → Início | O app abre; as caixas dizem "Não deu para carregar…" com o motivo ("A conexão falhou." no emulador; alguns aparelhos dizem "Sem conexão com a internet…"). | |
| 3 | Desligar o modo avião **sem tocar em nada** | Em até ~30 s, o Início carrega sozinho (no emulador: 5 s). | |
| 4 | Coleção → **Escanear** → **Página 3×3** → fotografar uma **página real** | Barra de progresso; a foto aparece com selos sobre cada carta (✓ verde, ? âmbar/vermelho, – cinza). **Anote o tempo** exibido no canto do rodapé. | |
| 5 | **Rolar a tela com o dedo começando em cima da foto** | A tela rola (na 1ª rodada não rolava). | |
| 6 | **Tocar numa carta da foto** | Abre "Posição X de 9": a sua foto ao lado da sugestão, e os botões "Confirmar esta carta", "Buscar outra carta", "Deixar de fora". | |
| 7 | No rodapé, **Resolver N posições** | Abre a primeira pendente; "Pendência 1 de N". Cada decisão avança sozinha para a próxima; teste também "‹ Pendência anterior / Próxima pendência ›". | |
| 8 | Corrigir uma por **Buscar outra carta** (digite parte do nome) e deixar outra **de fora** | A busca acha a carta; ao escolher, avança. | |
| 9 | Com tudo resolvido: **Continuar para revisão (N cartas)** | Vai direto para a revisão final. **Nada foi gravado até aqui.** | |
| 10 | **Descartar a lista** (dois toques) | A coleção fica igual. | |
| 11 | Repetir 4 a 10 com outra página (com reflexo ou luz fraca) | Anotar: posições certas sem correção, de 9; tempo; se travou. | |
| 12 | Scanner contínuo (**Uma carta**), 5 cartas reais → Concluir → Descartar | Continua como antes. | |

**Resultados que mais ajudam o Conselho:** o tempo exibido em cada página (passos 4 e 11), quantas posições vieram certas, e a frase exata de qualquer caixa de erro no Início.

## 5. Como registrar erros sem expor dados privados

- **Captura de tela:** botão liga/desliga + volume para baixo.
- **Antes de enviar,** corte ou tape: o seu **e-mail** (topo do login e do perfil), **códigos do e-mail**, notificações de outros apps e **nomes de outras pessoas** (amigos, comunidades). A coleção e os nomes de cartas podem aparecer.
- **Não envie** o código de login nem prints da caixa de e-mail.
- Para cada ❌, anote em uma linha: **passo · o que esperava · o que aconteceu · hora aproximada** (por exemplo, "8 · 9 posições · ficou em 'Reconhecendo 3 de 9' por 1 min · 19h42").
- Modelo do aparelho e versão do Android: Configurações → Sobre o telefone (só modelo e versão).

## 6. O que já foi testado, e onde

### Automatizados (commit 45ba96b; CI do PR #329 com os 9 checks verdes)
- Escanear página: Chromium 11/11, WebKit (iPhone) 9/9 (+2 que só rodam no Chromium); unitários 49/49.
  Inclui o bloqueio da 1ª rodada reproduzido (4 pendentes → toque na foto → todas corrigidas → revisão; nada gravado antes), rolagem por toque começando na foto, telas de 320×568 a 430×932, tela usável durante o OCR e "1 Worker = 3 Workers" (mesmas respostas).
- Início: 16/16, incluindo sem conexão → volta sozinho, queda passageira, sessão inválida × servidor e o caso sem evento "online".
- Coleção e scanner contínuo: 79/79. A bateria completa do CI em Chromium e WebKit.

### No emulador Android (API 34, dentro do app instalado; Supabase falso, nada chegou à produção) — 9/9
1. Abre na página inicial. 2. Login por código. 3. Coleção. 4. Decks.
5. Scanner contínuo: 1 carta lida, listada, revisada e gravada só depois da confirmação.
6. **Página 3×3 com 4 pendências:** toque na carta da foto, as 4 resolvidas no editor, "Continuar para revisão (9 cartas)", gravadas só depois de "Adicionar 9 cartas". **Gesto real começando na foto rolou a tela** (372 px).
7. Segunda página (tempos).
8. **Modo avião de verdade:** o Início diz "A conexão falhou." (no WebView do Android, `navigator.onLine` continuou verdadeiro) e, com o modo avião desligado, **carregou sozinho em 5 s**, sem toque.
9. Botão "voltar" do Android: fica no app.

**Tempos no emulador** (2 núcleos, 1 Worker; o emulador varia muito entre execuções e **não representa um celular**):

| Execução (mesmo emulador, 1ª página) | Tela pronta | OCR depois |
|---|---|---|
| OCR iniciando durante o reconhecimento (d8bcfdb/b91aed6) | 15,1 s | 10,3 s |
| OCR só depois da tela pronta (ac1728b) | 10,6 s | 13,5 s |
| + aquecimento dos Workers (45ba96b) | **2,8 s** | 6,5 s |

Segunda página (Workers e leitor já prontos): 4,5 a 5,1 s até a tela pronta; OCR de 2 reimpressões ≈ 1 s.

Compilação: APK release e dev; iOS dev e release compilados e abertos no simulador.

### Só o aparelho real confirma
- Câmera de verdade: foco, luz, reflexo do plástico, velocidade com cartas reais, foils reais.
- **Precisão com cartas e páginas reais.** Nenhum número de precisão vale antes disso; os anteriores são de imagens sintéticas.
- **Tempo num celular real.** O tempo aparece no rodapé da tela de conferência; anote-o em cada página.
- Login com o código real do seu e-mail e a sua coleção real.
- OCR das reimpressões no celular (baixado do CDN na primeira vez).
- Aparência real: a foto atrás dos contornos, a barra inferior em relação aos botões do Android, o teclado.

## 7. Limitações conhecidas desta versão
- **Link mágico do e-mail** abre o navegador, não o app: use o código. **Passkeys** provavelmente não funcionam no app.
- **Foil não é detectado:** use "Normal/Foil" no topo do scanner ou toque em "normal" na revisão.
- Links de compartilhamento gerados dentro do app podem sair com endereço `localhost` (correção prevista; não use para compartilhar).
- **Preços e imagens** precisam de internet; sem rede, o app abre sem eles.
- **Scanner contínuo:** cada carta leva ~1,4 s no computador; no celular pode levar mais. Reimpressões em que o número não foi lido entram como "impressão a escolher" (resolver na revisão).
- **Página 3×3:** só o formato 3×3; os cantos não são detectados automaticamente ("Ajustar cantos"). O número das reimpressões é lido depois que a tela fica pronta: uma pendência pode virar ✓ sozinha enquanto você confere.
- Na 1ª vez, o leitor de números (OCR) baixa alguns MB do CDN; nas páginas seguintes é rápido.
- Sem notificações nesta versão.
