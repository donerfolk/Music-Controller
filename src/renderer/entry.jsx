import { createRoot } from 'react-dom/client';
import { useRef, useCallback } from 'react';
import { PopoverShell } from './popover-shell.jsx';
import { initRenderer } from './renderer.js';

function App() {
  const controllerRef = useRef(null);
  const initOnce = useRef(false);

  const handleController = useCallback((api) => {
    controllerRef.current = api;
    if (!initOnce.current) {
      initOnce.current = true;
      initRenderer(controllerRef);
    }
  }, []);

  return <PopoverShell onController={handleController} />;
}

const mount = document.getElementById('popover');
createRoot(mount).render(<App />);
