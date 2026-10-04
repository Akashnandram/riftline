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
