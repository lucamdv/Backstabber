# Backstabber AV2 · Esquema PostgreSQL

A [migração da Sprint 02](../../supabase/migrations/20261112000101_backstabber_multiplayer.sql) usa Supabase PostgreSQL 17. O Node.js recebe a identidade do Supabase Auth e executa as operações em transações PostgreSQL. O navegador usa a API HTTP e canais Realtime privados.

## Entidades

| Tabela | Chaves e responsabilidades |
| --- | --- |
| `bs_profiles` | PK `user_id` aponta para `auth.users`. `username` normalizado e único, `display_name`, `avatar_url`, consentimento para exibir atividade e último heartbeat. |
| `bs_friend_requests` | Remetente, destinatário, data e status. Um índice parcial permite uma única solicitação pendente por par em qualquer direção. |
| `bs_friends` | PK composta pelo par de IDs em ordem crescente. A aceitação cria a amizade e encerra a solicitação na mesma transação. |
| `bs_rooms` | ID, código aleatório único, anfitrião, limite de 2 a 10, estado e validade do lobby. |
| `bs_room_members` | PK composta por sala e conta. Guarda ordem de entrada, prontidão e último heartbeat autenticado. |
| `bs_invites` | ID, sala, remetente, destinatário, estado e expiração. Há no máximo um convite pendente por sala e destinatário. |
| `bs_matches` | Uma partida por sala, com estado autoritativo em JSONB. Uma revanche atualiza o estado e incrementa rodada e revisão sob o mesmo ID de partida. |
| `bs_match_commands` | PK composta por partida, conta e ID de comando. Guarda impressão do comando e resultado de repetição para idempotência. |

O JSONB da partida inclui o domínio, a janela aberta, respostas individuais, sequência, auditoria e histórico de jogo. A versão lida é alterada sob bloqueio de linha, na mesma transação do registro de idempotência. Nenhuma regra de partida é executada em gatilhos SQL.

## Concorrência e ciclo de vida

- Nas mutações de sala e partida, a ordem de bloqueio começa pela sala e segue para partida ou convite conforme a operação. A entrada por código e a aceitação de convite verificam capacidade sob o bloqueio da sala. Uma conta já inscrita tem a mesma vaga retornada no lobby.
- Entrada e saída reiniciam a prontidão de todos. O início exige autorização do anfitrião, pelo menos dois jogadores e prontidão e heartbeat válidos de todos. A criação do estado e a transição da sala para `started` confirmam juntas.
- O lobby vale por 24 horas. A leitura e as mutações verificam o vencimento. A sala iniciada mantém o estado até encerramento explícito. Se o anfitrião sair do lobby, o participante mais antigo assume. Sem participantes, a sala é encerrada.
- Convites valem 15 minutos e somente o destinatário pode decidir. Expiração impede o uso mesmo antes de o campo de status ser atualizado. O início, o encerramento e a saída de um remetente invalidam convites pendentes conforme o caso.
- Heartbeat de sala tem validade de 35 segundos. A disponibilidade social opt-in usa heartbeat de perfil com validade de 45 segundos. Um relógio que vence sem novas gravações é refletido na próxima consulta do cliente.
- O anfitrião pode encerrar a sala por comando explícito. Em partida iniciada, um participante também pode solicitar o encerramento após cinco minutos de ausência do anfitrião. A ausência mantém decisões pendentes até reconexão ou encerramento.

## Acesso e privacidade

RLS está ativa em todas as tabelas da aplicação. Os papéis `anon` e `authenticated` ficam sem acesso direto aos dados sociais e de jogo. O único grant a `authenticated` na aplicação permite ler as colunas `room_id` e `user_id` das próprias filiações, usadas na autorização Realtime. Perfil, busca, amigos, convites, lobby e a projeção privada passam pela API Node.js.

- `user:<uuid>` permite receber Broadcast apenas na conta correspondente.
- `room:<uuid>` permite ler Broadcast e Presence e publicar Presence apenas para participantes da sala.
- O cliente não tem permissão de publicar Broadcast. Gatilhos de banco publicam apenas `invalidate` com a categoria `room` ou `social`. O evento solicita uma nova leitura pela API e não inclui cartas, estado do jogo ou votos.
- A autorização dos canais é avaliada pela sessão Realtime e pode permanecer em cache até novo JWT ou reconexão. A API consulta associação atual em cada operação. Uma invalidação recebida por um cliente que já saiu não dá acesso ao estado da sala.
- A informação de Presence na interface complementa o heartbeat. A autorização para iniciar, agir ou encerrar usa a identidade e o estado persistidos no servidor.

## Homologação local

Use o [Supabase CLI](https://supabase.com/docs/reference/cli/introduction) para iniciar a configuração local na raiz. Verifique o suporte a containers e consulte `supabase start --help` e `supabase status --help` na versão instalada. As credenciais locais emitidas pela CLI alimentam o ambiente descrito no README. A configuração Google local é opt-in e o login precisa de credenciais reais e redirects autorizados para a instalação escolhida.

`npm test -- server/social.test.ts`, dentro de `web/`, aplica a migração real em PostgreSQL embutido (PGlite) com funções de teste de Auth e Realtime. A suíte verifica os grants e as políticas sob o papel `authenticated`, além das operações sociais e do lobby. Entrega Realtime via WebSocket, Google OAuth, pool remoto e concorrência entre conexões PostgreSQL independentes requerem homologação com os serviços correspondentes.

Para o ambiente homologado, desative canais públicos no Supabase Realtime, verifique a ausência de políticas permissivas de outros projetos sobre `realtime.messages` e teste contas membro e não membro. Conecte um cliente Realtime antes de exercitar o Broadcast de banco e mantenha consulta periódica como recuperação para mensagens perdidas. Consulte [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) e [Broadcast do banco](https://supabase.com/docs/guides/realtime/broadcast#broadcast-from-the-database).
