(() => {
  const root = document.documentElement;
  const isElectron = /\bElectron\//i.test(navigator.userAgent);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const highDensityLoad = window.devicePixelRatio > 1.75 && cores <= 8;
  const modestHardware = cores <= 4 || memory <= 4 || highDensityLoad;

  function lockInstalledAppZoom() {
    const isInstalled =
      window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches ||
      navigator.standalone === true;
    if (!isInstalled) return;

    const preventGesture = (event) => event.preventDefault();
    const preventPinch = (event) => {
      if (event.touches?.length > 1) event.preventDefault();
    };
    const preventKeyboardZoom = (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };

    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("touchmove", preventPinch, { passive: false });
    document.addEventListener("wheel", preventKeyboardZoom, { passive: false });
  }

  function chooseFxProfile() {
    if (reducedMotion.matches) return "reduced";
    if (modestHardware) return "lite";
    return isElectron ? "balanced" : "full";
  }

  function applyFxProfile() {
    const fx = chooseFxProfile();
    root.dataset.runtime = isElectron ? "electron" : "browser";
    root.dataset.fx = fx;

    window.BackstabberPerformance = Object.freeze({
      runtime: root.dataset.runtime,
      fx,
      particleCount: fx === "reduced" ? 0 : fx === "lite" ? 10 : fx === "balanced" ? 18 : 28,
      introDuration: fx === "reduced" ? 0 : fx === "lite" ? 1800 : 3000,
    });
  }

  function configureBackgroundWork() {
    const video = document.getElementById("bg-video");
    if (video) {
      video.disablePictureInPicture = true;
      video.setAttribute("disablepictureinpicture", "");
    }

    const shouldPauseVideo = () =>
      document.hidden || document.body.classList.contains("oracle-open");

    const syncRuntimeState = () => {
      root.classList.toggle("app-backgrounded", document.hidden);
      if (!video) return;

      if (shouldPauseVideo()) {
        video.pause();
      } else {
        video.play().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", syncRuntimeState, { passive: true });
    new MutationObserver(syncRuntimeState).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    syncRuntimeState();
  }

  applyFxProfile();
  lockInstalledAppZoom();
  reducedMotion.addEventListener?.("change", applyFxProfile);
  document.addEventListener("DOMContentLoaded", configureBackgroundWork, { once: true });
})();
