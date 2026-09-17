(() => {
  const isWeb = ["http:", "https:"].includes(window.location.protocol);
  const versionStorageKey = "backstabber_web_version";
  const updateCheckInterval = 5 * 60 * 1000;
  let installPrompt = null;
  let reloadingForUpdate = false;

  function getInstallUi() {
    return {
      button: document.getElementById("btn-install-pwa"),
      status: document.getElementById("pwa-install-status"),
    };
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
    const { button } = getInstallUi();
    if (!button) return;

    if (!isWeb || isStandalone()) {
      button.hidden = true;
      return;
    }

    button.hidden = false;

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
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const isMacSafari =
          /macintosh/i.test(navigator.userAgent) &&
          /safari/i.test(navigator.userAgent) &&
          !/chrome|chromium|crios|edg/i.test(navigator.userAgent);
        updateInstallUi(
          isIos
            ? "ADICIONAR À TELA"
            : isMacSafari
              ? "ADICIONAR AO DOCK"
              : "HTTPS NECESSÁRIO",
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
