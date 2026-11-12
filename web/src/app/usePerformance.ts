import { useEffect } from 'react';

export function usePerformance() {
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const root = document.documentElement;
    const electron = /\bElectron\//i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 8;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const modest = cores <= 4 || memory <= 4 || (window.devicePixelRatio > 1.75 && cores <= 8);
    const updateProfile = () => {
      root.dataset.runtime = electron ? 'electron' : 'browser';
      root.dataset.fx = media?.matches ? 'reduced' : modest ? 'lite' : electron ? 'balanced' : 'full';
    };
    const updateVisibility = () => root.classList.toggle('app-backgrounded', document.hidden);
    updateProfile();
    updateVisibility();
    media?.addEventListener('change', updateProfile);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      media?.removeEventListener('change', updateProfile);
      document.removeEventListener('visibilitychange', updateVisibility);
      delete root.dataset.runtime;
      delete root.dataset.fx;
      root.classList.remove('app-backgrounded');
    };
  }, []);
}
