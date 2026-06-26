import { useRef, useState, useCallback, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { PopoverContent } from './popover-content.jsx';

const POPOVER_TRANSITION = { duration: 0.35, ease: 'ease' };

const POPOVER_VARIANTS = {
  hidden: {
    filter: 'blur(12px)',
    y: 10,
    opacity: 0,
    transition: POPOVER_TRANSITION,
  },
  visible: {
    filter: 'blur(0px)',
    y: 0,
    opacity: 1,
    transition: POPOVER_TRANSITION,
  },
};

/**
 * @param {{ onController: (api: PopoverController) => void }} props
 */
export function PopoverShell({ onController }) {
  const [isOpen, setIsOpen] = useState(false);
  const closeResolveRef = useRef(null);
  const onEnterCompleteRef = useRef(null);
  const onExitStartRef = useRef(null);
  const controllerRef = useRef(null);

  if (!controllerRef.current) {
    controllerRef.current = {
      open() {
        flushSync(() => setIsOpen(true));
      },
      close() {
        return new Promise((resolve) => {
          closeResolveRef.current = resolve;
          setIsOpen(false);
        });
      },
      get onEnterComplete() {
        return onEnterCompleteRef.current;
      },
      set onEnterComplete(fn) {
        onEnterCompleteRef.current = fn;
      },
      get onExitStart() {
        return onExitStartRef.current;
      },
      set onExitStart(fn) {
        onExitStartRef.current = fn;
      },
    };
  }

  useLayoutEffect(() => {
    onController(controllerRef.current);
  }, [onController]);

  const handleExitComplete = useCallback(() => {
    closeResolveRef.current?.();
    closeResolveRef.current = null;
    window.musicController.notifyCloseComplete();
  }, []);

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {isOpen && (
        <motion.div
          key="popover-inner"
          className="popover__inner"
          data-theme="color-bends"
          style={{
            position: 'absolute',
            left: 'var(--card-x)',
            top: 'var(--card-y)',
            width: 'var(--card-w)',
            height: 'var(--card-h)',
          }}
          variants={POPOVER_VARIANTS}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onAnimationStart={(definition) => {
            if (definition === 'hidden') onExitStartRef.current?.();
          }}
          onAnimationComplete={(definition) => {
            if (definition === 'visible') onEnterCompleteRef.current?.();
          }}
        >
          <PopoverContent />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
