// Character outfits: every operative can change jacket colour, trousers, shoes, hairstyle, hair
// colour and headwear. Options unlock with player level; 'def' keeps the operative's own look.
// Bots get random outfits so a team doesn't look like a row of clones.

export const OUTFIT_SLOTS = [
  { key: 'top', name: 'Jacket', options: [
    { id: 'def', name: 'Default', lv: 1 }, { id: 'black', name: 'Black', hex: 0x2a2c30, lv: 1 }, { id: 'olive', name: 'Olive', hex: 0x55603e, lv: 2 },
    { id: 'navy', name: 'Navy', hex: 0x2b3a55, lv: 3 }, { id: 'sand', name: 'Sand', hex: 0xb59a6e, lv: 4 }, { id: 'maroon', name: 'Maroon', hex: 0x7a2e2a, lv: 6 },
    { id: 'white', name: 'White', hex: 0xd9d6cf, lv: 8 }, { id: 'violet', name: 'Violet', hex: 0x5a3f73, lv: 10 }, { id: 'teal', name: 'Teal', hex: 0x2f6f6a, lv: 12 },
  ] },
  { key: 'pants', name: 'Trousers', options: [
    { id: 'def', name: 'Default', lv: 1 }, { id: 'black', name: 'Black', hex: 0x24262a, lv: 1 }, { id: 'denim', name: 'Denim', hex: 0x34465f, lv: 2 },
    { id: 'khaki', name: 'Khaki', hex: 0x9a8a68, lv: 3 }, { id: 'grey', name: 'Grey', hex: 0x5c6066, lv: 4 }, { id: 'olive', name: 'Olive', hex: 0x4f5a3a, lv: 6 },
    { id: 'white', name: 'White', hex: 0xcfcac0, lv: 9 },
  ] },
  { key: 'shoes', name: 'Shoes', options: [
    { id: 'def', name: 'Default', lv: 1 }, { id: 'white', name: 'White', hex: 0xe6e3dc, lv: 1 }, { id: 'black', name: 'Black', hex: 0x1e1f22, lv: 2 },
    { id: 'brown', name: 'Brown', hex: 0x5a4030, lv: 3 }, { id: 'red', name: 'Red', hex: 0xa83a32, lv: 7 }, { id: 'neon', name: 'Neon', hex: 0x9cff3a, lv: 11 },
  ] },
  { key: 'hair', name: 'Hairstyle', options: [
    { id: 'def', name: 'Default', lv: 1 }, { id: 'short', name: 'Short', lv: 1 }, { id: 'crop', name: 'Buzz cut', lv: 1 }, { id: 'quiff', name: 'Quiff', lv: 2 },
    { id: 'fringe', name: 'Fringe', lv: 3 }, { id: 'bald', name: 'Shaved', lv: 4 }, { id: 'long', name: 'Long', lv: 5 }, { id: 'bun', name: 'Bun', lv: 7 },
    { id: 'mohawk', name: 'Mohawk', lv: 9 },
  ] },
  { key: 'hairColor', name: 'Hair colour', options: [
    { id: 'def', name: 'Default', lv: 1 }, { id: 'black', name: 'Black', hex: 0x15110e, lv: 1 }, { id: 'brown', name: 'Brown', hex: 0x5a3a22, lv: 1 },
    { id: 'blonde', name: 'Blonde', hex: 0xc9a35a, lv: 2 }, { id: 'ginger', name: 'Ginger', hex: 0x8a3a1e, lv: 4 }, { id: 'grey', name: 'Grey', hex: 0x8a8a8a, lv: 6 },
    { id: 'blue', name: 'Blue', hex: 0x3a5a9a, lv: 9 }, { id: 'pink', name: 'Pink', hex: 0xc0628a, lv: 12 },
  ] },
  { key: 'hat', name: 'Headwear', options: [
    { id: 'def', name: 'Default', lv: 1 }, { id: 'none', name: 'None', lv: 1 }, { id: 'cap', name: 'Cap', lv: 1 }, { id: 'headband', name: 'Headband', lv: 2 },
    { id: 'beanie', name: 'Beanie', lv: 3 }, { id: 'bandana', name: 'Bandana', lv: 5 }, { id: 'headset', name: 'Headset', lv: 6 }, { id: 'helmet', name: 'Helmet', lv: 8 },
  ] },
];
const BY_SLOT = Object.fromEntries(OUTFIT_SLOTS.map((s) => [s.key, s]));

// what 'def' means for each operative
export const AGENT_LOOK = {
  volt: { hair: 'quiff', hat: 'none' },
  haze: { hair: 'fringe', hat: 'none' },
  aegis: { hair: 'crop', hat: 'headband' },
  hawk: { hair: 'short', hat: 'cap' },
};

export const optionOf = (slot, id) => BY_SLOT[slot]?.options.find((o) => o.id === id) || BY_SLOT[slot]?.options[0];

/** Keep only known ids (outfits come from storage and from other players online). */
export function cleanOutfit(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const s of OUTFIT_SLOTS) if (typeof o[s.key] === 'string' && s.options.some((x) => x.id === o[s.key]) && o[s.key] !== 'def') out[s.key] = o[s.key];
  return out;
}

/** Resolved look for the character builder: colours (or null = operative default) and styles. */
export function resolveOutfit(agentKey, o = {}) {
  const look = AGENT_LOOK[agentKey] || AGENT_LOOK.volt;
  const hex = (slot) => (o[slot] && o[slot] !== 'def' ? optionOf(slot, o[slot]).hex ?? null : null);
  return {
    top: hex('top'), pants: hex('pants'), shoes: hex('shoes'), hairColor: hex('hairColor'),
    hair: o.hair && o.hair !== 'def' ? o.hair : look.hair,
    hat: o.hat && o.hat !== 'def' ? o.hat : look.hat,
  };
}

/** A random outfit for bots (anything goes, no level limits). */
export function randomOutfit() {
  const o = {};
  for (const s of OUTFIT_SLOTS) {
    if (Math.random() < 0.35) continue;                       // keep some defaults
    o[s.key] = s.options[1 + Math.floor(Math.random() * (s.options.length - 1))].id;
  }
  return o;
}

export const outfitKey = (o) => OUTFIT_SLOTS.map((s) => o?.[s.key] || 'def').join('.');
