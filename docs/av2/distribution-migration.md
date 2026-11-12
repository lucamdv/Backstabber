# Backstabber AV2 · Continuidade da distribuição

A Sprint 01 prepara a aplicação React em `web/`, em paralelo com a versão original. A validação desta sprint usa o build local. A promoção dos artefatos React depende da homologação de cada canal.

## Situação atual

| Canal | Origem e operação |
| --- | --- |
| GitHub Pages | `.github/workflows/deploy-pwa.yml` chama `npm run build:web` na raiz e publica `web-dist/`. O script copia os dois HTMLs, estilos, scripts, imagens, vídeos e arquivos de PWA, e escreve a revisão em `version.json`. |
| PWA original | Manifesto com tela cheia/standalone e preferência por retrato. Service worker guarda o shell, usa rede primeiro para navegação, scripts, estilos e JSON, e deixa vídeos fora do cache. O código de instalação também oferece passos para iOS e Android. |
| Electron | `desktop/main.cjs` abre o `index.html` original com `loadFile`, renderer em sandbox e Node desativado no renderer. Electron Builder inclui os arquivos estáticos e mantém vídeos fora do ASAR. |
| Instaladores | `.github/workflows/release-desktop.yml` gera NSIS x64 e DMG/ZIP universal, guarda os artefatos e publica em GitHub Releases com os metadados e blockmaps do atualizador. A versão usa o número de execução do workflow. |

## GitHub Pages

1. Construir `web/` com instalação limpa do lockfile e validar teste, lint, tipos e build. Conferir que o artefato contém as imagens, os vídeos e os estilos da mesma revisão.
2. Validar o artefato em preview no caminho final, incluindo a base `/Backstabber/` do Pages ou uma base relativa. Usar roteamento por fragmento, ou configurar fallback onde houver suporte, para abrir e recarregar a arena diretamente sem depender de rewrites do GitHub Pages.
3. Em um ambiente de teste aprovado, hospedar a AV2 em prefixo separado e conferir interferência de workers do escopo pai, recursos com URL relativa, links diretos e atualização de uma versão para outra. Somente depois trocar a origem do artefato do workflow.
4. Guardar o último artefato estático original para reversão. Confirmar que a volta ao legado lê as próprias chaves e que a AV2 continua capaz de reconhecer um salvamento compatível.

## PWA da AV2

1. Versionar um manifesto com `id`, `start_url`, `scope` e ícones compatíveis com o caminho real. Durante convivência, utilizar uma identidade de instalação separada para a AV2.
2. Gerar a lista de precache a partir do build Vite. Ela deve incluir o HTML e os JS/CSS com hash, bem como os recursos necessários para jogar localmente. Tratar vídeos como melhoria online com imagem de fundo disponível offline. Proteger o cache da AV2 com prefixo próprio e confirmar que a política de limpeza do worker antigo, que apaga nomes iniciados por `backstabber-`, não o atinge.
3. Exibir instalação conforme o suporte do navegador, com instruções específicas de iOS/Android onde necessário. Validar retrato e tela cheia em dispositivo instalado. A preferência por movimento reduzido continua válida em modo instalado.
4. Aplicar updates em um momento seguro. A atualização deve preservar um snapshot de domínio estruturado antes de recarregar e deve ser evitada durante uma interação que não possa ser restaurada. Testar também a rota de entrada sem conexão, incluindo retorno à arena e uma partida local completa. Validar com versões anterior e nova, conexão intermitente e falha de cache.
5. No lançamento no mesmo caminho, planejar a transição de escopo e cache. Testar explicitamente clientes ainda controlados pelo worker legado, recarga da arena e rollback.

## Electron da AV2

1. Produzir `web/dist/` como parte do job de empacotamento. O processo principal pode carregar `web/dist/index.html` se o artefato funcionar com `file://`, com base relativa e navegação por fragmento. Validar carregamento de módulos, assets e persistência no renderer empacotado. Se o protocolo de arquivo não servir, usar protocolo local seguro e restrito à pasta de distribuição, sem expor um servidor externo.
2. Incluir apenas o artefato compilado e os arquivos do shell no novo perfil de empacotamento. Ajustar `asarUnpack` para os caminhos finais dos vídeos se os testes do renderer exigirem. Preservar sandbox, isolamento de contexto, desativação de Node no renderer e restrição de navegação.
3. Preservar app ID, política de atualização, convenção de versão e nomes de artefatos no momento do corte. Usar um canal de teste separado enquanto houver builds concorrentes. Antes de manter o mesmo identificador de aplicativo, testar continuidade de dados entre a localização da entrada original e a nova.
4. Validar instalação limpa e atualização de um binário anterior em Windows e macOS, incluindo macOS Intel e Apple Silicon quando disponíveis. Verificar tela cheia, vídeo, restauração de partida, comportamento com rede desligada e atualização na saída. Validar assinatura/notarização e comportamento real do atualizador antes de anunciar suporte ao canal.

As garantias de instalação, funcionamento offline e atualização do React dependem dessa homologação. A verificação do build web no navegador cobre o artefato React, enquanto os pipelines originais continuam sendo a referência para os instaladores e o PWA em uso.
