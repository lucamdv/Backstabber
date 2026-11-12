# Sprint 03 — implementação Spring Boot

Use o contrato HTTP da Sprint 02 e as mesmas migrações Supabase. O navegador continua autenticando no Supabase e enviando o access token para a origem configurada em `VITE_API_URL`. O backend valida o token no Supabase e usa o identificador devolvido como autor do comando.

1. Implemente rotas e validação com o mesmo JSON, revisões e códigos HTTP. Use `@Transactional` e mantenha a ordem de bloqueio sala → partida para as rotas mutáveis da partida.
2. Porte as transições de `web/src/game/core/engine.ts` e a composição de janelas em `web/server/online-engine.ts`. Preserve custo adiantado do Executor, substituição da prova antes de devolver a carta, devolução ao monte e prioridade da contestação.
3. Use a tabela de comandos aceitos como registro idempotente. A mesma identidade, chave e conteúdo retornam a mesma revisão. Para revisão obsoleta, devolva `STALE_REVISION` e mantenha o estado.
4. Projete cada snapshot no servidor. A mão pertence à sessão. Escolhas de influência e ofertas de negociação são privadas. Não serialize o estado do agregado.
5. Execute os cenários de `web/server/online-engine.test.ts` e `web/server/http.test.ts` contra a implementação Java. Compare JSON de fases, revisões, prioridades, saldos e visibilidade. Injete um sorteio determinístico nos testes de domínio. Use o PostgreSQL local com duas conexões independentes para homologar a ordem de locks.
6. Altere somente a base da API no build frontend e repita lobby, partida, reconexão e revanche. Realtime continua usando os canais privados e as invalidações do banco.
