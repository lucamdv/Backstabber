# Sprint 02 — relatório de validação

Baseline `74e74d9fa3b4badac7678b931aa7cd7a81b18f50`. Branch `feature/av2-sprint-02-multiplayer`.

Resultado local: **75 testes em 11 arquivos**, incluindo os 48 da Sprint 01. TypeScript, ESLint e build Vite passaram.

| Escopo | Evidência local | Limite |
| --- | --- | --- |
| Modo local | Suíte original da Sprint 01 incluída na execução completa. | A UI online fica separada e a arena reutiliza o tabuleiro. |
| Contas e perfis | Sessões HTTP válidas, expiradas e de terceiros testadas. UI de sessão e perfil coberta. | O endpoint Auth é substituído por um fixture no teste. Login Google depende da configuração do provedor. |
| Amigos, convites e lobby | Migração executada em PGlite. Busca, duplicatas, destinatário, código, lotação, prontidão e início foram testados. | A janela de presença usa heartbeat autorizado pela API para decisões do lobby. |
| Três sessões | O teste cria três perfis, entra por código, confirma prontidão e consulta três visões. Uma resposta mantém a declaração aberta. A última resposta só é aplicada na revisão correta. | Sessões são requisições HTTP simuladas ao handler, sem navegadores independentes. |
| Concorrência | Duas instâncias do handler submetem comandos concorrentes. Repetição devolve a revisão original e contestações simultâneas auditam a primeira sequência válida. | PGlite usa uma conexão. O teste serializa as transações nessa conexão. Bloqueio entre processos PostgreSQL independentes requer homologação com o servidor real. |
| Reconexão | O teste expira o heartbeat de um participante. O voto continua pendente. Uma nova sessão da mesma conta recebe a mesma janela, sua mão e o progresso. | A reconexão do WebSocket depende de teste com Supabase Realtime em execução. |
| Vitória e revanche | Partida de dois jogadores do início ao fim por comandos, com dois Backstabs e escolha de carta exclusiva da vítima. Revanche restrita ao anfitrião. | Exercitada pela API local. |
| Privacidade | Projeções ocultam mão alheia, ofertas, ordem do baralho e voto de terceiros. Testes SQL verificam permissões de tabelas, tópicos privados e envio de Presence e Broadcast. | PGlite usa funções mínimas de teste para as primitivas Auth e Realtime do Supabase. |
| Interface online | React Testing Library cobre opções do lobby e da arena, mão durante a votação, bloqueio e atualização ao receber invalidação. | Desktop e mobile ainda precisam de inspeção visual em sessões online conectadas. |
| Vercel | Build Vite e verificação de tipos da função Node.js locais. | Validação do runtime hospedado e deploy dependem de ambiente autorizado. |

## Como reproduzir

Execute `npm run test -- --maxWorkers=2`, `npm run typecheck`, `npm run lint` e `npm run build` em `web/`. As suítes `server/http.test.ts` e `server/social.test.ts` executam a migração e as rotas. `server/online-engine.test.ts` testa as transições com sorteio controlado.

## Homologação externa pendente

O checkout de validação não tinha `web/.env` com credenciais. O cliente Docker estava presente, mas o daemon não estava acessível. Com Supabase local ou de teste autorizado, configure o Google, abra três perfis independentes do navegador e percorra o exemplo de três jogadores do [fluxo multiplayer](multiplayer-interaction-flow.md). Desconecte o último votante, observe a janela permanecer aberta e reconecte. Finalize a partida e inicie a revanche. Em seguida, submeta votos pela API por meio de duas conexões PostgreSQL independentes, confirme a serialização e valide a autorização dos canais no serviço Realtime.
