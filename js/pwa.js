(() => {
  const isWeb = ["http:", "https:"].includes(window.location.protocol);
  const versionStorageKey = "backstabber_web_version";
  const updateCheckInterval = 5 * 60 * 1000;
  let installPrompt = null;
  let reloadingForUpdate = false;

  function getInstallUi() {
    return {
      button: document.getElementById("btn-install-pwa"),
      label: document.getElementById("pwa-install-label"),
      status: document.getElementById("pwa-install-status"),
    };
  }

  function getMobilePlatform() {
    const userAgent = navigator.userAgent;
    const isIpadOs =
      navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    if (/iphone|ipad|ipod/i.test(userAgent) || isIpadOs) return "ios";
    if (/android/i.test(userAgent)) return "android";
    return null;
  }

  function openInstallGuide(platform) {
    const guide = document.getElementById("mobile-install-guide");
    const intro = document.getElementById("install-guide-intro");
    const steps = document.getElementById("install-guide-steps");
    if (!guide || !intro || !steps) return;

    const instructions =
      platform === "ios"
        ? {
            intro: "No iPhone e iPad, o Backstabber é instalado diretamente pelo Safari:",
            steps: [
              "Abra esta página no Safari.",
              "Toque no botão Compartilhar na barra do navegador.",
              "Escolha Adicionar à Tela de Início.",
              "Confirme em Adicionar.",
            ],
          }
        : {
            intro: "No Android, instale o Backstabber pelo menu do navegador:",
            steps: [
              "Abra esta página no Chrome ou navegador compatível.",
              "Toque no menu de três pontos (⋮).",
              "Escolha Instalar aplicativo ou Adicionar à tela inicial.",
              "Confirme a instalação.",
            ],
          };

    intro.textContent = instructions.intro;
    steps.replaceChildren(
      ...instructions.steps.map((instruction) => {
        const item = document.createElement("li");
        item.textContent = instruction;
        return item;
      }),
    );
    guide.classList.add("is-open");
    guide.setAttribute("aria-hidden", "false");
    document.body.classList.add("install-guide-open");
    document.getElementById("btn-close-install-guide")?.focus();
  }

  function closeInstallGuide() {
    const guide = document.getElementById("mobile-install-guide");
    if (!guide) return;
    guide.classList.remove("is-open");
    guide.setAttribute("aria-hidden", "true");
    document.body.classList.remove("install-guide-open");
    getInstallUi().button?.focus();
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isGameScreen() {
    return /(?:^|\/)game\.html$/i.test(window.location.pathname);
  }

  function updateInstallUi(message, disabled = false) {
    const { button, status } = getInstallUi();
    if (!button) return;
    button.disabled = disabled;
    if (status) status.textContent = message;
  }

  function reloadWithSavedState() {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.dispatchEvent(new CustomEvent("backstabber-before-update"));
    window.location.reload();
  }

  async function checkPublishedVersion(registration) {
    try {
      const response = await fetch(`./version.json?check=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) return;

      const { version } = await response.json();
      if (!version) return;

      const previousVersion = localStorage.getItem(versionStorageKey);
      localStorage.setItem(versionStorageKey, version);
      if (!previousVersion || previousVersion === version) return;

      await registration.update();
      if (isGameScreen()) {
        sessionStorage.setItem("backstabber_update_pending", "1");
        return;
      }
      reloadWithSavedState();
    } catch (error) {
      console.debug("Verificação de atualização adiada.", error);
    }
  }

  async function registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none",
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!isGameScreen()) {
          sessionStorage.removeItem("backstabber_update_pending");
          reloadWithSavedState();
        }
      });

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            sessionStorage.setItem("backstabber_update_pending", "1");
          }
        });
      });

      await registration.update();
      await checkPublishedVersion(registration);
      window.setInterval(
        () => checkPublishedVersion(registration),
        updateCheckInterval,
      );
    } catch (error) {
      console.warn("Não foi possível ativar o modo PWA.", error);
    }
  }

  if ("serviceWorker" in navigator && isWeb) {
    window.addEventListener("load", registerServiceWorker);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallUi("PRONTO");
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    const { button } = getInstallUi();
    if (button) button.hidden = true;
  });

  document.addEventListener("DOMContentLoaded", () => {
    const { button, label } = getInstallUi();
    if (!button) return;

    if (!isWeb || isStandalone()) {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    const mobilePlatform = getMobilePlatform();
    if (mobilePlatform === "ios") {
      if (label) label.textContent = "INSTALAR NO IPHONE";
      updateInstallUi("TELA DE INÍCIO");
      button.setAttribute("aria-label", "Instalar Backstabber no iPhone ou iPad");
    } else if (mobilePlatform === "android") {
      if (label) label.textContent = "INSTALAR NO ANDROID";
      updateInstallUi("APLICATIVO PWA");
      button.setAttribute("aria-label", "Instalar Backstabber no Android");
    }

    document
      .getElementById("btn-close-install-guide")
      ?.addEventListener("click", closeInstallGuide);
    document.getElementById("mobile-install-guide")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeInstallGuide();
    });

    if (
      !isGameScreen() &&
      sessionStorage.getItem("backstabber_update_pending") === "1"
    ) {
      sessionStorage.removeItem("backstabber_update_pending");
      window.setTimeout(reloadWithSavedState, 100);
      return;
    }

    button.addEventListener("click", async () => {
      if (!installPrompt) {
        const isMacSafari =
          /macintosh/i.test(navigator.userAgent) &&
          /safari/i.test(navigator.userAgent) &&
          !/chrome|chromium|crios|edg/i.test(navigator.userAgent);
        if (mobilePlatform) {
          openInstallGuide(mobilePlatform);
          return;
        }
        updateInstallUi(
          isMacSafari ? "ADICIONAR AO DOCK" : "USE UM NAVEGADOR COMPATÍVEL",
        );
        return;
      }

      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      updateInstallUi(
        choice.outcome === "accepted" ? "INSTALANDO" : "CANCELADO",
        choice.outcome === "accepted",
      );
    });
  });
})();
