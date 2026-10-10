import { useEffect, useState } from 'react';

export interface Viewport {
  vw: number;
  vh: number;
}

function read(): Viewport {
  if (typeof window === 'undefined') return { vw: 1920, vh: 1080 };
  return { vw: window.innerWidth, vh: window.innerHeight };
}

/** Viewport size in CSS pixels, updated on resize and orientation change. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState(read);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = read();
        setVp((prev) => (prev.vw === next.vw && prev.vh === next.vh ? prev : next));
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return vp;
}
