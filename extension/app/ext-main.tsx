import './ext-fetch-shim';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/App.css';
import './ext.css';
import { ExtensionApp } from './ExtensionApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExtensionApp />
  </StrictMode>
);
