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

## Agents

| Agent | Role | Q | E | X (ultimate, 5 points) |
|---|---|---|---|---|
| VOLT | Duelist | Surge Dash | Flashpoint (flash) | Overcharge |
| HAZE | Controller | Veil (smoke) | Toxin Orb | Blackout |
| AEGIS | Sentinel | Bulwark (barrier) | Mend (heal) | Bastion |
| HAWK | Initiator | Recon Bolt | Shock Dart | Hunter's Fury |

## Code map

- `src/config.js` – all balance numbers: weapons, armor, economy, agents, bot difficulty
- `src/world.js` – map layout (boxes), rendering, raycasts, smoke line-of-sight, nav grid + A*
- `src/entities.js` – fighters: mesh, movement/collision, shooting, damage
- `src/abilities.js` – ability implementations, projectiles, smokes/pools/barriers
- `src/bot.js` – bot AI (vision, reaction time, aim error, strafing, lanes, hunting, ability use)
- `src/shop.js` – buy logic for player and bots
- `src/game.js` – match/round flow, input, camera, HUD, minimap, main loop

## Multiplayer later

All game state lives in `game` (`src/state.js`) and every fighter goes through the same
`moveFighter` / `tryFire` / `useAbility` functions whether it is the player or a bot, so a
networked player can replace a `BotBrain` without touching the combat code.
