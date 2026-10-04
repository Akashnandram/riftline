# Riftline – tactical hero shooter

Play: https://riftline-flame.vercel.app

A browser 5v5 round-based tactical shooter: pick an agent, buy weapons and shields,
use abilities and win 5 rounds against bots. Three.js (from CDN), plain ES modules – no build step.

## Deploy

GitHub `Akashnandram/riftline` → Vercel project auto-deploys every push to `main`.

## Run locally

```bash
python3 -m http.server 5180
```

Open http://localhost:5180 in a desktop browser (needs pointer lock: keyboard + mouse).

## Controls

WASD move · Mouse aim/shoot · Shift walk (silent, accurate) · C crouch (hold) · Space jump · F hold to plant/defuse · RMB scope/zoom · R reload ·
1/2 primary/sidearm · Q/E abilities · X ultimate · B buy (buy phase) · Tab scoreboard · M mute · Esc pause

## Graphics & sound

- Menu → **Graphics**: Low (no post-processing/shadows, for weak laptops), Medium (shadows, bloom, MSAA, colour grade), High (adds ambient occlusion, 4K shadow map).
- All textures, gun models and sounds are generated in code — no asset downloads.
- **Real recordings:** drop audio files into `assets/sfx/` and list them in `assets/sfx/manifest.json`, e.g.
  `{ "raptor": ["raptor1.ogg", "raptor2.ogg"], "step": "step.ogg" }`. Any listed name (`p9`, `magnum`, `hornet`,
  `raptor`, `longbow`, `step`, `impact`, `whizz`, `magout`, `magin`, `bolt`, …) replaces the synthesised version
  and still gets 3D positioning, wall muffling and reverb.

## Modes

- **Plant / Defuse** (default): attackers spawn west and carry the Rift Charge; plant it on site A or B
  (hold F, 4s, standing still). Defenders stop the plant, or defuse (hold F, 7s — progress is kept at the
  halfway mark). The charge detonates 45s after planting. Teams swap sides and economies reset after round 4.
- **Elimination**: wipe the other team. First to 5 rounds in both modes.

## Combat rules

- Hit zones: head (weapon head damage), body, legs (×0.82). Some guns lose damage at range (`falloff`).
- Wall penetration: each gun has `pen` points; every wall costs thickness × material rate (`PENETRATION`
  in config). Rifles and the sniper go through crates and the lane dividers for reduced damage; stone blocks,
  outer walls and Aegis barriers stop everything. Bullet holes appear on both sides.
- Crouching lowers your hitbox and tightens spread by 30%, but you move slowly and can't jump.

## Bot tactics

`src/tactics.js` gives bots team plans in Plant mode: attackers pick a site and either execute together
or split through mid, wait at a staging point, push, plant and hold post-plant angles. Defenders spread over
A / B / mid holding spots scored by line of sight to the entrances, rotate on callouts, and retake + defuse
(one defuses, others cover). Bots pre-aim corners while moving, react slower to enemies off to the side,
overshoot flicks, crouch-spray at range and shoot through cover where a target just disappeared.
Callouts from your teammates appear under the minimap.

## Agents

| Agent | Role | Q | E | X (ultimate, 5 points) |
|---|---|---|---|---|
| VOLT | Duelist | Surge Dash | Flashpoint (flash) | Overcharge |
| HAZE | Controller | Veil (smoke) | Toxin Orb | Blackout |
| AEGIS | Sentinel | Bulwark (barrier) | Mend (heal) | Bastion |
| HAWK | Initiator | Recon Bolt | Shock Dart | Hunter's Fury |

## Code map

- `src/config.js` – all balance numbers: weapons, armor, economy, agents, bot difficulty
- `src/world.js` – map layout (boxes), rendering, sky/lighting, raycasts, smoke line-of-sight, nav grid + A*
- `src/textures.js` – procedural concrete/plaster/stone/wood/metal textures, decals
- `src/guns.js` – weapon models (first-person with hands, third-person for rigs)
- `src/characters.js` – articulated soldier rigs: per-agent gear, procedural walk/run/strafe, aim, arm IK, flinch, reload, verlet ragdolls, helmet/gun drops
- `src/audio.js` – 3D audio engine, reverb, occlusion, synthesised sounds, optional recordings
- `src/fx.js` – tracers, impacts, bullet holes, muzzle flashes
- `src/entities.js` – fighters: mesh, movement/collision, shooting, damage
- `src/abilities.js` – ability implementations, projectiles, smokes/pools/barriers
- `src/bot.js` – bot AI (vision, reaction time, aim error, strafing, lanes, hunting, ability use)
- `src/tactics.js` – team strategy for Plant mode, callouts, hold spots, corner checks
- `src/objective.js` – plant sites, the Rift Charge (carry/drop/plant/defuse/detonate), zone names
- `src/shop.js` – buy logic for player and bots
- `src/game.js` – match/round flow, input, camera, HUD, minimap, main loop

## Multiplayer later

All game state lives in `game` (`src/state.js`) and every fighter goes through the same
`moveFighter` / `tryFire` / `useAbility` functions whether it is the player or a bot, so a
networked player can replace a `BotBrain` without touching the combat code.
