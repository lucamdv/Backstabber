# Backstabber no macOS

O GitHub Actions gera automaticamente um aplicativo universal para Macs Intel e Apple Silicon sempre que a branch `main` recebe uma atualização.

## Jeito simples: baixar pronto

1. Abra a seção [Releases do Backstabber](https://github.com/lucamdv/Backstabber/releases/latest) no GitHub.
2. Entre na versão marcada como **Latest**.
3. Baixe `Backstabber-macOS-universal.dmg`.
4. Abra o DMG e arraste o Backstabber para Aplicativos.

O arquivo `Baixar-Backstabber-macOS.command` também pode baixar o DMG mais recente. Na primeira vez, clique com o botão direito nele, escolha **Abrir** e confirme.

> Como o aplicativo ainda não possui certificado Apple Developer, o macOS pode exibir o aviso de desenvolvedor não identificado. Em **Ajustes do Sistema › Privacidade e Segurança**, use **Abrir Mesmo Assim** apenas se o arquivo veio deste repositório oficial.

## Gerar manualmente em um Mac

1. Instale o Node.js 24 ou mais recente.
2. Abra o Terminal nesta pasta.
3. Execute `npm ci`.
4. Execute `npm run build:mac`.
5. Abra a pasta `release` para encontrar o DMG e o ZIP universais.

## PWA no Safari

Abra a página publicada em HTTPS, clique em **Compartilhar** e escolha **Adicionar ao Dock**. O PWA verifica atualizações automaticamente sem interromper uma partida em andamento.

## Assinatura oficial

Para eliminar o aviso do Gatekeeper, o projeto precisa de um certificado **Developer ID Application** e da notarização da Apple. Essas credenciais devem ficar nos segredos do GitHub Actions e nunca dentro do repositório.
