import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected application error',
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('UI ErrorBoundary captured error', { error, info });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={{ padding: 'max(24px, 4vw)' }}>
        <Card title="Something went wrong" subtitle="A runtime UI error was caught safely.">
          <p style={{ color: 'var(--text-secondary)' }}>{this.state.message}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" onClick={() => this.setState({ hasError: false, message: '' })}>
              Retry render
            </Button>
            <Button variant="primary" onClick={this.handleReload}>
              Reload page
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
