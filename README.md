# Riftline – tactical hero shooter

A browser 5v5 round-based tactical shooter: pick an agent, buy weapons and shields,
use abilities and win 5 rounds against bots. Three.js (from CDN), plain ES modules – no build step.

## Run locally

```bash
python3 -m http.server 5180
```

Open http://localhost:5180 in a desktop browser (needs pointer lock: keyboard + mouse).

## Controls

WASD move · Mouse aim/shoot · Shift walk (silent, accurate) · Space jump · RMB scope/zoom · R reload ·
1/2 primary/sidearm · Q/E abilities · X ultimate · B buy (buy phase) · Tab scoreboard · M mute · Esc pause

## Graphics & sound

- Menu → **Graphics**: Low (no post-processing/shadows, for weak laptops), Medium (shadows, bloom, MSAA, colour grade), High (adds ambient occlusion, 4K shadow map).
- All textures, gun models and sounds are generated in code — no asset downloads.
- **Real recordings:** drop audio files into `assets/sfx/` and list them in `assets/sfx/manifest.json`, e.g.
  `{ "raptor": ["raptor1.ogg", "raptor2.ogg"], "step": "step.ogg" }`. Any listed name (`p9`, `magnum`, `hornet`,
  `raptor`, `longbow`, `step`, `impact`, `whizz`, `magout`, `magin`, `bolt`, …) replaces the synthesised version
  and still gets 3D positioning, wall muffling and reverb.

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
- `src/shop.js` – buy logic for player and bots
- `src/game.js` – match/round flow, input, camera, HUD, minimap, main loop

## Multiplayer later

All game state lives in `game` (`src/state.js`) and every fighter goes through the same
`moveFighter` / `tryFire` / `useAbility` functions whether it is the player or a bot, so a
networked player can replace a `BotBrain` without touching the combat code.
