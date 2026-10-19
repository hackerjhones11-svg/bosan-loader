import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// The admin testing tools live on an unlinked route. This is NOT access
// control (see src/admin/AdminPanel.tsx); test rolls are always disclosed on screen.
const isAdmin = /^\/admin\/?$/.test(window.location.pathname);

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App admin={isAdmin} />
  </StrictMode>,
);
