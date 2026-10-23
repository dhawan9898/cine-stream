// ErrorBoundary.tsx - React Error Boundary
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ErrorState.tsx';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          message={this.state.error?.message || 'An unexpected rendering error occurred.'}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
