import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initInstallCapture } from './state/install';
import './index.css';

// Capture the install prompt before React mounts; browsers can fire it very early.
initInstallCapture();

// Precaches the app shell so SpendNote opens offline. (No-op in dev.)
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
