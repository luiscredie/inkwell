# LigaLorcana 0.8.14 - Windows, 00h03

1. Na extensao atual, pause a coleta e exporte **Backup JSON + CSV**. Anote a contagem e o ID em `chrome://extensions`. Em `chrome://version`, confira o caminho do perfil: use a �ltima pasta (`Default` ou `Profile N`).
2. Feche somente o popup. Copie os arquivos desta pasta **sobre a mesma pasta da extensao j� instalada** (incluindo `worker.js`, `github.js`, `daily.js`, `daily-page.js`, `daily.html`, `manifest.json` e popup). Nao remova a extensao, nao carregue outra pasta e nao apague dados do Chrome. Em `chrome://extensions`, clique **Recarregar**. Confira versao 0.8.14, mesmo ID e contagem preservada. Uma coleta interrompida aguarda retomada manual; nao zere checkpoints.
3. Abra **Configurar, testar e consultar ID da extensao** no popup. Clique **Testar sem coletar**. Copie `extensionId`. Clique **Ativar coleta di�ria** somente quando estiver pronto para a pr�xima coleta. A ativa�ao arma o pr�ximo hor�rio; nao inicia coleta imediatamente.
4. Abra PowerShell na pasta permanente da extensao e teste o instalador, substituindo o ID:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-DailyTask.ps1 -ExtensionId SEU_ID_DE_32_LETRAS -ProfileDirectory 'Default' -DryRun
```

5. Instale repetindo o comando **sem `-DryRun`**. Nao precisa executar como administrador. A tarefa usa o usu�rio atual, diariamente �s **00h03 de Sao Paulo**; o instalador exige Windows no fuso Bras�lia para alinhar os dois agendamentos. Nao mova a pasta depois da instala�ao. Para consultar:

```powershell
Get-ScheduledTaskInfo -TaskName Inkwell-LigaLorcana-0003
```

A tarefa abre a p�gina interna no mesmo perfil Chrome. O alarme da extensao cobre o caso em que Chrome j� est� aberto. O marcador di�rio impede dois lotes no mesmo dia. Um acionamento atrasado inicia a coleta do dia atual; nao inventa pre�os de dias perdidos. O Windows deve estar ligado e com esse usu�rio conectado (pode estar bloqueado). WakeToRun depende do suporte do computador e dos timers de energia. Computador desligado ou usu�rio desconectado nao executa Chrome interativo.

O intervalo continua em **4000 ms**. A coleta usa uma aba existente da LigaLorcana ou abre uma nesse perfil, sem trocar cookies, fechar Chrome ou criar perfil. Nao use essa aba durante a coleta. Uma coleta ativa, pausada, interrompida ou com CAPTCHA nao � substitu�da pelo agendamento. Um lote encerrado em needs_review pode iniciar nova coleta no dia seguinte: antes disso, exporta snapshot e arquiva as pend�ncias em previousDailyReview. No mesmo dia, aguarda o pr�ximo dia. Pend�ncias antigas nao sao consideradas capturadas nem liberadas para publica�ao. Verifique `lastAction` na p�gina di�ria; resolva o problema e use **Iniciar / retomar** no popup. CAPTCHA mant�m a espera e at� duas verifica�oes de dez minutos; desafio persistente exige interven�ao humana.

Antes de um novo lote, o snapshot anterior � exportado em Downloads/Inkwell_LigaLorcana. Registros anteriores ficam como prote�ao, e URLs sao revisitadas para obter pre�os do novo dia. Erros de backup impedem o in�cio autom�tico. Checkpoints permanecem em chrome.storage.local.

## GitHub e publica�ao

Conecte GitHub no popup e marque **Enviar checkpoint ao GitHub ap�s cada edi�ao**. O token continua apenas em `chrome.storage.session`: fechar/reiniciar Chrome ou recarregar a extensao pode exigir nova conexao. Sem conexao, a coleta e os backups locais continuam; o log informa a falha. Ap�s reconectar, use **Enviar agora**. Nao h� promessa de envio autom�tico ap�s rein�cio sem autentica�ao.

O c�digo de upload permanece igual ao da 0.8.12: grava apenas os dados brutos em `feature/ligalorcana-review-pipeline`, no caminho `coletas/ligalorcana/coleta`. A valida�ao existente verifica identidade, conclusao de edi�ao e pre�os antes de propor atualiza�ao. **Aten�ao:** o workflow atual de publica�ao no reposit�rio pode habilitar auto-merge dos PRs de pre�os quando existe token de App. Esta atualiza�ao nao modifica nem dispara esse workflow durante testes. Antes de usar upload com exig�ncia de aprova�ao manual para cada publica�ao, desabilite o auto-merge no fluxo de publica�ao com autoriza�ao espec�fica. Nao considere upload de dados como garantia de que o live nao ser� atualizado pelo fluxo j� ativo.

Para suspender: clique **Desativar coleta di�ria** e desabilite a tarefa:

```powershell
Disable-ScheduledTask -TaskName Inkwell-LigaLorcana-0003
```

Desativar o agendamento nao interrompe uma coleta ativa; use **Pausar**. O resultado da tarefa Windows confirma apenas o lan�amento do Chrome, nao o sucesso da coleta ou publica�ao. Veja a p�gina di�ria, o popup, os logs e os checks do PR.
