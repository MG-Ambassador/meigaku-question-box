'use client';

import { useRef, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { LoaderCircle } from 'lucide-react';

type Props = Omit<ComponentProps<typeof Button>, 'variant' | 'asChild'> & {
  tone?: 'primary' | 'secondary' | 'quiet' | 'dark';
  busy?: boolean;
};

/** Only the inner surface moves; the native button keeps its full hit target. */
export function ActionButton({ children, className = '', tone = 'primary', busy, disabled, onClick, ...props }: Props) {
  const [pressed, setPressed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  return <Button {...props} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`action-button action-${tone} ${className}`} data-pressed={pressed || undefined}
    onPointerDown={(e) => {
      if (e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY }; cancelled.current = false; setPressed(true);
      props.onPointerDown?.(e);
    }}
    onPointerMove={(e) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) {
        cancelled.current = true; setPressed(false);
      }
      props.onPointerMove?.(e);
    }}
    onPointerLeave={(e) => { if (start.current) cancelled.current = true; setPressed(false); props.onPointerLeave?.(e); }}
    onPointerCancel={(e) => { start.current = null; cancelled.current = true; setPressed(false); props.onPointerCancel?.(e); }}
    onPointerUp={(e) => { start.current = null; setPressed(false); props.onPointerUp?.(e); }}
    onBlur={(e) => { setPressed(false); props.onBlur?.(e); }}
    onKeyDown={(e) => { cancelled.current = false; if (e.key === ' ' || e.key === 'Enter') setPressed(true); props.onKeyDown?.(e); }}
    onKeyUp={(e) => { setPressed(false); props.onKeyUp?.(e); }}
    onClick={(e) => { if (cancelled.current && e.detail !== 0) { e.preventDefault(); return; } onClick?.(e); }}>
    <span className="action-surface">{busy && <LoaderCircle className="loading-icon" size={19} aria-hidden="true" />}{children}</span>
  </Button>;
}
