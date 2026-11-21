# Inkwell AI Lab — dashboard e protocolo experimental

Este módulo é independente do produto Inkwell live. **Não mesclar este PR sem autorização.**

## Limite científico atual

O treino local (coach_rl_nightly.py) usa REINFORCE contextual-bandit: uma
decisão de mulligan recebe recompensa de uma heurística V3 dos três primeiros
turnos. NÃO há jogo completo e os números NÃO são probabilidade de vitória.

O GitHub deve receber APENAS métricas agregadas: episódios, lotes,
diferenças de recompensa, intervalos de confiança, número de promoções
e contagens do Observador/coletor. **NÃO enviar** gamelogs, tokens, decklists,
hashes de decks, IDs de partidas, nomes de jogadores, backups, pesos ou TSV original.

O repositório e a branch ai-lab-metrics são públicos.

## O que podemos reproduzir do método MaroneFed

O guia relata quatro servidores testando listas entre si, contra o metagame,
com mesma IA, adversários e quantidade de jogos para comparações controladas.
O guia NÃO revela o código do simulador, o motor de regras, a política adversária
nem os dados completos. Não devemos dizer que reproduzimos os resultados dele.

Protocolo futuro, somente depois de um motor validado:

1. Congelar versões de decks, formato, regras e cartas.
2. Definir matriz fixa de oponentes (Detetives, espelho, Circle, Retro etc.).
3. Usar as mesmas sementes e oponentes por candidato, alternando play/draw.
4. Testar timing, tinta, Shift, Songs, Support, Resist, Evasive, Ward e Alert.
5. Relatar vitórias por matchup com amostras, IC95% e play/draw separadamente.
6. Usar holdout com sementes que não entraram na escolha do modelo.
7. Promover somente quando superar campeão em métricas independentes.
8. Mudar uma variável por vez; versionar critérios de aceitação.

## A promoção do RL atual

A leitura do treinador local confirma os três gates simultâneos:
- diferença média no proxy >= +0.10;
- limite inferior de IC95% > 0;
- delta da heurística secundária V2 >= -0.25.

Por isso muitos lotes com IC95% positivo não foram promovidos.

## Parada por platô

ai_lab_plateau_guard.py retorna código 10 (solicitação de parada) se:
- ao menos 150 lotes sem promoção desde o começo; ou 100 após a última promoção;
- e nenhum dos 30 últimos candidatos atingiu delta médio de +0.10.

A parada não prova convergência. É apenas uma política conservadora para
economizar recursos. O gate deve ser ligado ao executor noturno local.

## Dashboard público

Página: site/ai-lab/index.html — só será publicada após aprovação do PR.
JSON: branch independente ai-lab-metrics, caminho data/latest.json.
Exportador: tools/ai_lab_metrics.py, Python padrão, sem conexão com duels.ink.

O exportador produz JSON por allowlist, não o TSV original. Precisa do GitHub
CLI (gh) autenticado no próprio WSL para fazer o upload. Não colar tokens em chats.

### Comandos locais, depois de copiar os scripts para src

- Exportar: python src/ai_lab_metrics.py
- Revisar: cat ~/.local/share/inkwell-ai-lab/duels/dashboard/latest.json
- Autenticar (uma vez): gh auth login
- Publicar: python src/ai_lab_metrics.py --publish

A atualização automática deve rodar uma vez ao dia após o fechamento do
treinamento noturno, como o usuário WSL autenticado.

## Segurança de publicação

Este PR é rascunho e não faz deploy do site. A branch pública ai-lab-metrics
começa com JSON vazio. Nenhuma execução foi feita remotamente no PC.
