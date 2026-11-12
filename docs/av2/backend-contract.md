# Contrato inicial dos backends

## Sprint 02 — contrato implementado

Esta seção substitui a proposta da Sprint 01 abaixo para o modo online. A base padrão é `/api/v1` e pode ser substituída por `VITE_API_URL`. As rotas exigem `Authorization: Bearer <access_token>`. A identidade vem de `GET /auth/v1/user` do Supabase. O corpo do comando jamais contém `playerId`.

| Método e rota | Corpo e resultado |
| --- | --- |
| `GET /profile` / `PUT /profile` | Perfil próprio ou `null`. Escrita com `username`, `displayName`, `avatarUrl`, `showOnline`. |
| `POST /profile/heartbeat` | Atualiza disponibilidade individual. |
| `GET /users?username=` | Lista por prefixo de nome de usuário, sem e-mail nem atividade. |
| `GET /friends` | `{friends,requests}`. Disponibilidade depende do consentimento do amigo. |
| `POST /friends/requests` | `{userId}`. |
| `POST /friends/requests/:id/respond` | `{accept:boolean}`. Somente destinatário. |
| `DELETE /friends/:userId` | Remove a amizade bilateral. |
| `GET /invites` / `POST /invites/:id/respond` | Lista convites válidos e responde com `{accept:boolean}`. |
| `GET /rooms` / `GET /rooms/:id` | Salas da sessão e snapshot do lobby. |
| `POST /rooms` / `POST /rooms/join` | `{capacity}` ou `{code}`. Retorna a sala. |
| `POST /rooms/:id/invite` | `{userId}` de um amigo. |
| `POST /rooms/:id/ready` | `{ready:boolean}`. Retorna o lobby atualizado. |
| `POST /rooms/:id/heartbeat`, `leave`, `start`, `close` | Heartbeat, saída do lobby, início pelo host ou encerramento controlado. |
| `GET /matches/:id` | Snapshot `OnlineView` filtrado pela sessão. |
| `POST /matches/:id/commands` | `OnlineEnvelope`. Retorna `{ok:true,revision}`. |
| `POST /matches/:id/rematch` | Anfitrião após vitória confirmada. Mesmo ID de partida, rodada e revisão incrementadas. |

O envelope tem `protocolVersion:1`, `commandId`, `expectedRevision` e `command`. Comandos: `select-action` com `action` e `targetId` quando necessário, `vote` com `windowId` e `choice`, `lose` com `cardId`, `negotiate` com `keepIds`. Escolhas: `{kind:"accept"}`, `{kind:"challenge"}`, `{kind:"acknowledge"}` ou `{kind:"block",character}`. Tipos completos em `web/src/game/application/online-contracts.ts`.

O estado versionado retorna mão própria em qualquer fase. A janela informa ID, tipo, participantes elegíveis, quem respondeu, resumo e opções da sessão. Os votos dos demais são privados. Quando fechada, a auditoria registra sequência e prioridade no banco. Realtime emite apenas `invalidate` para `room:<id>` ou `user:<id>`; reconexões recuperam o estado pela rota HTTP.

Erros são JSON `{error:CODE}`. Códigos do jogo: `UNSUPPORTED_PROTOCOL` e `INVALID_COMMAND` para envelope inválido ou colisão de ID (400), `UNAUTHENTICATED` (401), `NOT_AUTHORIZED` (403), `NOT_FOUND` inclusive fora da sala (404), `STALE_REVISION`, `ALREADY_RESPONDED` ou `INVALID_PHASE` (409). Transições recusadas pelo domínio retornam 409 salvo autorização. Erros sociais incluem `ROOM_NOT_READY`, `HOST_REQUIRED`, `ROOM_FULL`, `USERNAME_TAKEN` e `INVITE_NOT_FOUND`.

Comandos aceitos são idempotentes por partida, usuário e ID. Uma revisão obsoleta não altera o jogo. O cliente pode reenviar um voto na revisão nova se a mesma janela ainda estiver aberta e a própria resposta continuar pendente.

## Proposta histórica da Sprint 01

A Sprint 01 fornece a interface `GameAdapter`, o contrato TypeScript em `web/src/game/application/contracts.ts` e o adaptador local. As rotas e regras abaixo especificam a primeira versão do protocolo HTTP. A implementação Node.js e a Spring Boot devem aceitar o mesmo JSON e produzir o mesmo comportamento.

## Salas e sessão

| Recurso proposto | Entrada e resultado |
| --- | --- |
| `POST /v1/rooms` | Recebe `{name}`. Retorna `{protocolVersion:1,roomId,joinCode,playerId,resumeToken}`. |
| `POST /v1/rooms/join` | Recebe `{joinCode,name}`. Retorna os identificadores e credencial do participante. |
| `POST /v1/rooms/{roomId}/start` | O anfitrião autenticado inicia com o elenco da sala. Retorna `{protocolVersion:1,matchId}`. |
| `GET /v1/matches/{matchId}/snapshot` | Retorna a visão autorizada atual em um evento de snapshot. |
| `POST /v1/matches/{matchId}/commands` | Recebe um envelope de comando e retorna confirmação ou erro. |
| `GET /v1/matches/{matchId}/events` | Entrega snapshots ordenados por revisão. O transporte inicial pode usar polling com `afterRevision`. |

`roomId`, `matchId` e `playerId` são strings opacas. O código curto permite entrar na sala e a credencial opaca autentica o jogador. O servidor deve derivar sua identidade pela sessão e verificar se coincide com `command.playerId`. IDs e códigos de sala por si só não autenticam. Use HTTPS e envie a credencial no cabeçalho Authorization, longe de URLs e logs.

## Envelope, comandos e resultados

```json
{
  "protocolVersion": 1,
  "matchId": "m_example",
  "commandId": "client-generated-unique-id",
  "expectedRevision": 12,
  "command": {"type":"select-action","playerId":"p1","action":"tax"}
}
```

Todos os campos acima são obrigatórios. Cada tipo de comando possui `playerId` e os campos abaixo.

| Tipo | Campos adicionais e restrições |
| --- | --- |
| `select-action` | `action`: `income`, `patrocinio`, `tax`, `steal`, `assassinate`, `backstab` ou `negotiate`. Jogador ativo na fase de ação. |
| `select-target` | `targetId` de adversário vivo. |
| `cancel-target` | Jogador ativo na fase de seleção. |
| `accept` | Avança a reação ou o bloqueio. O contrato local usa o jogador ativo; a futura sala deve definir quando encerra a janela coletiva, sem deixar o autor forçar o fim antes da hora. |
| `block` | `character`: `magnata`, `executor`, `sentinela`, `mercenario` ou `broker`. O personagem e o jogador precisam constar nas opções de bloqueio da fase. |
| `challenge` | Jogador elegível e vivo. A fase determina a declaração contestada. |
| `lose` | `cardId` da própria influência na fase de perda. |
| `negotiate` | `keepIds` únicos, todos pertencentes à oferta privada. |

Sucesso: `{ "ok": true, "revision": 13 }`. Rejeição: `{ "ok": false, "revision": 12, "error": "INVALID_PHASE" }`. Erros de comando: `INVALID_COMMAND`, `NOT_AUTHORIZED`, `INVALID_PHASE`, `STALE_REVISION`. Sugestão HTTP: 400 para JSON inválido, 401 para credencial ausente, 403 para autorização, 404 para sala/partida desconhecida, 409 para revisão/fase incompatível e 422 para jogada inválida. Uma versão de protocolo não suportada retorna 400 com código `UNSUPPORTED_PROTOCOL` na camada HTTP.

## Sequência, privacidade e reconexão

O servidor serializa comandos por partida. Na mesma transação, verifica a chave de idempotência `(matchId, playerId, commandId)`, compara `expectedRevision`, aplica o comando e grava seu resultado. O mesmo comando retorna o resultado original. Reutilizar o mesmo ID com outro conteúdo é inválido. Cada transição aceita aumenta a revisão em um. Um comando rejeitado não altera a revisão. O cliente recupera um snapshot após uma revisão obsoleta.

O evento contém `{protocolVersion:1,type:"snapshot",matchId,view}`. `view` tem `revision`, `activeId`, `players` (ID, nome, saldo e número de influências), `deckCount`, `history`, `cemetery`, `phase`, opções autorizadas e campos privados `hand`, `choices`, `privatePlayerId`, `revealed`. `lastEvent` é opcional e serve para efeitos de Renda, Backstab e eliminação.

As fases são discriminadas por `kind`. `action` aguarda jogada, `target` contém a ação em seleção, `reaction` contém a declaração, `block-reaction` acrescenta o bloqueio, `loss` informa vítima, motivo e resultado público da contestação quando aplicável, `negotiation` informa jogador e quantidade a manter, e `finished` contém o vencedor e suas cartas tornadas públicas.

O servidor faz uma projeção por sessão autenticada antes de serializar o evento. Nunca transmite o baralho, a ordem dos sorteios, as ofertas de terceiros, nem o estado integral do motor. `choices` só contém cartas da própria perda ou negociação. O estado de apresentação local é descartado na reconexão. O cliente reapresenta sua credencial, recebe um snapshot atual, ignora mensagens mais antigas e retoma com base na fase devolvida. O servidor continua decidindo sorteios, resultados e substituições.

## Equivalência e próximo passo

Implementar o adaptador HTTP com URL de origem configurável e manter o mesmo formato de `GameView` nas duas plataformas. Reutilizar o motor em Node.js e traduzir suas transições em Spring Boot. Testar ambos com os mesmos casos JSON, baralho pré-fixado no ambiente de testes, comandos fora de ordem, repetições, vitórias após perda e visões de espectadores ou adversários. A conformidade exige resultados públicos, fases, códigos e visibilidade equivalentes para o mesmo roteiro. O mecanismo de autorização e a janela coletiva de reações são tarefas dos servidores.
