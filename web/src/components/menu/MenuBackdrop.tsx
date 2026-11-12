import { useEffect, useRef } from 'react';

export function MenuBackdrop({ paused }: { paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    function synchronize() {
      if (!element) return;
      if (paused || document.hidden || reducedMotion?.matches) {
        if (!element.paused) element.pause();
      } else if (element.paused && element.readyState >= 2) {
        void element.play().catch(() => undefined);
      }
    }

    synchronize();
    document.addEventListener('visibilitychange', synchronize);
    reducedMotion?.addEventListener('change', synchronize);
    element.addEventListener('canplay', synchronize);
    return () => {
      document.removeEventListener('visibilitychange', synchronize);
      reducedMotion?.removeEventListener('change', synchronize);
      element.removeEventListener('canplay', synchronize);
    };
  }, [paused]);

  return (
    <>
      <video ref={video} muted loop playsInline preload="auto" disablePictureInPicture id="bg-video" aria-hidden="true">
        <source src="background_mobile.mp4" type="video/mp4" media="(max-width: 900px), (max-height: 600px) and (pointer: coarse)" />
        <source src="background.mp4" type="video/mp4" />
      </video>
      <div className="mobile-brand">
        <img className="mobile-brand-symbol" src="images/isotipo.png" alt="" />
        <span className="mobile-brand-wordmark"><img src="images/isologo.png" alt="Backstabber" /></span>
        <small>PROTOCOLO MOBILE</small>
      </div>
    </>
  );
}
