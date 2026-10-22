// FadeImage.tsx - Smooth loading image with fallback and shimmer
import React, { useState } from 'react';

interface FadeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackSrc?: string;
  aspectRatio?: string;
}

export const FadeImage: React.FC<FadeImageProps> = ({
  src,
  alt = '',
  fallbackSrc = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
  aspectRatio,
  style,
  className = '',
  ...props
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        aspectRatio,
        overflow: 'hidden',
        backgroundColor: 'var(--bg-surface)'
      }}
    >
      {!loaded && !error && (
        <div
          className="skeleton"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%'
          }}
        />
      )}
      <img
        src={error ? fallbackSrc : (src || fallbackSrc)}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setError(true);
          setLoaded(true);
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s ease, transform 0.4s ease',
          ...style
        }}
        className={className}
        {...props}
      />
    </div>
  );
};
