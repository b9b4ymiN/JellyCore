import { useToastContext } from '../components/ui/Toast';

export function useToast() {
  const { pushToast, dismissToast } = useToastContext();
  return {
    toast: pushToast,
    dismissToast,
    success: (message: string, durationMs?: number) => pushToast(message, 'success', durationMs),
    error: (message: string, durationMs?: number) => pushToast(message, 'error', durationMs),
    warning: (message: string, durationMs?: number) => pushToast(message, 'warning', durationMs),
    info: (message: string, durationMs?: number) => pushToast(message, 'info', durationMs),
  };
}
