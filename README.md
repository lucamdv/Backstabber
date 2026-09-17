<div align="center">
  <img src="images/isologo.png" alt="Backstabber" width="560">

  <p><strong>Blefe. Influência. Traição.</strong><br>Um jogo de intriga social com estética cyberpunk para jogar presencialmente em um único dispositivo.</p>

  [![PWA](https://img.shields.io/badge/JOGAR-PWA-00f3ff?style=for-the-badge&logo=pwa&logoColor=050510)](https://lucamdv.github.io/Backstabber/)
  [![Windows](https://img.shields.io/badge/BAIXAR-WINDOWS-ff0055?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/lucamdv/Backstabber/releases/latest/download/Backstabber-Windows-Setup.exe)
  [![macOS](https://img.shields.io/badge/BAIXAR-macOS-f2f2f2?style=for-the-badge&logo=apple&logoColor=050510)](https://github.com/lucamdv/Backstabber/releases/latest/download/Backstabber-macOS-universal.dmg)

  ![Versão](https://img.shields.io/github/v/release/lucamdv/Backstabber?display_name=tag&style=flat-square&color=00f3ff)
  ![Build](https://img.shields.io/github/actions/workflow/status/lucamdv/Backstabber/release-desktop.yml?style=flat-square&label=desktop&color=ff0055)
  ![PWA](https://img.shields.io/github/actions/workflow/status/lucamdv/Backstabber/deploy-pwa.yml?style=flat-square&label=PWA&color=00f3ff)
</div>

---

## Entre no jogo

| Plataforma | Acesso | Observação |
| --- | --- | --- |
| 🌐 **PWA** | [Jogar ou instalar no navegador](https://lucamdv.github.io/Backstabber/) | Funciona offline depois do primeiro acesso |
| 🪟 **Windows** | [Baixar o instalador `.exe`](https://github.com/lucamdv/Backstabber/releases/latest/download/Backstabber-Windows-Setup.exe) | Abre em tela cheia e recebe atualizações automáticas |
| 🍎 **macOS** | [Baixar o instalador `.dmg`](https://github.com/lucamdv/Backstabber/releases/latest/download/Backstabber-macOS-universal.dmg) | Aplicativo universal para Apple Silicon e Intel |

> Os downloads sempre apontam para a versão mais recente publicada no GitHub Releases.

## Sobre o Backstabber

No Backstabber, cada jogador controla influências secretas e pode declarar qualquer personagem — tendo a carta ou não. Use Créditos, conteste blefes, bloqueie seus rivais e seja a última pessoa com uma influência em jogo.

- De **1 a 10 jogadores** no mesmo dispositivo.
- Baralhos proporcionais de **15, 20 ou 25 cartas**.
- Cartas: **Magnata, Executor, Sentinela, Mercenário e Broker**.
- Ações de **Patrocínio, Backstab, Taxar, Executar, Extorquir e Negociar**.
- Oráculo integrado com ações e bloqueios de cada personagem.
- Animações cinematográficas de Backstab, derrota e vitória.
- Partida salva localmente e funcionamento offline no PWA.

## Oráculo

<div align="center">
  <p>Conheça as cinco influências que comandam a mesa.</p>
</div>

| Carta | Poderes |
| :---: | --- |
| <img src="images/magnata_card.png" alt="Carta Magnata" width="170"><br>**MAGNATA** | **Ação — Taxa:** recebe **3 Créditos** do tesouro.<br><br>**Bloqueia:** Patrocínio, impedindo qualquer jogador de receber 2 Créditos.<br><br>**Pode ser bloqueado por:** ninguém. |
| <img src="images/executor_card.png" alt="Carta Executor" width="170"><br>**EXECUTOR** | **Ação — Executar:** paga **3 Créditos** para eliminar uma influência de outro jogador.<br><br>**Bloqueia:** nenhuma ação.<br><br>**Pode ser bloqueado por:** Sentinela. |
| <img src="images/sentinela_card.png" alt="Carta Sentinela" width="170"><br>**SENTINELA** | **Ação:** não possui ação própria no turno.<br><br>**Bloqueia:** Executor, protegendo sua influência da eliminação.<br><br>**Pode ser bloqueado por:** não se aplica. |
| <img src="images/mercenario_card.png" alt="Carta Mercenário" width="170"><br>**MERCENÁRIO** | **Ação — Extorquir:** rouba até **2 Créditos** de outro jogador.<br><br>**Bloqueia:** outro Mercenário.<br><br>**Pode ser bloqueado por:** Mercenário ou Broker. |
| <img src="images/broker_card.png" alt="Carta Broker" width="170"><br>**BROKER** | **Ação — Negociar:** compra **2 cartas**, escolhe quais influências manter e devolve 2 ao baralho.<br><br>**Bloqueia:** Mercenário, impedindo que seus Créditos sejam roubados.<br><br>**Pode ser bloqueado por:** ninguém. |

Toda declaração de personagem pode ser contestada. Se a carta for verdadeira, ela volta ao monte, o jogador compra uma substituta aleatória e quem contestou perde uma influência. Se era blefe, quem declarou perde a influência e a ação é cancelada.

## Atualizações automáticas

O PWA verifica novas versões sem interromper uma partida em andamento. No Windows, o aplicativo baixa a atualização em segundo plano e oferece a reinicialização quando ela estiver pronta.

Cada envio à branch `main` executa o GitHub Actions para:

1. publicar o PWA no GitHub Pages;
2. gerar o instalador atualizável do Windows;
3. gerar o DMG universal para macOS;
4. publicar todos os arquivos em uma nova versão do GitHub Releases.

## macOS e Gatekeeper

Como o projeto ainda não possui um certificado Apple Developer, o macOS pode informar que o desenvolvedor não foi identificado. Se o aplicativo foi baixado deste repositório oficial, abra **Ajustes do Sistema › Privacidade e Segurança** e escolha **Abrir Mesmo Assim**.

Mais detalhes estão em [BUILD-MAC.md](BUILD-MAC.md).

## Desenvolvimento

Requer [Node.js 24 ou mais recente](https://nodejs.org/).

```bash
npm ci
npm run desktop
```

Para gerar o instalador do Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

O arquivo será criado em `release/Backstabber-Windows-Setup.exe`.

---

<div align="center">
  <strong>Confie em ninguém. Principalmente em quem diz ter a carta.</strong>
</div>
