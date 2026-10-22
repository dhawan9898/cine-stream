// ErrorState.tsx - User friendly error state with retry
import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'We could not load this content. Please check your connection and try again.',
  onRetry
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
        minHeight: '260px'
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'rgba(236, 28, 36, 0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-primary)',
          marginBottom: '16px'
        }}
      >
        <AlertCircle size={28} />
      </div>

      <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
        {title}
      </h3>

      <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5, marginBottom: '20px' }}>
        {message}
      </p>

      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-secondary interactive"
          style={{ gap: '8px', fontSize: '13px', padding: '10px 20px' }}
        >
          <RefreshCw size={15} />
          <span>Try Again</span>
        </button>
      )}
    </div>
  );
};
