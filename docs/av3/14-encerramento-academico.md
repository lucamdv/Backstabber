# Backstabber · Encerramento acadêmico da AV3

Revisão de 24/11/2026. **AV3 encerrada com partida hospedada completa.** O Spring Boot é a entrega acadêmica da AV3. A evolução do jogo segue na arquitetura Node.js. A branch Java conserva o ambiente de demonstração publicado.

## Fontes e alcance

A matriz abaixo reproduz os critérios finais dos briefings originais das Sprints 03.1 a 03.4 e os gates da 03.5. São os requisitos de projeto disponibilizados para a revisão. Caso a disciplina tenha uma rubrica externa, sua correspondência precisa ser conferida com o enunciado. Requisitos sobre arquivos, histórico Git e infraestrutura estão avaliados no recorte da sprint que os definiu. O escopo posterior autorizou mudanças de Auth compartilhado e implantação em schema isolado.

**Atendido** indica evidência no código, nos ensaios ou no histórico da sprint. **Parcial** indica implementação ou prova com uma lacuna descrita. **Pendente** indica que a evidência exigida ainda falta. A comparação histórica com Node orienta a avaliação do contrato da época.

## Arquitetura para a apresentação

| Camada | Responsabilidade |
| --- | --- |
| React/Vite na Vercel | Lobby, arena e decisões do jogador. O Preview Java usa a API HTTPS do Render. |
| Supabase Auth | Login Google e email verificado. O Spring valida o bearer pelo Auth e recebe o UUID canônico. |
| Spring Boot / Java 21 no Render | API HTTP, autorização, domínio autoritativo, controle de revisão e projeções privadas por jogador. |
| PostgreSQL | Layout `bs_staging` com papel restrito. Persiste salas, partidas e comandos com idempotência, transações e ordem de locks sala → partida. |
| Supabase Realtime | Canais privados `hml:user:` e `hml:room:` invalidam snapshots. O cliente carrega a visão autorizada na API. |
| Node.js oficial | Produção continua usando as tabelas `public.bs_*` e seus canais. O Auth é compartilhado, os dados de jogo são separados. |

- [Preview acadêmico da Vercel](https://backstabber-homologacao-git-feat-6522ba-luca-monteiros-projects.vercel.app)
- [Readiness do Spring no Render](https://backstabber-java-staging.onrender.com/actuator/health/readiness)
- [Inventário](01-backend-inventory.md) · [Arquitetura](02-spring-boot-architecture.md) · [Social](04-sprint-03-2-social-lobby.md) · [Motor](05-sprint-03-3-game-engine.md) · [Persistência](06-sprint-03-4-match-persistence.md)
- [Ensaio local com três jogadores](07-sprint-03-5-integration-homologation.md) · [Isolamento](10-sprint-03-5c-shared-staging.md) · [Autenticação gerenciada](../auth/validation-report.md)

## Critérios originais

### Sprint 03.1

| Item | Critério original | Estado | Evidência |
| --- | --- | --- | --- |
| 03.1.1 | Branch Java criada a partir da `main`. | Atendido | Histórico Git da branch Java |
| 03.1.2 | Produção permaneceu intacta. | Atendido | Histórico da Sprint 03.1 e registros de implantação |
| 03.1.3 | Auditoria do Node.js concluída. | Atendido | Inventário 01 |
| 03.1.4 | Spring Boot executável em `backend/`. | Atendido | Arquitetura 02, backend/pom.xml, Dockerfile e código |
| 03.1.5 | Java 21 configurado. | Atendido | Arquitetura 02, backend/pom.xml, Dockerfile e código |
| 03.1.6 | Maven Wrapper funcional. | Atendido | Arquitetura 02, backend/pom.xml, Dockerfile e código |
| 03.1.7 | Estrutura de pacotes organizada. | Atendido | Arquitetura 02, backend/pom.xml, Dockerfile e código |
| 03.1.8 | Spring Security configurado. | Atendido | Arquitetura 02, backend/pom.xml, Dockerfile e código |
| 03.1.9 | Autenticação Supabase validada. | Atendido | Arquitetura 02 e testes da foundation |
| 03.1.10 | Erros HTTP seguem o contrato original. | Atendido | Arquitetura 02 e testes da foundation |
| 03.1.11 | Health check funcional. | Atendido | Arquitetura 02 e testes da foundation |
| 03.1.12 | PostgreSQL configurado com segurança. | Atendido | Arquitetura 02 e testes da foundation |
| 03.1.13 | Testes com PostgreSQL real funcionando. | Atendido | Arquitetura 02 e regressão com PostgreSQL real no relatório 07 |
| 03.1.14 | Primeiro endpoint GET `/api/v1/profile` compatível. | Atendido | Arquitetura 02 e regressão com PostgreSQL real no relatório 07 |
| 03.1.15 | Nenhuma alteração no motor local. | Atendido | Escopo histórico da Sprint 03.1 nos relatórios 01–03 |
| 03.1.16 | Nenhuma alteração nas regras online. | Atendido | Escopo histórico da Sprint 03.1 nos relatórios 01–03 |
| 03.1.17 | Nenhuma alteração no frontend de produção. | Atendido | Escopo histórico da Sprint 03.1 nos relatórios 01–03 |
| 03.1.18 | Nenhuma migração aplicada ao Supabase remoto. | Atendido | Escopo histórico da Sprint 03.1 nos relatórios 01–03 |
| 03.1.19 | Testes e documentação concluídos. | Atendido | Relatórios 01–03 e regressões do relatório 07 |
| 03.1.20 | Nenhum segredo versionado. | Parcial | Auditoria dos diffs e arquivos da entrega. Não houve varredura integral de toda a história Git nesta revisão. |

### Sprint 03.2

| Item | Critério original | Estado | Evidência |
| --- | --- | --- | --- |
| 03.2.1 | Branch Java publicada no GitHub. | Atendido | Histórico Git e regressão da foundation no relatório 04 |
| 03.2.2 | Foundation 03.1 preservada. | Atendido | Histórico Git e regressão da foundation no relatório 04 |
| 03.2.3 | PUT `/profile` compatível. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.4 | Heartbeat social compatível. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.5 | Busca de usuários compatível. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.6 | Sistema de amizades compatível. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.7 | Convites compatíveis. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.8 | Criação e entrada de salas compatíveis. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.9 | Prontidão compatível. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.10 | Presença e heartbeat compatíveis. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.11 | Saída e transferência de anfitrião compatíveis. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.12 | Fechamento de salas compatível. | Atendido | Relatório 04, 35 respostas HTTP em paridade social e ensaio integrado local do relatório 07 |
| 03.2.13 | Nenhuma sala excede sua capacidade sob concorrência. | Atendido | Relatório 04, corridas no PostgreSQL 17.11 |
| 03.2.14 | Nenhum convite é consumido duas vezes. | Atendido | Relatório 04, corridas no PostgreSQL 17.11 |
| 03.2.15 | Nenhuma amizade duplicada é criada. | Atendido | Relatório 04, corridas no PostgreSQL 17.11 |
| 03.2.16 | Autorização depende exclusivamente da sessão. | Atendido | Relatório 04, autorização e contrato HTTP |
| 03.2.17 | As respostas JSON seguem os contratos atuais. | Atendido | Relatório 04, autorização e contrato HTTP |
| 03.2.18 | Os erros HTTP seguem os contratos atuais. | Atendido | Relatório 04, autorização e contrato HTTP |
| 03.2.19 | RLS e triggers existentes permanecem intactos. | Atendido | Relatório 04, migration de referência e ensaios PostgreSQL |
| 03.2.20 | PostgreSQL nativo foi utilizado na validação. | Atendido | Relatório 04, migration de referência e ensaios PostgreSQL |
| 03.2.21 | Testes de concorrência foram executados. | Atendido | Relatório 04, migration de referência e ensaios PostgreSQL |
| 03.2.22 | Testes Java passaram. | Atendido | Relatório 04, 50 testes Java aprovados. Regressão web executada com uma oscilação documentada |
| 03.2.23 | Regressões Node/React avaliadas. | Atendido | Relatório 04, 50 testes Java aprovados. Regressão web executada com uma oscilação documentada |
| 03.2.24 | Frontend não foi modificado. | Atendido | Escopo histórico da Sprint 03.2 no relatório 04 |
| 03.2.25 | Backend Node.js não foi modificado. | Atendido | Escopo histórico da Sprint 03.2 no relatório 04 |
| 03.2.26 | Produção permaneceu intacta. | Atendido | Escopo histórico da Sprint 03.2 no relatório 04 |
| 03.2.27 | Início de partida não foi falsamente implementado. | Atendido | Escopo histórico da Sprint 03.2 no relatório 04 |
| 03.2.28 | Documentação atualizada. | Atendido | Relatório 04 |

### Sprint 03.3

| Item | Critério original | Estado | Evidência |
| --- | --- | --- | --- |
| 03.3.1 | Motor autoritativo Java implementado. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.2 | Estado interno compatível com Node.js. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.3 | Baralho e distribuição inicial equivalentes. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.4 | Sorteios determinísticos equivalentes. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.5 | Todas as ações migradas. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.6 | Todos os bloqueios migrados. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.7 | Todas as contestações migradas. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.8 | Todas as consequências migradas. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.9 | Broker equivalente. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.10 | Backstab equivalente. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.11 | Eliminação e vitória equivalentes. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.12 | Regras de jogadores vivos preservadas. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.13 | Janelas coletivas equivalentes. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.14 | Prioridade de votos equivalente. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.15 | Ciência coletiva equivalente. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.16 | Auditoria equivalente. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.17 | Revisões equivalentes. | Atendido | Relatório 05, 21 roteiros de paridade do domínio e 200 comandos, com 462 amostras de RNG |
| 03.3.18 | Comandos inválidos rejeitados sem modificar estado. | Atendido | Relatório 05, rejeições, serialização e 1.001 projeções comparadas |
| 03.3.19 | Transições não alteram o estado original. | Atendido | Relatório 05, rejeições, serialização e 1.001 projeções comparadas |
| 03.3.20 | Projeção individual equivalente. | Atendido | Relatório 05, rejeições, serialização e 1.001 projeções comparadas |
| 03.3.21 | Nenhum vazamento de cartas privadas. | Atendido | Relatório 05, rejeições, serialização e 1.001 projeções comparadas |
| 03.3.22 | JSON de estados Node.js pode ser desserializado em Java. | Atendido | Relatório 05, rejeições, serialização e 1.001 projeções comparadas |
| 03.3.23 | JSON de estados Java pode ser comparado com o Node.js. | Atendido | Relatório 05, rejeições, serialização e 1.001 projeções comparadas |
| 03.3.24 | Testes de paridade determinística aprovados. | Atendido | Relatório 05, 78 testes Maven com PostgreSQL e paridade |
| 03.3.25 | Foundation 03.1 preservada. | Atendido | Relatório 05, 78 testes Maven com PostgreSQL e paridade |
| 03.3.26 | Social/Lobby 03.2 preservado. | Atendido | Relatório 05, 78 testes Maven com PostgreSQL e paridade |
| 03.3.27 | Nenhuma alteração no frontend. | Atendido | Escopo histórico da Sprint 03.3 no relatório 05 |
| 03.3.28 | Nenhuma alteração no Node.js de produção. | Atendido | Escopo histórico da Sprint 03.3 no relatório 05 |
| 03.3.29 | Nenhuma alteração no Supabase remoto. | Atendido | Escopo histórico da Sprint 03.3 no relatório 05 |
| 03.3.30 | Nenhuma alteração na `main`. | Atendido | Escopo histórico da Sprint 03.3 no relatório 05 |
| 03.3.31 | Documentação atualizada. | Atendido | Relatório 05 |

### Sprint 03.4

| Item | Critério original | Estado | Evidência |
| --- | --- | --- | --- |
| 03.4.1 | A branch Java existente foi preservada. | Atendido | Histórico da branch e escopo da Sprint 03.4 no relatório 06 |
| 03.4.2 | A `main` não foi alterada. | Atendido | Histórico da branch e escopo da Sprint 03.4 no relatório 06 |
| 03.4.3 | Produção Node.js permanece intacta. | Atendido | Histórico da branch e escopo da Sprint 03.4 no relatório 06 |
| 03.4.4 | `/rooms/:id/start` está implementado. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.5 | `/matches/:id` está implementado. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.6 | `/matches/:id/commands` está implementado. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.7 | `/matches/:id/rematch` está implementado. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.8 | Criação de partida é atômica. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.9 | Não existem partidas duplicadas por sala. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.10 | Estado JSONB é compatível com Node.js. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.11 | Regras do motor permanecem idênticas. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.12 | Revisões são corretamente aplicadas. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.13 | Fingerprints são compatíveis com Node.js. | Atendido | Relatório 06, API de partida, transações e comparação HTTP/JSONB |
| 03.4.14 | Replay idempotente funciona após avanço de revisão. | Atendido | Relatório 06, corridas, replays, rollback e perda de confirmação no PostgreSQL |
| 03.4.15 | Reenvio não duplica efeitos. | Atendido | Relatório 06, corridas, replays, rollback e perda de confirmação no PostgreSQL |
| 03.4.16 | Colisão de `commandId` é rejeitada. | Atendido | Relatório 06, corridas, replays, rollback e perda de confirmação no PostgreSQL |
| 03.4.17 | Locks seguem sala → partida. | Atendido | Relatório 06, corridas, replays, rollback e perda de confirmação no PostgreSQL |
| 03.4.18 | Corridas reais foram verificadas no PostgreSQL. | Atendido | Relatório 06, corridas, replays, rollback e perda de confirmação no PostgreSQL |
| 03.4.19 | Rollback é integral. | Atendido | Relatório 06, corridas, replays, rollback e perda de confirmação no PostgreSQL |
| 03.4.20 | Commit ambíguo pode ser recuperado. | Atendido | Relatório 06, corridas, replays, rollback e perda de confirmação no PostgreSQL |
| 03.4.21 | Leitura utiliza projeções privadas autorizadas. | Atendido | Relatórios 06 e 07, projeções por jogador e recusa de terceiros |
| 03.4.22 | Votos alheios não são revelados. | Atendido | Relatórios 06 e 07, projeções por jogador e recusa de terceiros |
| 03.4.23 | Broker permanece privado. | Atendido | Relatórios 06 e 07, projeções por jogador e recusa de terceiros |
| 03.4.24 | Revanche funciona sem duplicação. | Atendido | Relatórios 06 e 07, revanche, sete checkpoints de reinício e invalidações |
| 03.4.25 | Recuperação após reinício funciona. | Atendido | Relatórios 06 e 07, revanche, sete checkpoints de reinício e invalidações |
| 03.4.26 | Invalidações do banco permanecem corretas. | Atendido | Relatórios 06 e 07, revanche, sete checkpoints de reinício e invalidações |
| 03.4.27 | Testes de integração Java passaram. | Atendido | Relatórios 06 e 07, testes de integração, paridade e regressão web |
| 03.4.28 | Testes de paridade foram executados. | Atendido | Relatórios 06 e 07, testes de integração, paridade e regressão web |
| 03.4.29 | Regressões Node/React foram avaliadas. | Atendido | Relatórios 06 e 07, testes de integração, paridade e regressão web |
| 03.4.30 | Nenhuma migration remota foi aplicada. | Atendido | Escopo histórico da Sprint 03.4 no relatório 06 |
| 03.4.31 | Nenhuma configuração de produção foi modificada. | Atendido | Escopo histórico da Sprint 03.4 no relatório 06 |
| 03.4.32 | Documentação atualizada. | Atendido | Relatório 06 |

### Sprint 03.5

| Gate | Requisito original | Estado | Evidência e limite |
| --- | --- | --- | --- |
| A | Infraestrutura Java preparada e isolada | Atendido | Render e Vercel existentes e schema isolado sob a arquitetura compartilhada aprovada na 03.5C. A proposta inicial previa projeto Supabase exclusivo. |
| B | Build de homologação consulta a API Java | Atendido | Preview READY no commit fa1c090 e perfil autenticado HTTP 200 no Render, conforme relatório de Auth. |
| C | Login real, sessão, refresh e autorização aprovados | Parcial | Login Google e senha, OTP, primeira senha, recuperação, F5, logout e UUID no Preview. Refresh confirmado no Supabase local. Falta evidência de refresh hospedado. |
| D | Perfis, amizades e convites em sessões distintas | Parcial | Perfis gerenciados com duas contas. Amizades e convites verificados no ensaio local com três identidades. |
| E | Sala, entrada, prontidão, início e saída aprovados | Atendido | Criação, entrada por código, prontidão e início no Preview com duas sessões. Saída e transferência avaliadas anteriormente com PostgreSQL e nos ensaios locais. |
| F | Partida real integral pelo frontend contra Java | Atendido | Partida hospedada completa com dois jogadores reais, do lobby ao resultado final. O ensaio local anterior usou três identidades. |
| G | Realtime privado gerenciado e recuperação de snapshots | Parcial | Presença em tempo real exibida nos dois clientes e transições sincronizadas. A execução não separou broadcast de polling nem repetiu recusa de inscrições hospedadas. |
| H | Recuperação após interrupção e reinício | Parcial | Reconexão do browser e sete checkpoints de reinício aprovados localmente. Reinício no Render não foi ensaiado nesta revisão. |
| I | Privacidade e autorização | Parcial | Backend exige identidade verificada. Projeção e recusa de terceiros verificadas localmente. Auditoria hospedada de intruso e payloads ainda pendente. |
| J | Regressão Java, Node, React e Playwright avaliada | Atendido | Relatório 07 com 49 aprovados e um omitido dependente de contas reais. Relatório de Auth preserva timeout da suíte Java e nova execução direcionada de 29 testes sem falha. |
| K | Documentação e plano de cutover/rollback | Parcial | Documentação histórica disponível. A decisão de encerramento substitui o objetivo de release candidate pelo deploy de demonstração acadêmica. |

Medição de p50/p95 e carga hospedada, comparação Node–Java hospedada e ensaio com três contas reais continuam sem validação. O refresh hospedado é uma limitação registrada fora do gate acadêmico definido para este encerramento.

## Roteiro de demonstração

1. Abrir o Preview em dois contextos de navegador independentes com contas controladas e confirmar a origem do retorno Google e o perfil autenticado.
2. Criar sala privada, entrar por código, sinalizar prontidão e iniciar a partida. Mostrar os versos das cartas adversárias.
3. Executar Patrocínio com bloqueio e contestação, demonstrar escolha de influência e continuar até Backstab, eliminação e vitória. Confirmar o mesmo desfecho nos dois clientes.
4. Apresentar os testes locais para corrida, reenvio idempotente, rollback, reinício, projeções privadas e autorização. Mostrar apenas status, rota sanitizada e imagens sem credenciais, tokens ou emails.

## Evidência desta revisão

- Checkout Java em `fa1c09008ac73c22f035bdf996a0e9a7edbc115a`. O Preview estável aponta para um build READY do mesmo SHA. O endpoint de readiness do Render retornou `{"status":"UP"}` durante o ensaio.
- Duas contas autorizadas, em contextos independentes no Chrome e no navegador interno, participaram da mesma sala de staging. Criação, entrada por código, presença dos dois jogadores, prontidão e abertura da arena foram observadas.
- O anfitrião declarou Patrocínio. O convidado bloqueou com Magnata. A contestação do bloqueio confirmou a carta e atribuiu a perda ao contestador. Após a ciência coletiva, apenas a vítima recebeu os botões com nomes das suas cartas. O outro cliente viu a indicação de espera.
- Taxar e Renda avançaram a rodada. Com oito créditos, o convidado executou Backstab de sete créditos. O anfitrião perdeu a última influência e foi eliminado. A ciência final ficou disponível apenas para o sobrevivente. Os dois clientes exibiram o mesmo vencedor. O vencedor manteve duas influências e um crédito.
- No navegador interno, os cliques de automação em uma ciência não dispararam o comando observado. A ativação com Enter enviou o comando ao Render com HTTP 200 e completou a transição. Não foi possível atribuir a diferença ao produto ou à automação. O fluxo seguiu pelo teclado.
- [Vitória no segundo cliente](evidencias/java-vitoria.jpg) · [Derrota no anfitrião](evidencias/java-derrota.jpg)
