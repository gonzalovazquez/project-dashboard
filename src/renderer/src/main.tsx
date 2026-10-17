import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import './styles.css';

// Lets the stylesheet give the sidebar the native blur and make room for the traffic lights on a Mac.
if (/Mac/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent)) document.documentElement.classList.add('mac');

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
