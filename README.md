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

## Map

Point-symmetric (everything on the west half is mirrored through the centre), so both sides are fair.
Five walk-in houses — one on each site, one in each attacker lobby, and a two-door shop in mid — with
doors, shoot-through windows, interior walls, furniture and roofs. House walls are thin plaster (rifles,
SMGs and pistols can wallbang them). Plus a truck in each main, cars, sandbag walls, wooden fences,
barrels, trees, street lamps and a market stall. The layout lives in `WEST` / `CENTER_HOUSE` in `src/world.js`.

## Modes

- **Tutorial**: 10 guided steps in the practice range (look, move, jump, crouch, shoot, reload, aim, buy,
  ability, headshot). +500 XP the first time.
- **Practice Range**: targets at 10–50 m (static, crouched, strafing) in the west spawn corridor, live accuracy /
  headshot % / time-to-kill, free weapons (B), abilities refill.
- **Team Deathmatch**: 5-minute quick match, instant respawns with spawn protection, free loadout (B), first team
  to 8 kills per player wins.

- **Plant / Defuse** (default): attackers spawn west and carry the Rift Charge; plant it on site A or B
  (hold F, 4s, standing still). Defenders stop the plant, or defuse (hold F, 7s — progress is kept at the
  halfway mark). The charge detonates 45s after planting. Teams swap sides and economies reset after round 4.
- **Elimination**: wipe the other team. First to 5 rounds in both modes.

## Progression & settings

- XP for kills, headshots, assists, rounds, plants/defuses, wins and three daily challenges; levels unlock weapon
  skins (Arctic, Jungle, Tiger, Carbon, Crimson, Desert, Neon, Gold) equipped per gun in **Loadout & Skins**.
  Everything is stored in the browser (`localStorage`: `riftline.profile`, `riftline.settings`).
- **Settings**: sensitivity, ADS multiplier, invert Y, FOV, FPS counter, graphics quality, volume, crosshair editor
  (colour, length, thickness, gap, dot, outline, opacity, dynamic) and full key rebinding.

## Weapons

| Slot | Gun | Cost | Notes |
|---|---|---|---|
| Sidearm | P9 Sidearm | free | semi |
| Sidearm | Wasp MP | 450 | full-auto machine pistol |
| Sidearm | Magnum | 800 | revolver, one-tap head |
| SMG | Hornet SMG | 1600 | run-and-gun |
| Shotgun | Warden | 1850 | pump, 8 pellets, brutal up close |
| Rifle | Talon Burst Rifle | 2050 | 3-round burst per click |
| Rifle | Raptor AR | 2900 | classic full-auto |
| Rifle | Wraith SR | 2900 | suppressed: quiet, no tracers, small flash, bots hear it from closer |
| Heavy | Sentry DMR | 2250 | semi marksman rifle, extra ADS zoom |
| Heavy | Hammer LMG | 3200 | 50-round box, slow to move with |
| Sniper | Longbow | 4700 | scoped bolt-action |

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
- `src/textures.js` – procedural concrete/plaster/stone/wood/metal/roof/plank/paver/burlap textures, decals
- `src/props.js` – visual detail for map props (house roofs/frames/lamps, vehicles, trees, sandbags, fences, stall, plaza, power lines), merged per material
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
- `src/settings.js` – settings storage, crosshair drawing, settings screen with key rebinding
- `src/progress.js` – XP/levels, daily challenges, skin unlocks + equipped skins
- `src/skins.js` – weapon skin catalogue and procedural patterns
- `src/game.js` – match/round flow, TDM/range/tutorial, input, camera, HUD, minimap, loadout screen, main loop

## Multiplayer later

All game state lives in `game` (`src/state.js`) and every fighter goes through the same
`moveFighter` / `tryFire` / `useAbility` functions whether it is the player or a bot, so a
networked player can replace a `BotBrain` without touching the combat code.
