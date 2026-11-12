import { ReceivedSeal } from './received-seal';

const W = 272;
const H = 176;
/** フタの先端（封筒の真ん中）。ここに受付印を押す。 */
const TIP_Y = Math.round(H * 0.6);

/**
 * 投函の演出。便箋が封筒に入り → フタが折り込まれ → フタの先端の真ん中に「受付」印が押される。
 * 動きを減らす設定では、閉じて印が押された最後の状態だけを表示する（globals.css）。
 */
export function SealedLetter({ body }: { body?: string }) {
  return (
    <div className="sealed-letter" style={{ width: W, height: H }}>
      <span className="sealed-letter-shadow" aria-hidden="true" />
      <svg className="sealed-letter-back" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <rect x="1" y="1" width={W - 2} height={H - 2} rx="2" />
      </svg>
      <div className="sealed-letter-sheet" aria-hidden="true">
        {body && <p>{body}</p>}
      </div>
      <svg className="sealed-letter-pocket" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {/* 左右と下の覆い（線は描かない）。上の V 字の切れ込みだけが開いていて、閉じたフタがそこを隠す。 */}
        <path className="fill" d={`M1 1 L${W / 2} ${H * 0.52} L${W - 1} 1 V${H - 1} H1 Z`} />
        <path d={`M1 1 V${H - 1} H${W - 1} V1`} />
      </svg>
      <div className="sealed-letter-flap" aria-hidden="true">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <path d={`M1 1 H${W - 1} L${W / 2 + 14} ${TIP_Y - 10} Q${W / 2} ${TIP_Y + 4} ${W / 2 - 14} ${TIP_Y - 10} Z`} />
        </svg>
      </div>
      <span className="sealed-letter-seal" style={{ top: TIP_Y }}>
        <ReceivedSeal press />
      </span>
    </div>
  );
}
