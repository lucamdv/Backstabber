# Sprint 02.1 — relatório de homologação

Branch `feature/av2-sprint-02-homologation`, a partir de `96c1f212990e4329eedd54227f2cd311420f0b72`. O modo local, a aplicação original e o contrato de jogo da Sprint 02 foram preservados.

## Diagnóstico e correções

| Prioridade | Sintoma e causa | Correção |
| --- | --- | --- |
| P0 | Timeouts e deadlocks do PostgreSQL retornavam HTTP 500 genérico. Se o rollback falhasse, a conexão podia voltar ao pool. | Limites por transação, rollback, descarte de conexão comprometida e resposta 503. |
| P0 | Quando uma consulta deixava de autorizar o jogador, a arena mantinha o último snapshot. | Respostas 401, 403 ou 404 retiram o snapshot da tela. Uma resposta antiga não pode republicá-lo. |
| P1 | Amigos e Jogar Online levavam à mesma área. O ambiente sem configuração mostrava aviso genérico. | Rotas independentes, retorno PKCE ao destino original e estados de configuração, sessão expirada, cancelamento e logout. |
| P1 | O vencedor tinha mão preenchida, condição que escondia suas cartas no painel de vitória. | A vitória usa a cena local após a última ciência. Só o vencedor recebe e vê suas influências sobreviventes. |
| P1 | Reinscrição no mesmo tópico antes de terminar a saída do canal anterior. | O cliente aguarda a saída do canal privado antes de reinscrever. |
| P1 | No notebook, uma mesa de 10 jogadores deslocava mão e ações abaixo da tela. Em mobile, a lista de votos precedia os controles. | Arena cabe no viewport, controles aparecem antes da lista e o botão Mesa abre o placar vertical. |
| P2 | Amigos mostrava estado vazio durante carregamento e falhas. | Feedback de carregamento, erro, nova tentativa, convites e solicitações separados. |

## Evidências

- **Qualidade:** 95 testes da suíte principal, incluindo os 75 da Sprint 02, oito testes PostgreSQL nativos em execução separada e quatro testes Playwright de layout. TypeScript, ESLint e build passaram. O Vite apontou um chunk JavaScript de 545 kB antes de gzip.

- **PostgreSQL nativo 17.11:** oito testes em dois pools independentes. O banco confirmou dois PIDs simultaneamente bloqueados na mesma linha. Foram testados corrida pela última vaga, início e revanche concorrentes, duas contestações, contestação contra bloqueio, revisão obsoleta, replay e colisão de ID, reconexão e RLS. Timeout e deadlock reais produziram 503, sem avançar a revisão, e permitiram o reenvio. Auth e Realtime gerenciados usam fixtures nessa suíte.
- **Supabase Cloud:** projeto de homologação dedicado em São Paulo. Migração aplicada e versão registrada de acordo com o arquivo local. As oito tabelas do jogo têm RLS. As roles `anon` e `authenticated` não têm SELECT sobre o estado da partida, e `authenticated` não tem SELECT sobre o log idempotente. Uma consulta REST anônima ao estado foi recusada com 401. A assinatura real de um tópico privado sem sessão foi recusada pelo Realtime com `Unauthorized`. O advisor apontou apenas avisos informativos de tabelas reservadas à API e índices sem uso num banco vazio.
- **Chrome:** a arena com snapshots de teste foi verificada em 20 combinações de viewport e fase, incluindo ação, reação a bloqueio com nove respostas, Broker, perda de influência e vitória. Foram usados 1920×1080, 1366×768, 390×844 e 360×800. São emulações de viewport, sem aparelho físico.
- **Vercel:** projeto dedicado criado, com as variáveis públicas configuradas para Preview. A configuração de Node.js e o build Vite foram verificados localmente.

## Homologação pendente

| Verificação | Próxima ação |
| --- | --- |
| Google OAuth com três contas reais | Configurar o cliente Google e as Redirect URLs no projeto Supabase. Rodar o fluxo com três test users. |
| API hospedada | Configurar `DATABASE_URL` como sensível no ambiente Preview do projeto dedicado e publicar o preview autorizado. |
| Broadcast e Presence de usuários autorizados | Com a API hospedada e sessões reais, conferir eventos privados, reconexão e acesso negado após saída. |
| E2E distribuído e mobile online | Preparar três storage states e rodar o cenário `@live` no Chrome. Repetir os trechos de toque em aparelhos físicos quando disponíveis. |
| Pooler remoto | Conferir TLS, latência e a concorrência entre instâncias Vercel com a conexão do Supabase de homologação. |

[Configuração Supabase](supabase-setup.md) · [Google OAuth](google-oauth-setup.md) · [Preview Vercel](vercel-deployment.md) · [Cenário E2E](multiplayer-e2e.md) · [Contrato para Spring Boot](sprint-03-handoff.md).
