'use client';

import { useEffect } from 'react';
import { seasonFor } from '@/lib/season';

/** 暦に合わせて <html data-season> を切り替える。変わるのは光の色だけ。 */
export function SeasonTheme() {
  useEffect(() => {
    document.documentElement.dataset.season = seasonFor();
  }, []);
  return null;
}
