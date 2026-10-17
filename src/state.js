// Shared mutable game state. Every module reads/writes through `game`.
export const game = {
  scene: null,
  camera: null,
  time: 0,           // seconds since match start (only advances while unpaused)
  fighters: [],
  player: null,
  config: null,      // { agent, teamSize, difficulty }
  phase: 'menu',     // menu | buy | live | end | over
  phaseT: 0,
  round: 0,
  score: [0, 0],
  lossStreak: [0, 0],
  roundStartTime: 0,
  paused: false,
  attackers: 0,      // plant mode: team index currently attacking (spawns on -x)
  charge: null,
  tac: null,
  noises: [],
  // hooks filled in by game.js so other modules can talk to the HUD
  onKill: null,
  onPlayerHit: null,
  onPlayerDamaged: null,
  onBlind: null,
};

export const now = () => game.time;

export const enemiesOf = (f) => game.fighters.filter((o) => o.alive && o.team !== f.team);
export const alliesOf = (f) => game.fighters.filter((o) => o.alive && o.team === f.team && o !== f);

/** Which side of the map a team spawns on: -1 = west (-x), +1 = east. */
export function sideSign(team) {
  if (game.config?.mode === 'plant') return team === game.attackers ? -1 : 1;
  return team === 0 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Team colours. Blue / orange by default; Settings offers colour-blind friendly palettes.
// The arrays are changed in place so every module that imported them sees the new colours.
// ---------------------------------------------------------------------------
export const TEAM_PALETTES = {
  default: { name: 'Blue / Orange', hex: [0x3d8bff, 0xff8a1f], text: ['#7fb2ff', '#ffb066'] },
  contrast: { name: 'Blue / Yellow — for red-green colour blindness', hex: [0x2f6bff, 0xffd000], text: ['#86a8ff', '#ffe066'] },
  tritan: { name: 'Teal / Pink — for blue-yellow colour blindness', hex: [0x00b3ad, 0xff3d7f], text: ['#5fe0d9', '#ff8fb3'] },
};
export const TEAM_HEX = [...TEAM_PALETTES.default.hex];
export const TEAM_TEXT = [...TEAM_PALETTES.default.text];
const css = (h) => '#' + h.toString(16).padStart(6, '0');
export function setTeamPalette(key) {
  const p = TEAM_PALETTES[key] || TEAM_PALETTES.default;
  TEAM_HEX[0] = p.hex[0]; TEAM_HEX[1] = p.hex[1]; TEAM_TEXT[0] = p.text[0]; TEAM_TEXT[1] = p.text[1];
  const r = document.documentElement.style;
  r.setProperty('--ta', css(p.hex[0])); r.setProperty('--tb', css(p.hex[1]));
  r.setProperty('--ta-text', p.text[0]); r.setProperty('--tb-text', p.text[1]);
}
