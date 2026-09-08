import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isTauri } from './api';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Web-Version: App-Shell offline vorhalten (nur im Browser, nur im Produktions-Build).
if (!isTauri && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
