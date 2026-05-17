import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-rc-bg flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="text-2xl font-bold text-rc-text mb-2">Something went wrong</h1>
          <p className="text-rc-muted mb-6 max-w-md">
            The application encountered an unexpected error. This has been logged for our team.
          </p>
          <div className="bg-black/40 p-4 rounded-xl text-left text-xs font-mono text-red-400 mb-6 w-full max-w-lg overflow-auto max-h-40">
            {this.state.error?.toString()}
            <br />
            {this.state.error?.stack}
          </div>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-2 bg-rc-accent hover:bg-rc-accentLt text-white rounded-xl font-bold transition-all"
          >
            Go Back Home
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
