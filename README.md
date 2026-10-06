# Riftline – third-person squad shooter

Play: https://riftline-flame.vercel.app

A browser third-person squad shooter with non-stop respawn matches: pick an operative (each has a
passive perk) and a free loadout of guns and gadgets, sprint and slide around five maps and fight over
the Rift Node. Three.js (from CDN), plain ES modules – no build step.

## Deploy

GitHub `Akashnandram/riftline` → Vercel project auto-deploys every push to `main`.

## Run locally

```bash
python3 -m http.server 5180
```

Open http://localhost:5180 in a desktop browser (needs pointer lock: keyboard + mouse).

## Controls

WASD move · Mouse aim/shoot · Shift sprint (gun lowered) · C crouch (hold), slide while sprinting · Space jump (slide-jump keeps speed) ·
RMB aim (tighter over-the-shoulder view) / scope · R reload · 1/2 primary/sidearm · Q/E gadgets · B loadout · Tab scoreboard · M mute · Esc pause.
The camera is third-person by default (Settings → Third-person camera to switch to first person).

## Graphics & sound

- Menu → **Graphics**: Low (no post-processing/shadows, for weak laptops), Medium (shadows, bloom, MSAA, colour grade), High (adds ambient occlusion, 4K shadow map).
- All textures, gun models and sounds are generated in code — no asset downloads.
- **Real recordings:** drop audio files into `assets/sfx/` and list them in `assets/sfx/manifest.json`, e.g.
  `{ "raptor": ["raptor1.ogg", "raptor2.ogg"], "step": "step.ogg" }`. Any listed name (`p9`, `magnum`, `hornet`,
  `raptor`, `longbow`, `step`, `impact`, `whizz`, `magout`, `magin`, `bolt`, …) replaces the synthesised version
  and still gets 3D positioning, wall muffling and reverb.

## Maps

Five maps, picked at random each match (or choose one on the menu / in the online lobby):

- **Old Town** – village streets, walk-in houses, cars, a market square and lookout terraces in mid.
- **Dunes** – desert town around a raised mesa; A site has a stone dais and a rooftop "heaven", B a walled terrace.
- **Harbor** – container port at sunset; container rows split the lanes, a climbable warehouse roof in mid,
  a container stack on A and a loading dock on B.
- **Frostpeak** – snowbound outpost with falling snow; radar deck in mid, a bunker under a rocky ridge on A,
  a helipad and fuel depot on B.
- **Temple** – jungle ruins; a three-tier stepped pyramid in mid, an altar court on A, a ruined library and ledge on B.

Every map is point-symmetric (both sides are fair) and shares the same arena frame (80 x 60 m, spawns behind
x = ±30, A at +x/-z, B at +x/+z), so all modes, the range and the tutorial work everywhere. Raised areas are
solid blocks reached by stairs (0.25 m steps you walk up); the nav grid stores a floor height per cell so bots
climb and hold high ground too. Each map lives in `src/maps/<name>.js` and is built with the small builder API
in `src/world.js` (`box`, `platform`, `stairs`, `house`, `container`, `rock`, `tree`, `decor`, … and `both()`
for the mirrored half). Its `theme` sets sky, sun, fog, floor, wall materials, particles and distant backdrop.

## Modes

- **Tutorial**: 10 guided steps in the practice range (look, move, jump, crouch, shoot, reload, aim, buy,
  sprint/slide, gadget, headshot). +500 XP the first time.
- **Practice Range**: targets at 10–50 m (static, crouched, strafing) in the west spawn corridor, live accuracy /
  headshot % / time-to-kill, free weapons and gadgets (B), gadgets refill.
- **Uplink** (default): non-stop, with respawns (3.5 s) and spawn protection. One Rift Node is live at a time
  at North, Core or South (on the centre line, equally far from both spawns) and moves every 60 s. Stand in its
  ring with no enemies to swing it to your team; while you own it you score a point per second. First to 150,
  or the higher score after 8 minutes.
- **Team Deathmatch**: 5-minute respawn match, free loadout (B), first team to 8 kills per player wins.

Squads are 2v2, 4v4 or 6v6; empty slots are filled with bots.

**Quick Play** starts a short 3v3 Uplink (first to 75, 5 minutes) on a random map; brand-new players get a
welcome card that drops them straight into one against Super Easy bots, with one-time tips during the match
(movement, sprint/slide, the node, gadgets, loadout). Kills show medals (First Blood, Headshot, Long Shot,
Double/Triple Kill, Revenge, Killing Spree, Node Defender); dying shows a "killed by" card while the camera
turns to your killer; hit enemies flash red and stagger.

## Progression & settings

- XP for kills, headshots, assists, node captures, wins and three daily challenges; levels unlock weapon
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

## Operatives

No ability kits: every operative has one passive perk, and everyone buys gadgets (two slots, Q and E).

| Operative | Role | Perk |
|---|---|---|
| VOLT | Assault | Adrenaline – each kill restores 25 HP, moves 5% faster |
| HAZE | Tactician | Quartermaster – gadgets cost half |
| AEGIS | Support | Field Medic – regenerates to 60 HP after 4 s without damage |
| HAWK | Recon | Keen Ears – enemies firing within 30 m show on the team minimap |

Gadgets (kept if you survive the round): Smoke Canister, Flashbang, Frag Grenade, Gas Grenade,
Sonar Puck (pings enemies within 14 m through walls), Med-Kit, Deploy Cover (bullet-proof wall).

## Code map

- `src/config.js` – all balance numbers: weapons, armor, economy, operatives, bot difficulty
- `src/world.js` – map loader + builder API, rendering, sky/lighting/backdrop, spatial grid, raycasts, smoke line-of-sight, height-aware nav grid + A*
- `src/maps/*.js` – the five map layouts, sites, routes and themes
- `src/textures.js` – procedural concrete/plaster/stone/wood/metal/roof/plank/paver/burlap textures, decals
- `src/props.js` – visual detail for map props (house roofs/frames/lamps, vehicles, trees, sandbags, fences, stall, plaza, power lines), merged per material
- `src/guns.js` – weapon models (first-person with hands, third-person for rigs)
- `src/characters.js` – articulated soldier rigs: per-operative gear, procedural walk/run/strafe, aim, arm IK, flinch, reload, verlet ragdolls, helmet/gun drops
- `src/audio.js` – 3D audio engine, reverb, occlusion, synthesised sounds, optional recordings
- `src/fx.js` – tracers, impacts, bullet holes, muzzle flashes
- `src/entities.js` – fighters: mesh, movement/collision, shooting, damage
- `src/abilities.js` – gadgets (buying slots, throwing, effects), perks' regen, projectiles, smokes/gas/barriers
- `src/uplink.js` – Uplink mode: Rift Node placement, capture/hold, visuals, bot goals, net sync
- `src/bot.js` – bot AI (vision, reaction time, aim error, strafing, lanes, hunting, gadget use, sprinting)
- `src/tactics.js` – (legacy round modes, not in the menus) team strategy, callouts, hold spots, corner checks
- `src/objective.js` – (legacy, not in the menus) plant sites, the Rift Charge (carry/drop/plant/defuse/detonate), zone names
- `src/shop.js` – buy logic for player and bots
- `src/settings.js` – settings storage, crosshair drawing, settings screen with key rebinding
- `src/progress.js` – XP/levels, daily challenges, skin unlocks + equipped skins
- `src/skins.js` – weapon skin catalogue and procedural patterns
- `src/game.js` – match/round flow, TDM/range/tutorial, input, camera, HUD, minimap, loadout screen, main loop

## Multiplayer later

All game state lives in `game` (`src/state.js`) and every fighter goes through the same
`moveFighter` / `tryFire` / `useAbility` functions whether it is the player or a bot, so a
networked player can replace a `BotBrain` without touching the combat code.

## Originality

Riftline is an original game: its own name, operatives and perks, gadgets, Uplink mode, weapons, maps, colour palette
(blue vs orange on graphite) and procedural art and audio. It borrows only general genre conventions
(respawn matches, grenades, a capture point) that are shared by many shooters,
and it uses no names, logos, artwork, sounds or text from any other game.
