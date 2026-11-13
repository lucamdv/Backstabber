# Inventário do backend Node.js · Sprint 03.1

Referência: `main` no commit `f5c38d2bd0a898f3df8ef3a7f784b33d40f537d1`. Este inventário descreve o comportamento observado no código e nos testes. O contrato de referência é a seção [Sprint 02 — contrato implementado](../av2/backend-contract.md#sprint-02--contrato-implementado), complementada pelo tratamento de falhas da Sprint 02.1. As rotas e envelopes da proposta da Sprint 01 são históricos.

## Entrada HTTP, identidade e erros comuns

- A base pública é `/api/v1`. Na Vercel, a regra de rewrite encaminha `/api/v1/:path*` a `/api/index?__route=:path*`, entrada interna aceita pelo handler. O adaptador da Vercel usa import dinâmico para ligar o entry point CommonJS ao código ESM. O servidor local serve o mesmo handler.
- `OPTIONS` é tratado antes da resolução de rota ou autenticação. Retorna **204**, sem corpo, com `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS` e `Access-Control-Allow-Headers: Authorization, Content-Type`. Todas as respostas têm `Cache-Control: no-store` e `Vary: Origin`. O cabeçalho `Access-Control-Allow-Origin` só aparece para origem presente na lista exata configurada em `BACKSTABBER_ALLOWED_ORIGIN`.
- Todas as rotas de negócio exigem `Authorization: Bearer <access_token>`, com capitalização e espaço conforme `/^Bearer ([\w.-]+)$/`. O backend chama `GET /auth/v1/user` do Supabase com `apikey` e `Authorization`, com sinal de cancelamento em 6 s. Aceita HTTPS e HTTP apenas em `localhost`, `127.0.0.1` e `[::1]`. A identidade vem do `id` com formato UUID devolvido pelo Auth. Metadados, parâmetros e corpo não substituem essa identidade. `is_anonymous === true` invalida a sessão.
- O corpo de POST, PUT, PATCH e DELETE é lido como texto. Ausência equivale a `{}`. Corpo acima de 16.384 unidades UTF-16 resulta em **413** `PAYLOAD_TOO_LARGE`; JSON nulo, array, primitivo ou inválido resulta em **400** `INVALID_JSON`. Campos desconhecidos normalmente são ignorados. Um `playerId` dentro de `command` é explicitamente recusado.
- O envelope de erro é sempre `{"error":"CODIGO"}`. Ausência ou formato inválido do Bearer, Auth respondendo 401/403, UUID inválido e usuário anônimo resultam em **401** `UNAUTHENTICATED`. Falta de configuração Auth, protocolo remoto inválido, timeout/falha de rede e outros status de erro upstream resultam em **503** `SERVICE_UNAVAILABLE`. JSON válido com formato incorreto vindo do Auth retorna 401. JSON malformado em sucesso upstream lança fora do bloco de tratamento de rede e cai em **500** `INTERNAL_ERROR` no Node de referência.
- Falha ao adquirir conexão do banco resulta em **503** `SERVICE_UNAVAILABLE`. O mesmo código vale para SQLSTATE `55P03`, `40P01`, `57014`, `40001`, `53300`, `57P01`, classe `08xxx` ou falha de rollback, salvo `ApiError` explícito. Outros erros inesperados resultam em **500** `INTERNAL_ERROR`. Caminhos não roteados retornam **404** `NOT_FOUND`. Método incompatível em rota de partida com ID válido retorna **405** `METHOD_NOT_ALLOWED`; rotas sociais sem correspondência exata de método e caminho caem em 404.

## Rotas, corpos, respostas e autorização

Todos os caminhos de negócio abaixo são relativos a `/api/v1`, retornam **200** em sucesso e herdam os erros comuns acima. `—` indica ausência de campos exigidos no corpo. UUID malformado em rotas sociais retorna **400** `INVALID_ID`; em partidas retorna **404** `NOT_FOUND`. Campos booleanos obrigatórios recusam coerção e retornam **400** `INVALID_BOOLEAN`.

| Método e caminho | Entrada | Resposta JSON | Autorização e erros específicos |
| --- | --- | --- | --- |
| `GET /profile` | — | `Profile` ou literal `null` | Só perfil do UUID autenticado. Ausência de perfil não é erro. |
| `PUT /profile` | `{username,displayName,avatarUrl?,showOnline?}` | `Profile` | Cria/edita o próprio perfil. **400** `INVALID_PROFILE`, `INVALID_AVATAR`, `INVALID_BOOLEAN`; **409** `USERNAME_TAKEN`. |
| `POST /profile/heartbeat` | — | `{ok:true}` | Atualiza apenas o próprio registro, no máximo uma vez a cada 10 s. Também retorna sucesso sem perfil cadastrado. |
| `GET /users?username=...` | Prefixo via query | `Profile[]` | Sessão válida. Exclui a própria conta, ordena por username, limita a 20. Prefixo inválido ou ausente retorna `[]`. |
| `GET /friends` | — | `{friends:[Profile & {online}],requests:[{id,from:Profile,to:Profile,status:"pending"}]}` | Só amizades próprias e solicitações pendentes em que a sessão participa. `online` é booleano ou `null`. |
| `POST /friends/requests` | `{userId}` | `{id}` | Os dois perfis precisam existir. **400** `INVALID_FRIEND_TARGET` ao pedir a si próprio; **404** `PROFILE_NOT_FOUND`; **409** `ALREADY_FRIENDS`, `FRIEND_REQUEST_EXISTS`. |
| `POST /friends/requests/:id/respond` | `{accept:boolean}` | `{status:"accepted"\|"declined"}` | Só destinatário da solicitação pendente. **404** `FRIEND_REQUEST_NOT_FOUND` ou `PROFILE_NOT_FOUND`. |
| `DELETE /friends/:userId` | — | `{ok:true}` | Remove somente a relação entre o UUID autenticado e o indicado. Repetição e par inexistente também retornam sucesso. |
| `GET /invites` | — | `[{id,roomId,from:Profile,status:"pending",expiresAt}]` | Só convites destinados à sessão, ainda válidos e de lobby aberto. |
| `POST /invites/:id/respond` | `{accept:boolean}` | `Room` se aceito, `{status:"declined"}` se recusado | Só destinatário de convite pendente e não expirado. **404** `INVITE_NOT_FOUND` ou `ROOM_NOT_FOUND`; aceitar também pode retornar **409** `ROOM_NOT_OPEN`, `ROOM_FULL` ou `PROFILE_REQUIRED`. |
| `GET /rooms` | — | `Room[]` | Salas da sessão, exceto efetivamente encerradas. |
| `POST /rooms` | `{capacity:integer}` | `Room` | Exige perfil. Capacidade 2–10. **400** `INVALID_CAPACITY`; **409** `PROFILE_REQUIRED`; **503** `ROOM_CODE_UNAVAILABLE` após três colisões. |
| `POST /rooms/join` | `{code:string}` | `Room` | Código normalizado com trim e caixa alta, exatamente dez dígitos hexadecimais. **400** `INVALID_ROOM_CODE`; **404** `ROOM_NOT_FOUND`; **409** `ROOM_NOT_OPEN`, `ROOM_FULL`, `PROFILE_REQUIRED`. |
| `GET /rooms/:id` | — | `Room` | Só membro atual. **404** `ROOM_NOT_FOUND` para sala ausente ou invisível. |
| `POST /rooms/:id/heartbeat` | — | `Room` | Só membro. Atualiza o próprio heartbeat em lobby ou partida, sem modificar sala encerrada. |
| `POST /rooms/:id/ready` | `{ready:boolean}` | `Room` | Só membro altera a própria prontidão e apenas em lobby. **409** `ROOM_NOT_OPEN`. |
| `POST /rooms/:id/invite` | `{userId}` | `{id}` | Qualquer membro em lobby pode convidar amigo. **403** `FRIEND_REQUIRED`; **409** `ROOM_NOT_OPEN`, `ALREADY_IN_ROOM`, `ROOM_FULL`, `INVITE_EXISTS`. |
| `POST /rooms/:id/leave` | — | `{ok:true}` | Só membro e só em lobby. **409** `ROOM_NOT_OPEN`. |
| `POST /rooms/:id/start` | — | `Room` com `matchId` | Só host. **403** `HOST_REQUIRED`; **409** `ROOM_NOT_OPEN` ou `ROOM_NOT_READY`. Repetição em sala iniciada devolve o mesmo `matchId`. |
| `POST /rooms/:id/close` | — | `Room` com `status:"closed"` | Só host, ou membro de partida iniciada após ausência prolongada do host. **403** `HOST_REQUIRED`. |
| `GET /matches/:id` | — | `OnlineView` | Só membro da sala vinculada. **404** `NOT_FOUND` também para não membros. |
| `POST /matches/:id/commands` | `OnlineEnvelope` | `{ok:true,revision}` | Membro, identidade e fase autorizadas. **400** `UNSUPPORTED_PROTOCOL` e `INVALID_COMMAND` de forma/colisão de ID; **403** `NOT_AUTHORIZED`; **404** `NOT_FOUND`; **409** `INVALID_PHASE`, `STALE_REVISION`, `ALREADY_RESPONDED` ou `INVALID_COMMAND` do domínio. |
| `POST /matches/:id/rematch` | — | `OnlineView` da nova rodada | Host após `finished`, sem janela aberta, em sala iniciada. **403** `NOT_AUTHORIZED`; **404** `NOT_FOUND`; **409** `INVALID_PHASE`. |

As mutações `/rooms/:id/*` também retornam **404** `ROOM_NOT_FOUND` para não membros. Em `PUT /profile`, o username é normalizado e validado por `^[a-z0-9_]{3,18}$`; `displayName` usa trim e comprimento 1–40; o avatar é nulo/vazio ou URL HTTPS de até 2.048 caracteres com host e sem usuário/senha. Omissão de `avatarUrl` limpa o avatar, e omissão de `showOnline` preserva o valor existente ou inicia como falso. Em `GET /users`, o prefixo normalizado aceita 1–18 caracteres no mesmo alfabeto e trata `_` literalmente. A disponibilidade da lista de amigos exige consentimento e heartbeat recente, de até 45 s; o snapshot de sala informa conexão de membros com janela de 35 s.

`Profile = {id,username,displayName,avatarUrl:string|null,showOnline:boolean}`. `Room = {id,code,hostId:string|null,capacity,status:"lobby"|"started"|"closed",matchId:string|null,canStart,members:(Profile & {ready,connected})[]}`. `expiresAt` é serializado como data ISO. Nenhuma dessas respostas inclui e-mail ou timestamp bruto de heartbeat.

### Contrato da primeira rota Java

`GET /api/v1/profile` consulta `public.bs_profiles` por `p.user_id = $1`, passando o UUID autenticado. A projeção é `user_id → id`, `username`, `display_name → displayName`, `avatar_url → avatarUrl` e `show_online → showOnline`. Retorna 200 tanto para o objeto quanto para o JSON literal `null`. `?userId=...` não altera o perfil consultado e `GET /profile/:id` não é rota válida. O perfil não é criado por essa leitura.

## Responsabilidades atuais e destino Java

| Referência Node.js | Responsabilidade | Destino Java planejado |
| --- | --- | --- |
| [http.ts](../../web/server/http.ts) | HTTP, CORS, autenticação remota, identidade, transações, erros, TLS e pool. | `api` controllers/advice, `security` filtro/autenticador, `config` CORS e `persistence` DataSource/gestão transacional. |
| [social.ts](../../web/server/social.ts) | Perfil, pesquisa, amizade, convites, salas, prontidão e ciclo de vida. | `social` serviços e repositórios de perfil/amizade/convite. `lobby` serviços e repositórios de sala/membro. Somente leitura de perfil em 03.1. |
| [match-store.ts](../../web/server/match-store.ts) | Validação de formato de comando, acesso à partida, bloqueios, gravação JSONB, replay e revanche. | `api` DTOs de comandos, `game` serviços de partida/revanche e `persistence` repositório com SQL e projeção após autorização. |
| [online-engine.ts](../../web/server/online-engine.ts) | Agregado online, janelas coletivas, sequência de votos, auditoria, projeção por sessão. | `game` máquina de estados e projetor independente de HTTP/JDBC. |
| [engine.ts](../../web/src/game/core/engine.ts) e `core/setup.ts` | Regras puras, disponibilidade, validação, transições, baralho e sorteio injetável. | Domínio `game`, portado com testes determinísticos, sem alterar as fontes atuais. |
| [room-policy.ts](../../web/server/room-policy.ts) | Limiar de 300 s para abandono do host, compartilhado entre sala e partida. | Política compartilhada entre `lobby` e `game`. |
| [errors.ts](../../web/server/errors.ts) | Código de erro e status, padrão 400. | `shared` tipo de erro e `api` mapeamento JSON. |
| [vercel.ts](../../web/server/vercel.ts) e [api/index.ts](../../api/index.ts) | Entry point hospedado e integração de ciclo de vida `attachDatabasePool`. | O processo Spring e seu pool têm ciclo de vida próprio. O adapter Vercel atual permanece ativo. |
| [contracts.ts](../../web/src/game/application/contracts.ts) e [online-contracts.ts](../../web/src/game/application/online-contracts.ts) | Contratos locais/públicos/privados e extensão online de comandos e snapshots. | DTOs Jackson e records/tipos discriminados, preservando nomes, discriminadores, campos nulos e opcionais. |

## Banco, relações e transações

O [SQL versionado](../../supabase/migrations/20261112000101_backstabber_multiplayer.sql) define oito tabelas no esquema `public`.

| Tabela | Identidade, relacionamentos e integridade |
| --- | --- |
| `bs_profiles` | PK `user_id` referencia `auth.users.id` com cascade; username único e indexado por prefixo, nome, avatar, consentimento e heartbeat. |
| `bs_friend_requests` | UUID, remetente/destinatário com FK para perfis, status `pending/accepted/declined`, data. Sem autopedido, índice parcial único por par não ordenado enquanto pendente. |
| `bs_friends` | PK `(user_a,user_b)`, ambos perfis, ordenação obrigatória `user_a < user_b`. Um registro por amizade bilateral. |
| `bs_rooms` | UUID, código único, capacidade, status, criação e expiração. FK do host para perfil com `ON DELETE SET NULL`. |
| `bs_room_members` | PK `(room_id,user_id)`, FKs sala/perfil com cascade, prontidão, entrada e heartbeat. Índice adicional por conta. |
| `bs_invites` | UUID, sala, remetente e destinatário, status, criação e expiração. FKs com cascade. Índice parcial único por sala e destinatário pendente. |
| `bs_matches` | UUID, FK única de sala com cascade, criação e estado JSONB objeto. `state = {game,round,window,audit}`. |
| `bs_match_commands` | PK `(match_id,user_id,command_id)`, FKs de partida/perfil com cascade, fingerprint textual, resposta JSONB e criação. |

O handler inicia transação após autenticação e parsing, inclusive para leituras. Usa `SET LOCAL lock_timeout = '3s'`, `statement_timeout = '8s'` e `idle_in_transaction_session_timeout = '10s'`. Confirma antes de devolver sucesso. Em erro faz rollback e libera o cliente, descartando a conexão se o rollback falhar ou SQLSTATE indicar falha de conexão. O pool Node tem até três conexões por instância, com conexão e ociosidade limitadas a 5 s. O modo remoto exige CA PEM, remove parâmetros SSL conflitantes da URL e aplica `rejectUnauthorized: true` para verificar cadeia e hostname. Loopback aceita URL local sem a exigência de CA.

- Sala por código/ID é bloqueada com `FOR UPDATE` antes de validar lotação, prontidão ou efetivar composição. As mutações por ID verificam associação antes e depois do lock. Resposta de convite trava a sala antes de alterar o convite.
- Comando e revanche travam **sala → partida**, com associação exigida nas consultas. A leitura de partida não usa lock de escrita. As alterações de estado e o registro do resultado aceito ficam na mesma transação. Operações de pedido de amizade bloqueiam os dois perfis em ordem por UUID com `FOR NO KEY UPDATE`, e a aceitação volta a verificar `pending` na atualização.
- RLS está ativa nas oito tabelas. A migração revoga grants de `public`, `anon` e `authenticated`; a única leitura direta da aplicação concedida é `(room_id,user_id)` da própria associação, usada no Realtime. Estado JSONB, cartas e fingerprint permanecem restritos ao backend.

## Ciclo de vida e idempotência

O lobby vale 24 h e é tratado como fechado ao expirar ou ficar sem host. Criação registra o host como membro. Composição é ordenada por entrada e UUID. Alteração real de composição limpa prontidão coletiva; nova entrada da mesma conta num lobby aberto preserva vaga e prontidão. Saída do host transfere a função ao membro mais antigo, ou fecha a sala vazia. Um convite vale 15 min e expiração ou resposta anterior impede novo consumo. O início, fechamento e saída do remetente expiram convites pendentes conforme o caso.

Início exige host, lobby aberto, pelo menos dois membros, todos prontos e conectados pelo heartbeat. A partida é criada no mesmo commit do status `started`, com a lista ordenada de membros e usernames, usados como nomes no domínio. Novo pedido de início do host em sala iniciada só lê o snapshot existente. Fechamento conserva o histórico e bloqueia novas transições. Host pode fechar diretamente, ou membro pode fechar uma sala iniciada depois de 300 s de ausência do host. Desconexão nunca confirma voto ou avança uma janela.

No protocolo de partida, o servidor valida `protocolVersion:1`, `commandId` não vazio de até 80 caracteres, `expectedRevision` inteiro seguro não negativo e o comando. A chave de replay é `(match_id,user_id,command_id)`. O fingerprint é `JSON.stringify` do envelope **normalizado** pelo parser, com ordem de campos fixa e campos não reconhecidos descartados. Pedido aceito repetido retorna o resultado gravado mesmo após avanço da revisão ou fechamento da sala, desde que a associação continue autorizada. Mesmo ID com conteúdo normalizado diferente retorna 400, inclusive se a única mudança for a revisão. Comandos rejeitados não ocupam o ID. Timeout de commit pode ser investigado com leitura do snapshot e repetição do mesmo envelope.

Revanche é transacional, não tem envelope de replay e concorre sob o mesmo lock. Só a primeira solicitação a partir da vitória confirmada cria outra rodada. Preserva o ID, elenco e auditoria, incrementa rodada e revisão e embaralha novo baralho. O restante observa fase inválida. A recuperação usa leitura do snapshot autorizado, mantendo revisão e votos pendentes.

## Jogo, janelas e projeção

`OnlineEnvelope.command` aceita `{type:"select-action",action,targetId?}`, `{type:"vote",windowId,choice}`, `{type:"lose",cardId}` e `{type:"negotiate",keepIds}`. `choice` é `{kind:"accept"|"challenge"|"acknowledge"}` ou `{kind:"block",character}`. Alvo vem no mesmo comando para Extorquir, Executar e Backstab, sem publicar a fase intermediária `target`. Ações sem alvo recusam `targetId`. O autor deriva da sessão. A revisão aumenta uma vez por comando online aceito, mesmo se a resolução aplicar duas transições internas.

Os valores de `action` são `income`, `patrocinio`, `tax`, `steal`, `assassinate`, `backstab` e `negotiate`. Os valores de personagem são `magnata`, `executor`, `sentinela`, `mercenario` e `broker`. O parser trata IDs de carta, janela e alvo como strings de 1–80 caracteres. Em seguida, as regras verificam se os IDs identificam opções válidas na fase.

- Domínio inicial: dois créditos e duas influências por jogador. Baralho com 15, 20 ou 25 cartas para 2–6, 7–8 ou 9–10 jogadores. Fisher–Yates com aleatoriedade injetável. O servidor usa fonte criptográfica para sorteio; nos testes a fonte é determinística.
- Renda dá 1 crédito. Patrocínio dá 2 e qualquer adversário vivo pode bloqueá-lo com Magnata. Taxa declara Magnata e dá 3. Extorquir declara Mercenário, tira até 2 créditos e só o alvo pode bloquear com Mercenário ou Broker. Executor custa 3 na declaração, mesmo se bloqueado/contestado; só o alvo pode bloquear com Sentinela. Broker compra duas e mantém o número original de influências usando IDs únicos da oferta/mão. Backstab custa 7, impõe perda sem bloqueio e é obrigatório com 10 ou mais créditos quando há alvo vivo.
- Contestação de declaração verdadeira substitui a prova comprando antes de devolvê-la e pune o contestador. Uma declaração falsa pune o declarante. Ação verdadeira ou bloqueio falso podem deixar a ação pendente para depois da perda; bloqueio verdadeiro cancela a ação. Cartas perdidas voltam ao baralho, e o cemitério registra a influência publicamente. Alvos eliminados são ignorados em ações pendentes. A vitória tem prioridade quando resta um sobrevivente, e os turnos ignoram eliminados.
- Janela `reaction` recebe vivos salvo autor. A de `block-reaction` recebe vivos salvo bloqueador. `acknowledge` recebe todos os vivos. Cada elegível vota uma vez. A ordem persistida é a de aceitação pelo servidor sob o lock, numerada a partir de 1. A resolução aguarda todos; prioriza a primeira contestação, depois o primeiro bloqueio, e caso contrário aceita. Janelas encerradas são guardadas em `audit`, incluindo a prioridade. Janelas têm ID `<round>:<audit.length+1>`.
- Renda e Backstab usam ciência coletiva. Backstab e contestação exigem ciência antes da perda. Executor aceito sem contestação abre perda diretamente. Broker aceito abre negociação privada. Após perda, negociação ou retorno à ação, a ciência do resultado pode adiar a troca efetiva de `activeId`; vitória só é oferecida para revanche após a última janela. Se uma perda desembocar em negociação, a oferta existe no estado mas fica protegida até a janela fechar.

`OnlineView` publica `revision`, `round`, `activeId`, `viewerId`, `closed`, `canClose`, `canRematch`, `phase`, `history`, `cemetery`, `deckCount`, `lastEvent?` e jogadores `{id,name,credits,influence}`. A janela opcional publica `{id,kind,eligible,responded,options,summary}`, com opções calculadas para o observador. Votos detalhados, ordem do baralho, auditoria e cartas de terceiros ficam no estado interno. `hand` pertence sempre à sessão, com `revealed:true` e `privatePlayerId` do observador. `choices` só aparece preenchido sem janela e em partida aberta para a própria perda ou a própria mão mais oferta Broker. `availableActions` e `targets` dependem de turno, ausência de janela e sala aberta. `blocks` e `challenges` legados ficam vazios no online. Na fase `finished`, só o vencedor recebe `phase.cards`; demais recebem `[]`.

## Supabase Auth e Realtime

O Supabase Auth continua responsável pela sessão (incluindo login Google do frontend). A API não armazena senha nem valida somente a estrutura do token. Comportamento de login, retorno e chaves locais está descrito no [guia Supabase](../av2/supabase-setup.md).

Os gatilhos SQL em `bs_private` emitem somente `invalidate` privado com `{kind:"room"}` ou `{kind:"social"}` pelo `realtime.send`. Sala, membros e partida invalidam `room:<uuid>`; amizade, solicitação e convite invalidam `user:<uuid>` das contas envolvidas. Heartbeat rotineiro dentro da janela é filtrado. O canal pessoal permite receber Broadcast apenas à conta correspondente; canais de sala permitem Broadcast recebido e Presence lida/escrita apenas aos membros. O navegador não publica Broadcast. Políticas usam o tópico efetivo e `auth.uid()`. Invalidações acompanham a transação, não carregam dados privados e fazem o cliente consultar HTTP, com polling e reconexão como recuperação. O backend revalida associação mesmo que a autorização do canal esteja em cache.

## Cenários automatizados de referência

| Suíte | Cenários cobertos no baseline |
| --- | --- |
| [http.test.ts](../../web/server/http.test.ts) · 3 | Três sessões, token inválido, não membro, personificação recusada, projeção privada, replay e reconexão; perda exclusiva, vitória e revanche; contestações concorrentes com prioridade e auditoria. Usa PGlite e Auth de teste, com uma única conexão serializada. |
| [http-resilience.test.ts](../../web/server/http-resilience.test.ts) · 6 | Quatro SQLSTATE transitórios respondem 503 e revertem; conexão descartada se rollback falhar; Auth distingue indisponibilidade de token inválido. |
| [social.test.ts](../../web/server/social.test.ts) · 5 | Perfil e busca sem atividade, username único, amizade e convite por destinatário, capacidade/prontidão/host, membro e Realtime por RLS, acesso direto à partida negado, saída limpa prontidão e fechamento por ausência. Migração sobre PGlite. |
| [online-engine.test.ts](../../web/server/online-engine.test.ts) · 6 | Espera por todos, votos ocultos e primeira contestação, prioridade sobre bloqueio, votação do bloqueio, oferta privada do Broker, ciência de Renda, Backstab/perda/vitória sem exigir eliminados. |
| [native-postgres.test.ts](../../web/server/native-postgres.test.ts) · 8 | Duas conexões nativas confirmadas por PID e espera no lock. Última vaga/início simultâneos, replay/colisão, duas corridas de votos com revisão e reconexão, revanche simultânea, RLS, timeout e deadlock com 503/rollback/retry. Exige URL opt-in para PostgreSQL descartável; Auth/Realtime gerenciados usam fixtures. |
| [database-tls.test.ts](../../web/server/database-tls.test.ts) · 3 | CA obrigatória no remoto, verificação preservada mesmo com `sslmode` na URI, PostgreSQL local sem CA remota. Testa configuração do cliente, sem handshake remoto. |

As suítes de [motor local](../../web/src/tests/engine.test.ts) e [caracterização do legado](../../web/src/tests/legacy.test.ts) complementam as regras de base. O relatório de [homologação](../av2/sprint-02-homologation.md) distingue testes nativos, testes de serviços gerenciados e cenários de navegador. O [handoff](../av2/sprint-03-handoff.md), o [esquema](../av2/database-schema.md), a [arquitetura](../av2/sprint-02-architecture.md) e o [fluxo multiplayer](../av2/multiplayer-interaction-flow.md) são referências para as próximas sprints. O primeiro teste de conformidade Java deve comparar perfil existente, perfil ausente, autenticação, isolamento do UUID da sessão, indisponibilidade de Auth e indisponibilidade do banco.
