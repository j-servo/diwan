import './promo.css';

import markUrl from '../../assets/worlds/house-of-wisdom/src/jservo-mark-flat.svg?url';
import { PROMO_COPY } from './copy.js';
import { usePromoTime } from './promoStore.js';
import { fadeAt } from './rigMath.js';
import type { PromoSegment } from './types.js';

/**
 * The promo's only DOM: lower-third captions that fade in and out, and the end card. Opacity is a
 * pure function of the script time (no CSS transitions), so every rendered frame is repeatable.
 */
export function PromoOverlay({ segment }: { segment: PromoSegment }) {
  const t = usePromoTime();
  const card = segment.endCardFrom === undefined ? 0 : fadeAt(t, segment.endCardFrom, 1e9, 1.2);
  const { endCard } = PROMO_COPY;
  return (
    <div className="promo-layer" aria-hidden="true">
      {segment.captions.map((c) => {
        const o = fadeAt(t, c.from, c.to);
        return (
          <div
            key={c.text}
            className="promo-caption"
            style={{ opacity: o, transform: `translateY(${(1 - o) * 8}px)` }}
          >
            {c.text}
          </div>
        );
      })}
      <div
        className="promo-card"
        style={{ opacity: card, visibility: card > 0 ? 'visible' : 'hidden' }}
      >
        <img className="promo-mark" src={markUrl} alt="" />
        <div className="promo-title">{endCard.title}</div>
        <div className="promo-tagline">{endCard.tagline}</div>
        <div className="promo-brand">{endCard.brand}</div>
      </div>
    </div>
  );
}
