import { ThemeProvider } from 'next-themes';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const GalleryCapture = lazy(() => import('./gallery-capture'));
const isGalleryCapture = window.location.pathname === `${import.meta.env.BASE_URL}__documents`;

// biome-ignore lint/style/noNonNullAssertion: #root is guaranteed by index.html
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Suspense fallback={null}>{isGalleryCapture ? <GalleryCapture /> : <App />}</Suspense>
    </ThemeProvider>
  </StrictMode>,
);
