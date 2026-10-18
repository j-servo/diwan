import type { Costume, CostumeFn } from '../../agents/figureLogic.js';

type Look = Pick<Costume, 'wig' | 'dress' | 'shirt' | 'sash'> & { skin: string };

// Priests (Lector, Astronomer, Timekeeper) are shaved and wear white linen; craft titles wear a short
// rounded wig; three titles are women in the kalasiris and a long wig. Skin is a deep warm brown,
// varied (A2: deepened from B's tones, which read pale peach under the court's light).
const LOOKS: Record<string, Look> = {
  Lector: { skin: '#7a4e30', wig: 'none', dress: false, shirt: false, sash: true },
  Astronomer: { skin: '#6b4127', wig: 'none', dress: false, shirt: false, sash: false },
  Timekeeper: { skin: '#855735', wig: 'none', dress: false, shirt: true, sash: false },
  Physician: { skin: '#8e6038', wig: 'long', dress: true, shirt: false, sash: false },
  Architect: { skin: '#5f3b23', wig: 'short', dress: false, shirt: false, sash: false },
  Surveyor: { skin: '#74482b', wig: 'short', dress: false, shirt: true, sash: false },
  Copyist: { skin: '#80522f', wig: 'short', dress: false, shirt: false, sash: false },
  Archivist: { skin: '#704629', wig: 'long', dress: true, shirt: false, sash: false },
  Teacher: { skin: '#8a5a34', wig: 'short', dress: false, shirt: true, sash: false },
  Sculptor: { skin: '#66402a', wig: 'short', dress: false, shirt: false, sash: false },
  Draftsman: { skin: '#7b4d2d', wig: 'short', dress: false, shirt: true, sash: false },
  Herbalist: { skin: '#8c5e39', wig: 'long', dress: true, shirt: false, sash: false },
};
const PUPIL_SKINS = ['#855735', '#74482b', '#8e6038', '#6b4127', '#80522f', '#8a5a34'];
const FALLBACK: Look = LOOKS.Copyist;

/** A title repeated gets a numeral ("Astronomer II"): the numeral does not change the look. */
export const egyptCostume: CostumeFn = (persona, palette, subagent) => {
  if (subagent) {
    // pupils: shaved head with the side-lock, short kilt, small collar: baked, only the skin varies
    const skin = PUPIL_SKINS[((palette % 6) + 6) % 6];
    return { skin, wig: 'none', dress: false, shirt: false, sash: false };
  }
  const look = LOOKS[persona.replace(/ [IVX]+$/, '')] ?? FALLBACK;
  return { ...look };
};
