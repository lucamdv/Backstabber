# Sprint 02 — arquitetura

O motor local da Sprint 01 continua sendo usado pelo modo de passagem de aparelho. O servidor Node.js compõe esse motor com janelas coletivas persistidas. O React online envia comandos e renderiza snapshots projetados para a sessão autenticada.

1. Definir o contrato HTTP e as transições coletivas. Testar espera, prioridade e privacidade.
2. Adicionar as tabelas e rotas de identidade, amigos, convites e lobby. Testar autorização, lotação e prontidão.
3. Conectar o armazenamento transacional da partida e a interface compartilhada. Testar duas ou mais sessões HTTP e recuperação.
4. Validar build, tipos, lint, modo local e multiplayer. Registrar a homologação externa separadamente.

Uma transação recebe a identidade verificada pelo Supabase Auth, bloqueia a partida com `FOR UPDATE`, executa a transição, grava estado e resultado idempotente e confirma. O banco envia invalidações privadas do Realtime. O cliente busca novamente a visão autorizada, com polling como recuperação para mensagens perdidas.
