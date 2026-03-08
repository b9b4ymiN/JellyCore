import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import styles from './KeyboardShortcutOverlay.module.css';

function focusSearchField() {
  const input = document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]');
  input?.focus();
  input?.select();
}

export function KeyboardShortcutOverlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const shortcuts = useMemo(() => [
    {
      id: 'toggle-help',
      combo: '?',
      allowInInput: false,
      action: () => setOpen((prev) => !prev),
    },
    {
      id: 'close-help',
      combo: 'escape',
      enabled: open,
      allowInInput: true,
      action: () => setOpen(false),
    },
    {
      id: 'focus-search',
      combo: '/',
      allowInInput: false,
      action: () => {
        if (location.pathname !== '/search') {
          navigate('/search');
          setTimeout(focusSearchField, 120);
          return;
        }
        focusSearchField();
      },
    },
    {
      id: 'go-feed',
      combo: 'g f',
      allowInInput: false,
      action: () => navigate('/feed'),
    },
    {
      id: 'go-chat',
      combo: 'g c',
      allowInInput: false,
      action: () => navigate('/chat'),
    },
  ], [location.pathname, navigate, open]);

  useKeyboardShortcuts(shortcuts);

  if (!open) return null;

  return (
    <div className={styles.overlay} role="presentation" onClick={() => setOpen(false)}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2>Keyboard Shortcuts</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close shortcuts panel">Close</button>
        </header>
        <div className={styles.grid}>
          <div className={styles.row}><kbd>?</kbd><span>Open this shortcut panel</span></div>
          <div className={styles.row}><kbd>/</kbd><span>Focus search</span></div>
          <div className={styles.row}><kbd>G</kbd><kbd>F</kbd><span>Go to feed</span></div>
          <div className={styles.row}><kbd>G</kbd><kbd>C</kbd><span>Go to chat</span></div>
          <div className={styles.row}><kbd>Ctrl</kbd><kbd>G</kbd><span>Focus chat group picker</span></div>
          <div className={styles.row}><kbd>Shift</kbd><kbd>Enter</kbd><span>New line in chat composer</span></div>
        </div>
      </div>
    </div>
  );
}
