import { useEffect, useRef, useState } from 'react';

interface OutputTerminalProps {
  lines: string[];
  maxHeight?: number;
}

export function OutputTerminal({ lines, maxHeight = 220 }: OutputTerminalProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!autoScroll || !boxRef.current) return;
    boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [autoScroll, lines]);

  return (
    <div
      style={{
        border: '1px solid #30314a',
        borderRadius: 8,
        background: '#0a0b14',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: '1px solid #222437',
          background: '#111326',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span>Terminal Output</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>
      <pre
        ref={boxRef}
        style={{
          margin: 0,
          padding: 12,
          maxHeight,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 12,
          lineHeight: 1.45,
          fontFamily: '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          color: '#d5dcff',
        }}
      >
        {lines.length > 0 ? lines.join('\n') : '> waiting for output...'}
      </pre>
    </div>
  );
}
