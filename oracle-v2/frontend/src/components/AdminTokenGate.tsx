import { useMemo, useState } from 'react';

interface AdminTokenGateProps {
  children: React.ReactNode;
}

export function AdminTokenGate({ children }: AdminTokenGateProps) {
  const initialToken = useMemo(() => localStorage.getItem('admin_token') || '', []);
  const [token, setToken] = useState(initialToken);
  const [draft, setDraft] = useState(initialToken);

  if (token) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '48px auto',
        padding: '20px',
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--bg-card)',
        display: 'grid',
        gap: 10,
      }}
    >
      <h2 style={{ margin: 0, color: 'var(--terminal-green)' }}>Admin Token Required</h2>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
        This screen needs `ORACLE_AUTH_TOKEN` to access NanoClaw routes.
      </p>
      <input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste ORACLE_AUTH_TOKEN"
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          padding: '10px 12px',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            const next = draft.trim();
            if (!next) return;
            localStorage.setItem('admin_token', next);
            setToken(next);
          }}
          style={{
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            background: '#0f2015',
            color: 'var(--terminal-green)',
            padding: '8px 12px',
            cursor: 'pointer',
          }}
        >
          Save Token
        </button>
      </div>
    </div>
  );
}
