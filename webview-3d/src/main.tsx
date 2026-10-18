import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { applyWorld } from './worlds/applyWorld.js';
import { installWorldCatalog } from './worlds/catalog.js';
import { activeWorld } from './worlds/registry.js';

// The catalog must exist before the first layoutLoaded builds seats.
applyWorld(activeWorld());
installWorldCatalog(activeWorld());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
