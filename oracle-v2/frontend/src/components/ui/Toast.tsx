import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import styles from './Toast.module.css';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
}

interface ToastContextValue {
  pushToast: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function makeToastId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((message: string, variant: ToastVariant = 'info', durationMs = 5000) => {
    const id = makeToastId();
    setItems((prev) => [...prev, { id, message, variant, durationMs }].slice(-5));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, durationMs);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ pushToast, dismissToast }), [dismissToast, pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.container} aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <article key={item.id} className={`${styles.toast} ${styles[item.variant]}`}>
            <p className={styles.message}>{item.message}</p>
            <button
              type="button"
              className={styles.close}
              aria-label="Dismiss notification"
              onClick={() => dismissToast(item.id)}
            >
              ×
            </button>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return context;
}
