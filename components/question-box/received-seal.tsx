import { useId } from 'react';

/** 墨の「受付」印。確かに届いた瞬間だけに押す（Shirokane の Seal）。 */
export function ReceivedSeal({ className = '', press = false }: { className?: string; press?: boolean }) {
  const filterId = `seal-rough-${useId().replace(/:/g, '')}`;
  return (
    <span className={`sk-seal ${press ? 'sk-seal--press' : ''} ${className}`} role="img" aria-label="受付">
      <svg width="84" height="84" viewBox="0 0 80 80" aria-hidden="true">
        <defs>
          <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={7} />
            <feDisplacementMap in="SourceGraphic" scale={2.4} />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          <circle cx="40" cy="40" r="35" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <circle cx="40" cy="40" r="30" fill="none" stroke="currentColor" strokeWidth="1" />
          <text x="40" y="37" textAnchor="middle" fontSize="20">受</text>
          <text x="40" y="60" textAnchor="middle" fontSize="20">付</text>
        </g>
      </svg>
    </span>
  );
}
