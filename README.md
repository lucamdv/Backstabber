# Backstabber

Jogo local de blefe, influência e traição com interface cyberpunk.

## Jogar

- **PWA:** abra [lucamdv.github.io/Backstabber](https://lucamdv.github.io/Backstabber/) e use o botão compacto **Instalar**.
- **Windows:** baixe `Backstabber-Windows-Setup.exe` na [versão mais recente](https://github.com/lucamdv/Backstabber/releases/latest).
- **macOS:** baixe `Backstabber-macOS-universal.dmg` na [versão mais recente](https://github.com/lucamdv/Backstabber/releases/latest).

O PWA consulta novas versões automaticamente. O instalador do Windows baixa atualizações em segundo plano e oferece a reinicialização quando a nova versão estiver pronta.

## Gerar no Windows

Clique com o botão direito em `scripts/build-windows.ps1` e escolha **Executar com PowerShell**, ou execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

O instalador será criado em `release/Backstabber-Windows-Setup.exe`.

## Publicação automática

Um envio para a branch `main` dispara duas automações:

- publica o PWA no GitHub Pages com uma versão única;
- gera os aplicativos Windows e macOS e cria uma nova versão em GitHub Releases.

Consulte [BUILD-MAC.md](BUILD-MAC.md) para as instruções do Mac e as observações sobre o Gatekeeper.
