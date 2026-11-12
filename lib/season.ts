export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Shirokane の暦：春 3–5月・夏 6–8月・秋 9–11月・冬 12–2月（日本時間）。 */
export function seasonFor(date: Date = new Date()): Season {
  const month = Number(
    new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'Asia/Tokyo' }).format(date)
  );
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export const SEASON_LABEL: Record<Season, string> = {
  spring: '春の線画 菜の花',
  summer: '夏の線画 陽光',
  autumn: '秋の線画 銀杏',
  winter: '冬の線画 陽だまり',
};
