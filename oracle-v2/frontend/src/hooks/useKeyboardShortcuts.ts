import { useEffect, useRef } from 'react';

export interface KeyboardShortcut {
  id: string;
  combo: string;
  action: (event: KeyboardEvent) => void;
  enabled?: boolean;
  allowInInput?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function normalizeKey(value: string): string {
  if (value === ' ') return 'space';
  return value.toLowerCase();
}

function matchCombo(event: KeyboardEvent, combo: string, key: string): boolean {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const mainKey = parts[parts.length - 1];
  const requiresCtrl = parts.includes('ctrl');
  const requiresShift = parts.includes('shift');
  const requiresAlt = parts.includes('alt');

  return (
    key === mainKey
    && event.ctrlKey === requiresCtrl
    && event.shiftKey === requiresShift
    && event.altKey === requiresAlt
  );
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  const sequenceRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = normalizeKey(event.key);
      const now = Date.now();

      for (const shortcut of shortcuts) {
        if (shortcut.enabled === false) continue;

        const combo = shortcut.combo.trim().toLowerCase();
        const editable = isEditableTarget(event.target);
        if (editable && !shortcut.allowInInput) {
          continue;
        }

        if (combo.includes(' ')) {
          const [first, second] = combo.split(' ');
          const prev = sequenceRef.current;

          if (key === first) {
            sequenceRef.current = { key: first, at: now };
            continue;
          }

          if (prev && prev.key === first && key === second && now - prev.at < 1200) {
            event.preventDefault();
            sequenceRef.current = null;
            shortcut.action(event);
            return;
          }
          continue;
        }

        if (matchCombo(event, combo, key)) {
          event.preventDefault();
          shortcut.action(event);
          return;
        }
      }

      if (!sequenceRef.current) return;
      if (now - sequenceRef.current.at > 1200) {
        sequenceRef.current = null;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
