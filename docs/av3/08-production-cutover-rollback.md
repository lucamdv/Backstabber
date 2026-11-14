# AV3 · Cutover para produção e rollback

Plano para avaliação do proprietário após o aceite gerenciado da Sprint 03.5. A API oficial permanece em Node.js.

## Decisões antes da janela

- Adotar Railway com deploy por commit como candidata para Java. Definir domínio HTTPS, região próxima ao PostgreSQL, limite de custo, tamanho do pool e plano de plantão após a medição de staging. Não há domínio contratado.
- Manter o domínio frontend e /api/v1. Preferir trocar o destino do gateway/rewrite Vercel com uma versão de implantação, após comprovar que o proxy preserva método, Authorization, corpo, status, cache e latência. A alternativa com VITE_API_URL absoluta exige build novo, CORS explícito e coordenação de clientes em cache.
- Confirmar no runbook de produção o perfil e a origem de Auth, PostgreSQL com CA, secrets de produção via provedor e compatibilidade das versões. O perfil homologation bloqueia produção. A configuração de um perfil de produção exige um artefato e revisão próprios, após autorização expressa.
- Fixar o SHA do release Java e o SHA/deploy Node de referência. Registrar os destinos anterior e novo, responsáveis, horário de baixo tráfego e critérios de interrupção. Ensaiar a troca em staging com o mesmo método de roteamento e sem sessões reais de produção.
- Confirmar backup recuperável e que não existe migration de formato para esta transição. Preservar bs_matches e bs_match_commands durante a transição e o retorno. OAuth, sessões e Realtime de produção devem permanecer vinculados ao projeto original.

## Sequência planejada

1. Abrir a janela somente após aceite de staging, ensaio de rollback e aprovação explícita. Registrar health checks, erros e latências da versão vigente.
2. Habilitar bloqueio temporário de mutações no ponto comum de entrada, incluindo URLs antigas/alternativas acessíveis. Aguardar requisições Node em voo e impedir que o deploy anterior aceite novas gravações durante o encaminhamento. Se não for possível impor uma entrada única, adiar a troca.
3. Verificar readiness do Java e testar leitura controlada. Publicar o roteamento que encaminha /api/v1 ao Java. Confirmar que um navegador com bundle anterior usa a mesma origem API. Remover o bloqueio de mutações apenas após verificar o destino único.
4. Com contas de controle autorizadas, validar login e refresh, perfil, sessão em partida existente, comando novo, replay e notificação Realtime. Inspecionar revisão e privacidade. Monitorar 401, 409, 5xx, latência da API e pool durante a janela.
5. Acionar rollback se houver perda de estado, divergência de revisão, falha de OAuth/Realtime ou violação de privacidade. Para limites operacionais, estabelecer a taxa de erro e latência aceitáveis a partir da medição do candidato e do Node no ensaio.

## Retorno ao Node.js

1. Fechar novamente as mutações no ponto comum de entrada e drenar requisições Java. Conferir a ausência de gravações ativas antes de reabrir no Node.
2. Reverter/promover na Vercel a versão anterior do roteamento, com Node e as mesmas variáveis/segredos já aprovados. Se a estratégia adotada for VITE_API_URL no bundle, promover o artefato anterior que já aponta ao Node ou reconstruir o commit conhecido com o destino anterior. Alterar a variável sozinha não muda bundles em circulação.
3. Conferir o endpoint antigo e manter proteção contra escritas pelos destinos antigos. Renovar o cache e validar clientes que mantêm a página aberta. Retomar mutações quando apenas o Node estiver aceitando novas gravações.
4. Conferir snapshots e replays de partidas criadas ou atualizadas pelo Java durante a janela e observar Auth e Realtime. As revisões e o registro idempotente persistem no mesmo banco. Registrar início, término, medições, impacto e causa da reversão.
