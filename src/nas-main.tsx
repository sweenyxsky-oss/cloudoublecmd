import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Commander } from '@/components/commander';
import './styles.css';

// Self-hosted NAS entry: static SPA served by services/truenas-access behind its session login.
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><Commander /></StrictMode>);
