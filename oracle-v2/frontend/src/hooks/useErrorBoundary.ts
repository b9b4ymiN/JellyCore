import { useState } from 'react';

export function useErrorBoundary() {
  const [error, setError] = useState<Error | null>(null);
  if (error) throw error;

  return {
    throwError: (value: unknown) => {
      if (value instanceof Error) {
        setError(value);
        return;
      }
      setError(new Error(typeof value === 'string' ? value : 'Unknown error'));
    },
  };
}
