import type { MessageTransport } from '../../../core/src/transport.js';
import { DEMO_TIMELINE } from '../demo/timeline.js';
import { CUTS } from '../promo/cuts.js';
import { promoCut } from '../promo/promoMode.js';
import { activeWorld } from '../worlds/registry.js';
import { DemoTransport } from './demoTransport.js';
import { FilteredTransport } from './filteredTransport.js';
import { createLiveTransport } from './liveTransport.js';
import type { TransportMode } from './mode.js';
import { resolveDemoSpeed, resolveMode } from './mode.js';
import { takeSteerToken } from '../steer/token.js';

export const transportMode: TransportMode = resolveMode(
  window.location.search,
  import.meta.env.VITE_DIWAN_DEMO,
);

// Steer mode only: the server put a control token in the page. Taken once, here, and removed.
const steerToken = transportMode === 'live' ? takeSteerToken() : null;

/** The promo cut's part for the active world; its own timeline, stepped by hand (PromoRig). */
export const promoSegment =
  promoCut && transportMode === 'demo'
    ? (CUTS[promoCut]?.segments.find((s) => s.world === activeWorld().id) ?? null)
    : null;
export const promoDemo = promoSegment
  ? new DemoTransport(promoSegment.timeline, { loop: false, manual: true })
  : null;

const inner: MessageTransport =
  promoDemo ??
  (transportMode === 'demo'
    ? new DemoTransport(DEMO_TIMELINE, {
        loop: true,
        speed: resolveDemoSpeed(window.location.search),
      })
    : createLiveTransport(steerToken));

/** Same export shape as upstream's webview-ui/src/transport/index.ts. */
export const transport: MessageTransport = new FilteredTransport(
  inner,
  activeWorld().floorPlan,
  steerToken !== null,
);
export type { MessageTransport } from '../../../core/src/transport.js';
