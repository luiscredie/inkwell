# Inkwell Android: teste integrado no aparelho

**Versão de testes, não publicada.** Branch `test/android-integrado`, PR draft #329. Reúne o app (#325), o Scanner 2.0 com página 3×3 (#324) e o scanner contínuo (#328). Nada disso está no site nem nas lojas.

## 1. Identificação do APK

| | |
|---|---|
| Nome do app no celular | **Inkwell Teste** (ícone do Inkwell) |
| Pacote | `br.com.inkwell.app.teste`: instala ao lado de qualquer outro Inkwell, sem substituir |
| Versão | `0.1.0-teste-integrado` |
| Arquivo | `Inkwell-Android-Teste-Integrado-<commit>-release.apk` |
| Conteúdo | Páginas embarcadas no app (abre sem internet). Imagens das cartas e preços vêm de `inkwell.com.br` |
| Commit, link e SHA-256 | No relatório de entrega, junto do link do artefato |

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

## 4. Roteiro (15 a 20 minutos)

Marque ✅ ou ❌ em cada linha. Em qualquer ❌, tire uma captura (seção 5) e siga para o próximo passo.

| # | Passo | O que deve acontecer | ✅/❌ |
|---|---|---|---|
| 1 | Abrir **Inkwell Teste** | Splash escuro com o ícone e, em seguida, "Seu lugar no mundo de Lorcana." A barra inferior fica acima dos botões do Android. | |
| 2 | **Entrar** → seu e-mail → **Enviar código** → digite o código do e-mail | Entra na conta; o avatar aparece no topo. *(Tempo: ~1 min)* | |
| 3 | Fechar o app (tirar da lista de recentes) e abrir de novo | Continua logado. | |
| 4 | **Coleção** na barra inferior | Sua coleção com imagens e o valor em R$. Rolar e buscar uma carta. | |
| 5 | **Decks** → abrir um deck → **Testar mão**; depois, o botão "voltar" do Android | Mão de 7 cartas; mulligan funciona. **Observar** o que o "voltar" faz (volta uma tela ou fecha o app): não foi verificado em aparelho. | |
| 6 | **Scanner contínuo:** Coleção → **Escanear** → permitir a câmera → **Uma carta**. Passe **8 a 10 cartas reais**, uma de cada vez, inclusive **2 cópias iguais seguidas**, **1 foil** e, se tiver, **1 Enchanted ou promo** com a mesma arte de uma comum | Cada carta entra sozinha (vibra), sem tocar na tela. A faixa de miniaturas cresce, e "N na lista · ≈ R$ …" atualiza. Reimpressões duvidosas aparecem com "?". *(Tempo: ~4 min. Anote quantas entraram certas e quanto tempo cada uma levou, aproximadamente.)* | |
| 6b | **Concluir** → revisão | As cartas com "impressão a escolher" ficam no topo, e "Adicionar" fica bloqueado até você escolher. Toque em "normal" numa linha e ela vira "foil". Confira que as 2 cópias iguais aparecem como ×2. | |
| 6c | **Descartar a lista** (toque duas vezes) | Nada é gravado; a coleção fica igual. | |
| 7 | *(Opcional, testa a gravação)* Escanear **1** carta → Concluir → **Adicionar 1 carta à coleção** | A carta aparece na coleção. Depois, abra a carta e tire a cópia (−) para desfazer. | |
| 8 | **Página 3×3:** Escanear → **Página 3×3**. Enquadre uma **página real do fichário**, com as 9 cartas dentro da moldura, e toque em **Fotografar página** | "Reconhecendo X de 9…" e, depois, a foto com contornos coloridos (verde = ok, âmbar = conferir, cinza = vazia) e o tempo em segundos. **A tela não deve travar**: tente rolar durante o reconhecimento. *(Anote o tempo exibido.)* | |
| 8b | Tocar numa posição âmbar | Editor com a foto da posição e sugestões; escolher a certa. Testar "Deixar de fora". O rodapé lista o que fica de fora. | |
| 8c | Se as linhas não estiverem sobre as cartas: arrastar um canto → **Reconhecer de novo** | Contornos acompanham os cantos. | |
| 8d | **Pôr N cartas na lista** → Concluir → **Descartar a lista** | Nada gravado. | |
| 9 | Repetir o passo 8 com **outra página**, de preferência com reflexo do plástico ou luz mais fraca | Anotar quantas das 9 vieram certas sem correção. | |
| 10 | Modo avião ligado → fechar e abrir o app | O app abre (páginas embarcadas); sem preços e sem imagens novas. Desligar o modo avião. | |

**Resultados que mais ajudam o Conselho:**
- Passo 6: cartas certas, cartas perdidas e tempo por carta.
- Passos 8 e 9: posições certas sem correção, de 9; tempo exibido; e se travou ou não.

## 5. Como registrar erros sem expor dados privados

- **Captura de tela:** botão liga/desliga + volume para baixo.
- **Antes de enviar,** corte ou tape: o seu **e-mail** (topo do login e do perfil), **códigos do e-mail**, notificações de outros apps e **nomes de outras pessoas** (amigos, comunidades). A coleção e os nomes de cartas podem aparecer.
- **Não envie** o código de login nem prints da caixa de e-mail.
- Para cada ❌, anote em uma linha: **passo · o que esperava · o que aconteceu · hora aproximada** (por exemplo, "8 · 9 posições · ficou em 'Reconhecendo 3 de 9' por 1 min · 19h42").
- Modelo do aparelho e versão do Android: Configurações → Sobre o telefone (só modelo e versão).

## 6. Testes já feitos antes da entrega

O relatório de entrega separa o que foi testado por automação, em emulador e o que só o aparelho real confirma.
