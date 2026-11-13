import { useId } from 'react';

/** 封蝋のふち。少し不揃いな円にして、溶けた蝋が広がった形に見せる（毎回同じ形）。 */
function waxOutline(cx: number, cy: number, r: number) {
  const jitter = [1.6, -0.8, 2.2, 0.4, -1.4, 1.9, -0.2, 2.4, -1.1, 0.9, 1.7, -1.6, 0.6, 2.0];
  const points = jitter.map((j, i) => {
    const a = (i / jitter.length) * Math.PI * 2;
    return [cx + Math.cos(a) * (r + j), cy + Math.sin(a) * (r + j)];
  });
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const start = mid(points[points.length - 1], points[0]);
  let d = `M${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
  points.forEach((p, i) => {
    const m = mid(p, points[(i + 1) % points.length]);
    d += ` Q${p[0].toFixed(2)} ${p[1].toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)}`;
  });
  return `${d} Z`;
}

const OUTLINE = waxOutline(40, 40, 33);

/** 封筒を閉じる封蝋。投函の最後に、フタの先端へ押す。 */
export function WaxSeal({ className = '', press = false }: { className?: string; press?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <span className={`wax-seal ${press ? 'wax-seal--press' : ''} ${className}`} role="img" aria-label="封蝋（受付済み）">
      <svg width="72" height="72" viewBox="0 0 80 80" aria-hidden="true">
        <defs>
          <radialGradient id={`wax-${id}`} cx="38%" cy="34%" r="70%">
            <stop offset="0" stopColor="var(--wax-hi)" />
            <stop offset=".55" stopColor="var(--wax)" />
            <stop offset="1" stopColor="var(--wax-lo)" />
          </radialGradient>
        </defs>
        <path className="wax-seal-drip" d={OUTLINE} fill={`url(#wax-${id})`} />
        {/* 型押しの面：くぼんだ内側と、浮き出た縁取り */}
        <circle cx="40" cy="40" r="22" fill="var(--wax-lo)" opacity=".35" />
        <circle cx="40" cy="40" r="22" fill="none" stroke="var(--wax-hi)" strokeWidth="1.2" opacity=".55" />
        <circle cx="40" cy="40" r="18.5" fill="none" stroke="var(--wax-lo)" strokeWidth="1" opacity=".6" />
        <text x="40" y="45.5" textAnchor="middle" fontSize="15" className="wax-seal-mark">MG</text>
      </svg>
    </span>
  );
}
