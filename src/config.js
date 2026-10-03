// All balance numbers live here.

export const WEAPONS = {
  p9: {
    key: 'p9', name: 'P9 Sidearm', slot: 'secondary', cost: 0,
    dmg: 26, head: 78, rate: 6.75, auto: false, mag: 12, reload: 1.6,
    spread: 0.004, move: 0.035, bloom: 0.012, maxBloom: 0.05, kick: 0.012, speedMul: 1,
    color: 0x30343c, len: 0.28,
  },
  magnum: {
    key: 'magnum', name: 'Magnum', slot: 'secondary', cost: 800,
    dmg: 55, head: 159, rate: 4, auto: false, mag: 6, reload: 2.2,
    spread: 0.003, move: 0.06, bloom: 0.035, maxBloom: 0.07, kick: 0.04, speedMul: 1,
    color: 0x6d5a3e, len: 0.34,
  },
  hornet: {
    key: 'hornet', name: 'Hornet SMG', slot: 'primary', cost: 1600,
    dmg: 26, head: 72, rate: 13.3, auto: true, mag: 30, reload: 2.25,
    spread: 0.01, move: 0.012, bloom: 0.0035, maxBloom: 0.045, kick: 0.006, speedMul: 0.98,
    color: 0x3b4a5c, len: 0.5,
  },
  raptor: {
    key: 'raptor', name: 'Raptor AR', slot: 'primary', cost: 2900,
    dmg: 40, head: 156, rate: 9.75, auto: true, mag: 25, reload: 2.5,
    spread: 0.0025, move: 0.07, bloom: 0.006, maxBloom: 0.06, kick: 0.011, speedMul: 0.94,
    color: 0x2a2d33, len: 0.7,
  },
  longbow: {
    key: 'longbow', name: 'Longbow', slot: 'primary', cost: 4700,
    dmg: 150, head: 255, rate: 0.75, auto: false, mag: 5, reload: 3.5,
    spread: 0.06, scopedSpread: 0.0008, move: 0.15, bloom: 0, maxBloom: 0, kick: 0.06, speedMul: 0.85,
    scope: 2.6, color: 0x3d5240, len: 0.95,
  },
};

export const ARMOR = {
  light: { name: 'Light Shield', cost: 400, value: 25 },
  heavy: { name: 'Heavy Shield', cost: 1000, value: 50 },
};

export const ECON = {
  start: 800, kill: 200, win: 3000, loss: 1900, lossStreak: 500, lossMax: 2900, max: 9000,
};

export const MATCH = {
  roundsToWin: 5, buyTime: 12, roundTime: 100, endTime: 4.5, ultCost: 5,
};

// Ability: charges refill every round. cooldown > 0 means a spent charge recharges mid-round.
export const AGENTS = {
  volt: {
    key: 'volt', name: 'VOLT', role: 'Duelist', color: '#ffd23f',
    blurb: 'Self-sufficient entry fragger who blinds and outpaces enemies.',
    q: { name: 'Surge Dash', desc: 'Dash a short distance in your movement direction.', charges: 2, cooldown: 14 },
    e: { name: 'Flashpoint', desc: 'Throw a flash that pops mid-air, blinding enemies looking at it.', charges: 2, cooldown: 0 },
    x: { name: 'Overcharge', desc: '10s: +25% fire rate, +20% speed and health regeneration.' },
  },
  haze: {
    key: 'haze', name: 'HAZE', role: 'Controller', color: '#b18cff',
    blurb: 'Cuts sightlines with smoke and denies space with toxin.',
    q: { name: 'Veil', desc: 'Deploy a smoke cloud where you aim that blocks vision.', charges: 2, cooldown: 30 },
    e: { name: 'Toxin Orb', desc: 'Lob an orb that leaves a damaging, slowing pool.', charges: 1, cooldown: 0 },
    x: { name: 'Blackout', desc: 'All enemies are blinded and revealed for 4 seconds.' },
  },
  aegis: {
    key: 'aegis', name: 'AEGIS', role: 'Sentinel', color: '#3ee6d6',
    blurb: 'Locks down angles with barriers and keeps fighting with heals.',
    q: { name: 'Bulwark', desc: 'Raise a bullet-proof barrier in front of you for 20s.', charges: 1, cooldown: 0 },
    e: { name: 'Mend', desc: 'Heal 60 HP over 3 seconds.', charges: 1, cooldown: 30 },
    x: { name: 'Bastion', desc: 'Instantly restore full health and gain 100 shield.' },
  },
  hawk: {
    key: 'hawk', name: 'HAWK', role: 'Initiator', color: '#7dff6b',
    blurb: 'Gathers intel and flushes enemies out of cover.',
    q: { name: 'Recon Bolt', desc: 'Fire a bolt that reveals enemies in its line of sight.', charges: 1, cooldown: 35 },
    e: { name: 'Shock Dart', desc: 'Fire a dart that explodes on impact for up to 75 damage.', charges: 2, cooldown: 0 },
    x: { name: "Hunter's Fury", desc: '3 wall-piercing energy blasts (80 dmg) that reveal targets.' },
  },
};

export const DIFFICULTY = {
  easy:   { reaction: 0.65, aimErr: 0.09, turn: 3.5, headChance: 0.12, still: 0.3, abilityChance: 0.3 },
  normal: { reaction: 0.42, aimErr: 0.055, turn: 6, headChance: 0.3, still: 0.6, abilityChance: 0.6 },
  hard:   { reaction: 0.26, aimErr: 0.03, turn: 10, headChance: 0.5, still: 0.85, abilityChance: 0.9 },
};

export const BOT_NAMES = [
  'Kestrel', 'Nyx', 'Rook', 'Juno', 'Sable', 'Orion', 'Vex', 'Mako', 'Talon', 'Ember',
  'Quill', 'Rhea', 'Zephyr', 'Onyx', 'Lynx', 'Cobalt', 'Wren', 'Atlas', 'Pike', 'Nova',
];

export const MOVE = { run: 6.75, walk: 3.8, accel: 60, airAccel: 12, jump: 5.4, gravity: 16 };
