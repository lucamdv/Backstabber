# Testes E2E e concorrência

Em `web/`, execute `npm ci` e `npm run test:e2e`. O Playwright usa o Chrome instalado e verifica menu, tela de acesso e modo local em 1920×1080, 1366×768, 390×844 e 360×800.

Para habilitar o cenário `@live`, prepare três contas Google no ambiente dedicado. Em três sessões independentes, faça login por Amigos, crie os perfis, confirme que a sessão sobrevive ao reload e salve os estados locais. Por exemplo, em `web/`, use `npx playwright codegen --channel chrome --save-storage .auth/a.json <URL>/#/amigos`; feche a janela após autenticar e repita com `b.json` e `c.json`. Esses arquivos podem conter tokens. Use apenas o diretório ignorado `web/.auth/`, sem compartilhá-los.

Configure `BACKSTABBER_E2E_URL` com a origem autorizada e `BACKSTABBER_E2E_USERNAMES` com os três nomes de usuário separados por vírgula, na ordem a, b, c. Execute `npm run test:e2e -- --grep @live`. O roteiro cria uma sala descartável, estabelece amizade se necessário, usa convite e link, testa prontidão e mãos privadas, espera o último voto após reconexão e continua até a revanche. Use contas de teste sem solicitações ou convites antigos pendentes.

Para o PostgreSQL nativo, use um cluster PostgreSQL 17 descartável ligado a `127.0.0.1`, com role `bs_homologation` e banco de controle `backstabber_native`. A role precisa criar bancos e os papéis de fixture no cluster isolado. Exporte privadamente `BACKSTABBER_NATIVE_PG_URL` para o banco de controle. Execute `npm test -- server/native-postgres.test.ts`. A suíte cria e remove um banco descartável com UUID, aplica a migração e confirma esperas por lock em dois PIDs PostgreSQL. A migração, transações, RLS e locks são reais. As primitivas gerenciadas de Auth e Realtime são fixtures nessa suíte.
