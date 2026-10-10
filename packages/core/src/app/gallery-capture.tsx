import { useEffect, useRef, useState } from 'react';
import { SlideCanvas } from './components/slide-canvas';
import { nextPaint } from './lib/dom';
import { SlidePageProvider } from './lib/page-context';
import { waitForDataWaitfor, waitForFonts } from './lib/print-ready';
import type { SlideModule } from './lib/sdk';
import { loadSlide, slideIds } from './lib/slides';

export default function GalleryCapture() {
  const id = new URLSearchParams(window.location.search).get('id');
  const [slide, setSlide] = useState<SlideModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    loadSlide(id)
      .then((value) => {
        if (active) setSlide(value);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!slide || !ref.current) return;
    let active = true;
    const element = ref.current;
    (async () => {
      await nextPaint();
      await waitForFonts();
      await waitForDataWaitfor(element);
      await nextPaint();
      if (active) setReady(true);
    })().catch((cause) => {
      if (active) setError(String(cause));
    });
    return () => {
      active = false;
    };
  }, [slide]);
  if (!id)
    return (
      <div data-document-index={JSON.stringify({ version: 1, kind: 'slides', ids: slideIds })} />
    );
  if (error) return <div data-document-error={error} />;
  const FirstPage = slide?.default[0];
  return (
    <div
      ref={ref}
      className="h-svh w-full"
      data-document-ready={ready && FirstPage ? '' : undefined}
      data-document-title={slide?.meta?.title ?? id}
      data-document-count={slide?.default.length}
    >
      {FirstPage && (
        <SlideCanvas flat freezeMotion design={slide?.design}>
          <SlidePageProvider index={0} total={slide?.default.length ?? 1}>
            <FirstPage />
          </SlidePageProvider>
        </SlideCanvas>
      )}
    </div>
  );
}
