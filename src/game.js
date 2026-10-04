import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { game, now, sideSign } from './state.js';
import { WEAPONS, ARMOR, AGENTS, ECON, MATCH, MOVE, BOT_NAMES } from './config.js';
import { buildWorld, raycastWorld, drawMapBoxes, smokes, BOUNDS, hasLOS, surfaceUnder, updateWorldFx, setSpawnColors, SITE_RECTS } from './world.js';
import { resetCharge, hideCharge, updateCharge, tickAction, canPlant, canDefuse, siteAt } from './objective.js';
import { planTactics, updateTactics, onChargeEvent } from './tactics.js';
import {
  Fighter, TEAM_COLORS, EYE, updateFighterMesh, moveFighter, separateFighters, tryFire, startReload,
  updateWeapon, switchWeapon, setGunLook, emitSound, resetFighterMesh,
} from './entities.js';
import { updateRagdolls, clearRagdolls } from './characters.js';
import { BotBrain } from './bot.js';
import { useAbility, abilityReady, updateAbilities, updateAbilityState, clearAbilities, fireFury } from './abilities.js';
import { buy, botBuy } from './shop.js';
import { updateFx, clearFx, smokePuff } from './fx.js';
import { initAudio, sfx, setMuted, isMuted, updateListener } from './audio.js';
import { buildGun, casingGeo, casingMat } from './guns.js';
import { flashTexture } from './textures.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('riftline.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('riftline.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------------------
// Renderer / scenes
// ---------------------------------------------------------------------------
const QUALITY = store.get('quality', 'medium'); // low | medium | high
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY === 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY === 'low' ? 1 : QUALITY === 'medium' ? 1.5 : 2));
renderer.shadowMap.enabled = QUALITY !== 'low';
renderer.shadowMap.type = QUALITY === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
game.scene = scene; game.camera = camera;
buildWorld(scene, renderer, QUALITY);

// muzzle lights: one for your gun, one reused for the latest enemy/ally shot
const playerLight = new THREE.PointLight(0xffb060, 0, 9, 2);
const otherLight = new THREE.PointLight(0xffb060, 0, 9, 2);
scene.add(playerLight, otherLight);

// post-processing: AO (high), bloom, colour grade + vignette + grain
let composer = null, gradePass = null;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float damage; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, 1.08);                                  // slight saturation
      c = c * vec3(1.02, 1.0, 0.97) + vec3(-0.008, 0.0, 0.012) * (1.0 - l); // warm highs, cool shadows
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.55;                                // vignette
      c += (h(vUv * 1000.0 + time) - 0.5) * 0.025;                // film grain
      c = mix(c, c * vec3(1.25, 0.55, 0.55), damage);             // hurt tint
      gl_FragColor = vec4(c, 1.0);
    }`,
};
if (QUALITY !== 'low') {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (QUALITY === 'high') {
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.blendIntensity = 0.85;
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1 });
    composer.addPass(ao);
  }
  // high threshold: only muzzle flashes, sparks and ability glows bloom — never the sky
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 1.05));
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
}

const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
vmScene.environment = scene.environment;
vmScene.environmentIntensity = 0.7;
vmScene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3228, 0.6));
const vmLight = new THREE.DirectionalLight(0xfff0dd, 1.6); vmLight.position.set(0.6, 1.5, 0.4); vmScene.add(vmLight);
// cool rim light from ahead-left outlines the gun against bright backgrounds
const vmRim = new THREE.DirectionalLight(0xbcd6ff, 1.4); vmRim.position.set(-0.8, 0.7, -1.4); vmScene.add(vmRim);
const vmFlashLight = new THREE.PointLight(0xffaa55, 0, 1.5, 2); vmScene.add(vmFlashLight);
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);
const vmHolder = new THREE.Group(); vmRoot.add(vmHolder);
const vmCache = {};
let vmGun = null;
const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const muzzleFlash = new THREE.Group();
for (const [rx, ry] of [[0, 0], [0, Math.PI / 2], [Math.PI / 2, 0]]) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.16, rx ? 0.16 : 0.3), flashMat);
  p.rotation.set(rx, ry, 0);
  if (!rx) p.position.z = -0.06;
  muzzleFlash.add(p);
}
muzzleFlash.visible = false;
const casings = [];

function resize() {
  // a hidden or minimised tab can report 0×0, which would leave zero-size render targets
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
  camera.aspect = vmCam.aspect = w / h;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function setViewModel(f) {
  const key = f.weaponKey();
  const ck = key + f.team;
  if (!vmCache[ck]) vmCache[ck] = buildGun(key, TEAM_COLORS[f.team]);
  if (vmGun === vmCache[ck]) return;
  if (vmGun) vmHolder.remove(vmGun);
  vmGun = vmCache[ck];
  vmHolder.add(vmGun);
  vmGun.add(muzzleFlash);
  muzzleFlash.position.copy(vmGun.userData.tip);
  drawT = 1; // weapon raise animation
}
let drawT = 0;

function ejectCasing() {
  const u = vmGun?.userData;
  if (!u?.eject) return;
  const m = new THREE.Mesh(casingGeo, casingMat);
  m.position.copy(u.eject);
  vmGun.localToWorld(m.position);
  m.rotation.set(Math.random() * 3, 0, Math.PI / 2);
  vmScene.add(m);
  casings.push({ m, v: new THREE.Vector3(1.2 + Math.random() * 0.6, 1 + Math.random() * 0.5, 0.3), t: 0 });
}

function updateCasings(dt) {
  for (let i = casings.length - 1; i >= 0; i--) {
    const c = casings[i];
    c.t += dt;
    c.v.y -= 9 * dt;
    c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += dt * 20; c.m.rotation.y += dt * 13;
    if (c.t > 0.5) {
      vmScene.remove(c.m); casings.splice(i, 1);
      if (Math.random() < 0.5) sfx('shell', { vol: 0.6 });
    }
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
const mouse = { left: false, leftPressed: false, right: false };
let sens = store.get('sens', 1);
let swayX = 0, swayY = 0;
let buyOpen = false;

const locked = () => document.pointerLockElement === canvas;
function lock() { try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); p?.catch?.(() => canvas.requestPointerLock()); } catch { canvas.requestPointerLock(); } }

document.addEventListener('pointerlockchange', () => {
  if (locked()) { setPaused(false); return; }
  if (['buy', 'live', 'end'].includes(game.phase) && !buyOpen) setPaused(true);
});
document.addEventListener('pointerlockerror', () => { if (['buy', 'live', 'end'].includes(game.phase)) setPaused(true); });

addEventListener('mousemove', (e) => {
  if (!locked() || game.paused) return;
  const p = game.player;
  const s = sens * 0.0022 * (p?.scoped ? 0.45 : 1);
  if (!p) return;
  const mx = Math.max(-200, Math.min(200, e.movementX)), my = Math.max(-200, Math.min(200, e.movementY));
  if (game.spectating) return;
  p.yaw -= mx * s;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - my * s));
  swayX += mx * 0.00008; swayY += my * 0.00008;
});
canvas.addEventListener('mousedown', (e) => {
  if (!locked()) return;
  if (e.button === 0) { mouse.left = true; mouse.leftPressed = true; }
  if (e.button === 2) { mouse.right = true; onRightClick(); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (!game.player || game.phase === 'menu' || game.phase === 'over') return;
  const p = game.player;
  if (e.code === 'KeyB') { toggleBuy(); return; }
  if (buyOpen) {
    const it = BUY_LIST.find((b) => b.hot === e.key);
    if (it) doBuy(it.key);
    if (e.code === 'Escape') toggleBuy(false);
    return;
  }
  if (game.paused || !p.alive) {
    if (e.code === 'Space' && game.spectating) cycleSpectate();
    return;
  }
  switch (e.code) {
    case 'KeyR': startReload(p); break;
    case 'Digit1': switchWeapon(p, 'primary'); break;
    case 'Digit2': switchWeapon(p, 'secondary'); break;
    case 'KeyQ': playerAbility('q'); break;
    case 'KeyE': playerAbility('e'); break;
    case 'KeyX': playerAbility('x'); break;
    case 'KeyM': setMuted(!isMuted()); break;
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.left = false; });

function onRightClick() {
  const p = game.player;
  if (!p || !p.alive || game.spectating) return;
  const w = p.weapon();
  if (w.scope && p.reloadT <= 0) p.scoped = !p.scoped;
}

function playerAbility(slot) {
  const p = game.player;
  if (useAbility(p, slot)) {
    if (slot === 'x') flashMsg(p.agent[slot].name.toUpperCase(), 'Ultimate activated', 1.4);
  } else if (game.phase === 'live' && !abilityReady(p, slot)) sfx('empty');
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
let choice = { agent: store.get('agent', 'volt'), teamSize: store.get('teamSize', 5), difficulty: store.get('difficulty', 'normal'), mode: store.get('mode', 'plant') };

function renderMenu() {
  const wrap = $('agentCards');
  wrap.innerHTML = '';
  for (const a of Object.values(AGENTS)) {
    const b = document.createElement('button');
    b.className = 'card' + (choice.agent === a.key ? ' on' : '');
    b.style.setProperty('--acc', a.color);
    b.innerHTML = `<div class="face">${a.name}</div><div class="role">${a.role.toUpperCase()}</div>
      <div class="blurb">${a.blurb}</div>
      <ul>${['q', 'e', 'x'].map((s) => `<li><kbd>${s.toUpperCase()}</kbd> <b>${a[s].name}</b> — ${a[s].desc}</li>`).join('')}</ul>`;
    b.onclick = () => { choice.agent = a.key; store.set('agent', a.key); renderMenu(); };
    wrap.appendChild(b);
  }
  for (const [id, prop, parse] of [['segSize', 'teamSize', Number], ['segDiff', 'difficulty', String], ['segMode', 'mode', String]]) {
    for (const btn of $(id).querySelectorAll('button')) {
      btn.classList.toggle('on', parse(btn.dataset.v) === choice[prop]);
      btn.onclick = () => { choice[prop] = parse(btn.dataset.v); store.set(prop, choice[prop]); renderMenu(); };
    }
  }
}
for (const btn of $('segQuality').querySelectorAll('button')) {
  btn.classList.toggle('on', btn.dataset.v === QUALITY);
  btn.onclick = () => { if (btn.dataset.v !== QUALITY) { store.set('quality', btn.dataset.v); location.reload(); } };
}
$('sens').value = sens; $('sensVal').textContent = sens.toFixed(2);
$('sens').oninput = (e) => { sens = +e.target.value; $('sensVal').textContent = sens.toFixed(2); store.set('sens', sens); };
$('touchWarn').hidden = !matchMedia('(pointer: coarse)').matches;
$('lockIn').onclick = () => { initAudio(); startMatch({ ...choice }); lock(); };
$('resume').onclick = () => { initAudio(); lock(); };
$('quit').onclick = () => toMenu();
$('again').onclick = () => { startMatch(game.config); lock(); };
$('toMenu').onclick = () => toMenu();
renderMenu();

function toMenu() {
  teardown();
  game.phase = 'menu';
  for (const id of ['hud', 'pause', 'over', 'buyMenu', 'scoreboard']) $(id).hidden = true;
  $('menu').hidden = false;
  if (locked()) document.exitPointerLock();
  renderMenu();
}

function setPaused(p) {
  if (game.phase === 'menu' || game.phase === 'over') p = false;
  game.paused = p;
  $('pause').hidden = !p;
  if (p) { mouse.left = false; for (const k in keys) keys[k] = false; }
}

// ---------------------------------------------------------------------------
// Match / rounds
// ---------------------------------------------------------------------------
function teardown() {
  hideCharge();
  game.tac = null;
  clearAbilities();
  clearRagdolls(scene);
  for (const f of game.fighters) scene.remove(f.mesh);
  game.fighters = []; game.player = null;
}

function startMatch(cfg) {
  teardown();
  setPaused(false);
  game.config = cfg;
  game.config.mode ??= 'plant';
  game.time = 0; game.round = 0; game.score = [0, 0]; game.lossStreak = [0, 0];
  game.attackers = Math.random() < 0.5 ? 0 : 1;
  game.noises = [];
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const agentKeys = Object.keys(AGENTS);
  let id = 0;
  for (let team = 0; team < 2; team++) {
    const used = team === 0 ? [cfg.agent] : [];
    for (let i = 0; i < cfg.teamSize; i++) {
      const isPlayer = team === 0 && i === 0;
      let agent = isPlayer ? cfg.agent : null;
      if (!agent) {
        const free = agentKeys.filter((k) => !used.includes(k));
        agent = (free.length ? free : agentKeys)[Math.floor(Math.random() * (free.length || agentKeys.length))];
        used.push(agent);
      }
      const f = new Fighter({ id: id++, name: isPlayer ? 'You' : names.pop(), team, agent, isPlayer });
      if (!isPlayer) new BotBrain(f, cfg.difficulty);
      scene.add(f.mesh);
      game.fighters.push(f);
      if (isPlayer) game.player = f;
    }
  }
  $('menu').hidden = true; $('over').hidden = true; $('hud').hidden = false;
  $('killfeed').innerHTML = '';
  $('comms').innerHTML = '';
  setupAbilityHud();
  buildPips();
  startRound();
}

function spawnPoint(team, i) {
  const s = sideSign(team);
  return new THREE.Vector3(s * (35.5 + (i % 2) * 2), 0, -6 + i * 3);
}

function startRound() {
  game.round++;
  const plantMode = game.config.mode === 'plant';
  const halftime = plantMode && game.round === MATCH.halfRounds + 1;
  if (halftime) game.attackers = 1 - game.attackers;
  game.phase = 'buy';
  game.phaseT = MATCH.buyTime;
  game.spectating = false;
  game.noises = [];
  clearAbilities();
  clearFx();
  clearRagdolls(scene);
  for (const f of game.fighters) resetFighterMesh(f);
  const counts = [0, 0];
  for (const f of game.fighters) {
    if (!f.alive || game.round === 1 || halftime) {
      f.primary = null; f.secondary = 'p9'; f.armor = 0;
      f.ammo = { p9: WEAPONS.p9.mag };
    }
    if (game.round === 1 || halftime) { f.credits = ECON.start; if (game.round === 1) f.ult = 0; }
    else f.ult = Math.min(MATCH.ultCost, f.ult + 1);
    f.alive = true; f.hp = 100;
    for (const k of [f.primary, f.secondary]) if (k) f.ammo[k] = WEAPONS[k].mag;
    f.cur = f.primary ? 'primary' : 'secondary';
    f.reloadT = 0; f.fireCD = 0; f.bloom = 0; f.recoil = 0; f.recoilYaw = 0; f.scoped = false;
    f.pos.copy(spawnPoint(f.team, counts[f.team]++));
    f.vel.set(0, 0, 0);
    f.yaw = sideSign(f.team) < 0 ? -Math.PI / 2 : Math.PI / 2; f.pitch = 0;
    f.wantCrouch = false; f.crouch = 0;
    f.blindUntil = f.revealedUntil = f.spottedUntil = f.overchargeUntil = f.slowUntil = f.furyUntil = f.nearsightUntil = 0;
    f.furyShots = 0; f.healLeft = 0; f.dashT = 0;
    f.bought = []; f.damagedBy.clear();
    f.resetAbilities();
    f.deathT = 0;
    setGunLook(f);
    if (f.brain) { f.brain.planRound(); botBuy(f); setGunLook(f); }
  }
  // west spawn zone shows the colour of whoever spawns there
  setSpawnColors(TEAM_COLORS[sideSign(0) < 0 ? 0 : 1], TEAM_COLORS[sideSign(0) < 0 ? 1 : 0]);
  if (plantMode) {
    resetCharge();
    planTactics();
    const attacking = game.player.team === game.attackers;
    const role = attacking ? 'ATTACK — plant the Rift Charge on A or B' : 'DEFEND — stop the plant or defuse it';
    flashMsg(halftime ? 'SWITCHING SIDES' : `ROUND ${game.round}`, `${role} · press B to buy`, 3.5);
  } else {
    hideCharge();
    flashMsg(`ROUND ${game.round}`, 'BUY PHASE — press B to open the armory', 3);
  }
  sfx('round');
}

function aliveCount(team) { return game.fighters.filter((f) => f.team === team && f.alive).length; }

function endRound(winner, reason) {
  game.phase = 'end';
  game.phaseT = MATCH.endTime;
  game.score[winner]++;
  const loser = 1 - winner;
  for (const f of game.fighters) {
    if (f.team === winner) f.credits += ECON.win;
    else f.credits += Math.min(ECON.lossMax, ECON.loss + ECON.lossStreak * game.lossStreak[loser]);
    f.credits = Math.min(ECON.max, f.credits);
  }
  game.lossStreak[loser]++; game.lossStreak[winner] = 0;
  const won = winner === game.player.team;
  flashMsg(won ? 'ROUND WON' : 'ROUND LOST', reason, MATCH.endTime, won ? 'win' : 'lose');
  sfx(won ? 'round' : 'lose');
  if (buyOpen) toggleBuy(false);
}

function matchOver() {
  game.phase = 'over';
  const won = game.score[game.player.team] >= MATCH.roundsToWin;
  $('overTitle').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('overTitle').className = won ? 'win' : 'lose';
  $('overScore').textContent = `${game.score[0]} – ${game.score[1]}`;
  $('overBoard').innerHTML = scoreboardHTML(true);
  $('over').hidden = false; $('hud').hidden = true;
  $('scoreboard').hidden = true;
  if (locked()) document.exitPointerLock();
}

function updatePhase(dt) {
  game.phaseT -= dt;
  if (game.phase === 'buy' && game.phaseT <= 0) {
    game.phase = 'live';
    game.phaseT = MATCH.roundTime;
    game.roundStartTime = game.time;
    if (buyOpen) { toggleBuy(false); }
    flashMsg('FIGHT', '', 1.2);
    sfx('round');
  } else if (game.phase === 'live' && game.config.mode === 'plant') {
    const A = game.attackers, D = 1 - A, c = game.charge;
    const aA = aliveCount(A), aD = aliveCount(D);
    if (c.state === 'planted') game.phaseT = c.timer;
    if (c.state === 'exploded') endRound(A, 'Rift Charge detonated');
    else if (c.state === 'defused') endRound(D, 'Rift Charge defused');
    else if (!aD) endRound(A, 'Defenders eliminated');
    else if (!aA && c.state !== 'planted') endRound(D, 'Attackers eliminated');
    else if (game.phaseT <= 0 && c.state !== 'planted') endRound(D, 'Time expired — no plant');
  } else if (game.phase === 'live') {
    const a0 = aliveCount(0), a1 = aliveCount(1);
    if (!a0 || !a1) endRound(a0 ? 0 : 1, a0 ? 'Enemy team eliminated' : 'Your team was eliminated');
    else if (game.phaseT <= 0) {
      const hp = (t) => game.fighters.filter((f) => f.team === t && f.alive).reduce((s, f) => s + f.hp + f.armor, 0);
      const w = a0 !== a1 ? (a0 > a1 ? 0 : 1) : (hp(0) >= hp(1) ? 0 : 1);
      endRound(w, 'Time expired');
    }
  } else if (game.phase === 'end' && game.phaseT <= 0) {
    if (Math.max(...game.score) >= MATCH.roundsToWin) matchOver();
    else startRound();
  }
}

// ---------------------------------------------------------------------------
// Kill / hit feedback
// ---------------------------------------------------------------------------
game.onKill = (attacker, target, opts) => {
  const el = document.createElement('div');
  const mine = attacker === game.player || target === game.player;
  el.className = 'kf' + (mine ? ' mine' : '');
  const wpn = opts.ability || (opts.weapon ? WEAPONS[opts.weapon].name : '');
  const an = attacker && attacker !== target ? `<span class="t${attacker.team}">${attacker.name}</span>` : '';
  el.innerHTML = `${an}<span class="w">${wpn}${opts.head ? ' ✦' : ''}</span><span class="t${target.team}">${target.name}</span>`;
  $('killfeed').prepend(el);
  setTimeout(() => el.remove(), 6000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  if (attacker === game.player) sfx('kill');
  if (target === game.player) {
    flashMsg('ELIMINATED', attacker ? `by ${attacker.name}` : '', 2.2, 'lose');
    game.specIndex = -1;
    setTimeout(() => { if (!game.player.alive && game.phase !== 'over') { game.spectating = true; cycleSpectate(); } }, 1200);
  }
  if (aliveCount(game.player.team) === 1 && game.player.alive && aliveCount(1 - game.player.team) > 1 && game.phase === 'live') {
    flashMsg('LAST ALIVE', `1 v ${aliveCount(1 - game.player.team)}`, 1.5);
  }
};

// team comms (bot callouts) + objective events
function comms(text, who = null, sys = false) {
  const el = document.createElement('div');
  el.className = 'cm' + (sys ? ' sys' : '');
  el.innerHTML = who ? `<b>${who}</b>${text}` : text;
  $('comms').appendChild(el);
  setTimeout(() => el.remove(), 5000);
  while ($('comms').children.length > 5) $('comms').firstChild.remove();
}
game.onCallout = (bot, text) => comms(text, bot.name);
game.onChargeEvent = (kind, f) => {
  onChargeEvent(kind);
  const mine = game.player.team === game.attackers;
  const c = game.charge;
  if (kind === 'planted') {
    flashMsg('CHARGE PLANTED', `Site ${c.site} · ${mine ? 'defend it' : 'defuse it'} — 45s`, 2.2, mine ? 'win' : 'lose');
    comms(`Rift Charge planted on ${c.site}`, null, true);
  } else if (kind === 'defused') comms(`${f.name} defused the charge`, null, true);
  else if (kind === 'drop' && mine) comms(`Charge dropped by ${f.name}`, null, true);
  else if (kind === 'pickup' && mine) comms(f === game.player ? 'You picked up the charge' : `${f.name} has the charge`, null, true);
};

let hitT = 0;
game.onPlayerHit = (target, dmg, head, killed) => {
  const hm = $('hitmarker');
  hm.classList.add('show'); hm.classList.toggle('kill', killed);
  hitT = 0.12;
  sfx(head ? 'head' : 'hit');
  const n = document.createElement('div');
  n.className = 'dn' + (head ? ' head' : '');
  n.textContent = Math.round(dmg);
  n.style.left = 18 + Math.random() * 20 + 'px';
  $('dmgNums').appendChild(n);
  setTimeout(() => n.remove(), 700);
};

let hurtT = 0;
game.onPlayerDamaged = (attacker) => {
  hurtT = 0.35;
  if (!attacker || attacker === game.player) return;
  // red arc pointing toward whoever hit you
  const p = game.player;
  const yawTo = Math.atan2(-(attacker.pos.x - p.pos.x), -(attacker.pos.z - p.pos.z));
  const el = document.createElement('div');
  el.className = 'hd';
  el.dataset.id = attacker.id;
  el._yaw = yawTo;
  for (const old of $('hitDir').children) if (old.dataset.id === String(attacker.id)) old.remove();
  $('hitDir').appendChild(el);
  setTimeout(() => el.remove(), 1400);
};
let flashEnd = 0, flashDur = 1;
game.onBlind = (dur) => { flashEnd = now() + dur; flashDur = dur; };
game.onBlackout = () => {};

// ---- first-person recoil: damped springs kicked on every shot ----
const rs = { p: new THREE.Vector3(), vp: new THREE.Vector3(), r: new THREE.Vector3(), vr: new THREE.Vector3() };
const SPRING_K = 240, SPRING_W = Math.sqrt(SPRING_K), SPRING_C = 2 * SPRING_W * 0.5; // slightly underdamped: snaps back with a small bounce
let shotT = 9, fovKick = 0, camShake = 0, cylAngle = 0, camFov = 75;
function kickViewModel(w) {
  const v = w.vm, ads = 1 - aimK * 0.55, W = SPRING_W;
  rs.vp.z += v.back * W * ads;
  rs.vp.y += v.up * W * ads;
  rs.vp.x += (Math.random() - 0.5) * v.back * 0.5 * W;
  rs.vr.x += v.pitch * W * ads * (0.85 + Math.random() * 0.3);
  rs.vr.y += (Math.random() - 0.5) * 2 * v.yaw * W;
  rs.vr.z += (Math.random() - 0.5) * 2 * v.roll * W;
  shotT = 0;
  fovKick = Math.max(fovKick, v.shake * 0.45);
  camShake = Math.max(camShake, v.shake);
  if (w.key === 'magnum') cylAngle += Math.PI / 3;
}
function stepSprings(dt) {
  const n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
  for (let i = 0; i < n; i++) {
    for (const [x, v] of [[rs.p, rs.vp], [rs.r, rs.vr]]) {
      v.x += (-SPRING_K * x.x - SPRING_C * v.x) * h; x.x += v.x * h;
      v.y += (-SPRING_K * x.y - SPRING_C * v.y) * h; x.y += v.y * h;
      v.z += (-SPRING_K * x.z - SPRING_C * v.z) * h; x.z += v.z * h;
    }
  }
}
const _muz = new THREE.Vector3();
game.onPlayerShot = (p, w) => {
  kickViewModel(w);
  smokePuff(p.muzzle(_muz), w.slot === 'primary' ? 1 : 0.7);
  muzzleFlash.visible = true;
  muzzleFlash.rotation.z = Math.random() * 3;
  muzzleFlash.scale.setScalar((w.slot === 'primary' ? 1 : 0.7) * (0.8 + Math.random() * 0.4));
  setTimeout(() => (muzzleFlash.visible = false), 35);
  p.muzzle(playerLight.position);
  playerLight.intensity = 9;
  if (vmGun) { vmFlashLight.position.copy(vmGun.userData.tip); vmGun.localToWorld(vmFlashLight.position); vmFlashLight.intensity = 3; }
  // casings: pump and bolt guns eject when the action is worked, revolvers keep theirs
  if (w.pump) setTimeout(() => { sfx('pump'); ejectCasing(); }, 300);
  else if (w.key === 'longbow') setTimeout(ejectCasing, 350);
  else if (w.key !== 'magnum') setTimeout(ejectCasing, 15);
};
game.onAnyShot = (f, muz) => {
  if (f === game.player && !game.spectating) return;
  otherLight.position.copy(muz); otherLight.intensity = 7;
  if (Math.random() < 0.35) smokePuff(muz, 0.8);
};

// ---------------------------------------------------------------------------
// Spectating
// ---------------------------------------------------------------------------
function cycleSpectate() {
  const allies = game.fighters.filter((f) => f.team === game.player.team && f.alive);
  if (!allies.length) { game.specTarget = null; return; }
  game.specIndex = ((game.specIndex ?? -1) + 1) % allies.length;
  game.specTarget = allies[game.specIndex];
}

// ---------------------------------------------------------------------------
// Buy menu
// ---------------------------------------------------------------------------
const BUY_LIST = [
  { key: 'p9', cat: 'secondary', hot: '1' }, { key: 'wasp', cat: 'secondary', hot: '2' }, { key: 'magnum', cat: 'secondary', hot: '3' },
  { key: 'hornet', cat: 'close', hot: '4' }, { key: 'warden', cat: 'close', hot: '5' },
  { key: 'talon', cat: 'rifle', hot: '6' }, { key: 'raptor', cat: 'rifle', hot: '7' }, { key: 'wraith', cat: 'rifle', hot: '8' },
  { key: 'sentry', cat: 'heavy', hot: '9' }, { key: 'hammer', cat: 'heavy', hot: '0' }, { key: 'longbow', cat: 'heavy', hot: '-' },
  { key: 'light', cat: 'armor', hot: 'z' }, { key: 'heavy', cat: 'armor', hot: 'x' },
];

function toggleBuy(force) {
  const open = force ?? !buyOpen;
  if (open && (game.phase !== 'buy' || !game.player.alive)) return;
  buyOpen = open;
  $('buyMenu').hidden = !open;
  if (open) { if (locked()) document.exitPointerLock(); renderBuy(); }
  else if (!locked() && game.phase !== 'over') lock();
}

function doBuy(key) {
  if (buy(game.player, key)) { sfx('buy'); setViewModel(game.player); }
  renderBuy();
}

function renderBuy() {
  const p = game.player;
  $('buyCredits').textContent = `¤ ${p.credits}`;
  for (const box of document.querySelectorAll('#buyMenu .items')) box.innerHTML = '';
  for (const it of BUY_LIST) {
    const isArmor = !!ARMOR[it.key];
    const def = isArmor ? ARMOR[it.key] : WEAPONS[it.key];
    const owned = isArmor ? p.armor >= def.value : p.primary === it.key || p.secondary === it.key;
    const b = document.createElement('button');
    b.className = 'item' + (owned ? ' owned' : '') + (!owned && p.credits < def.cost ? ' poor' : '');
    const mode = def.pellets ? `${def.pellets} pellets` : def.burst ? `${def.burst}-round burst` : def.auto ? 'auto' : 'semi';
    const info = isArmor ? `+${def.value} shield` : `${def.dmg} body · ${def.head} head · ${mode}${def.suppressed ? ' · suppressed' : ''}`;
    b.innerHTML = `<span><span class="k">${it.hot}</span>${def.name}<small>${info}</small></span><span class="c">${def.cost ? '¤ ' + def.cost : 'FREE'}</span>`;
    b.onclick = () => doBuy(it.key);
    document.querySelector(`#buyMenu .items[data-cat="${it.cat}"]`).appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const textCache = new Map();
function setText(id, v) { if (textCache.get(id) !== v) { textCache.set(id, v); $(id).textContent = v; } }

let msgUntil = 0;
function flashMsg(main, sub = '', dur = 2, cls = '') {
  $('msgMain').textContent = main; $('msgMain').className = cls;
  $('msgSub').textContent = sub;
  $('centerMsg').style.opacity = 1;
  msgUntil = now() + dur;
}

function setupAbilityHud() {
  const a = game.player.agent;
  for (const s of ['q', 'e', 'x']) {
    const el = $('ab' + s.toUpperCase());
    el.style.setProperty('--acc', a.color);
    el.querySelector('.nm').textContent = a[s].name;
  }
}

function buildPips() {
  for (const team of [0, 1]) {
    const el = $('pips' + team);
    el.innerHTML = '';
    const list = game.fighters.filter((f) => f.team === team);
    if (team === 1) list.reverse();
    for (const f of list) {
      const p = document.createElement('div');
      p.className = 'pip' + (f.isPlayer ? ' me' : '');
      p.style.borderColor = f.agent.color;
      p.style.color = f.agent.color;
      p.textContent = f.agent.name[0];
      p.title = `${f.name} (${f.agent.name})`;
      f.pipEl = p;
      el.appendChild(p);
    }
  }
}

function scoreboardHTML(final = false) {
  const rows = [];
  for (const team of [0, 1]) {
    const list = game.fighters.filter((f) => f.team === team).sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    for (const f of list) {
      const acs = Math.round(f.damage / Math.max(1, game.round));
      rows.push(`<tr class="t${team}${f.isPlayer ? ' me' : ''}${!f.alive && !final ? ' dead' : ''}">
        <td><span class="agentTag" style="color:${f.agent.color}">${f.agent.name}</span></td><td>${f.name}</td>
        <td class="num">${f.kills}</td><td class="num">${f.deaths}</td><td class="num">${f.assists}</td><td class="num">${acs}</td>
        <td class="num">${team === game.player.team && !final ? '¤ ' + f.credits : ''}</td></tr>`);
    }
  }
  return `<table><tr><th>AGENT</th><th>PLAYER</th><th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">ADR</th><th class="num">CREDITS</th></tr>${rows.join('')}</table>`;
}

const mm = $('minimap'), mg = mm.getContext('2d');
const MM_S = mm.width / (BOUNDS.maxX - BOUNDS.minX + 4);
const toPx = (x, z) => [(x - BOUNDS.minX + 2) * MM_S, (z - BOUNDS.minZ + 2) * MM_S];

function drawMinimap() {
  const t = now(), p = game.player;
  mg.clearRect(0, 0, mm.width, mm.height);
  // spawn tints follow whichever team spawns on each side
  const west = sideSign(p.team) < 0 ? 'rgba(61,139,255,0.14)' : 'rgba(255,70,85,0.14)';
  const east = sideSign(p.team) < 0 ? 'rgba(255,70,85,0.14)' : 'rgba(61,139,255,0.14)';
  mg.fillStyle = west; { const [a, b] = toPx(-40, -30), [c, d] = toPx(-30, 30); mg.fillRect(a, b, c - a, d - b); }
  mg.fillStyle = east; { const [a, b] = toPx(30, -30), [c, d] = toPx(40, 30); mg.fillRect(a, b, c - a, d - b); }
  if (game.config.mode === 'plant') {
    mg.strokeStyle = 'rgba(255,214,63,0.7)'; mg.lineWidth = 1.5; mg.fillStyle = 'rgba(255,214,63,0.85)';
    mg.font = 'bold 13px Rajdhani, sans-serif'; mg.textAlign = 'center';
    SITE_RECTS.forEach(([x0, z0, x1, z1], i) => {
      const [a, b] = toPx(x0, z0), [c, d] = toPx(x1, z1);
      mg.strokeRect(a, b, c - a, d - b);
      mg.fillText(i ? 'B' : 'A', (a + c) / 2, i ? d - 4 : b + 13);
    });
  }
  drawMapBoxes(mg, toPx);
  const c = game.charge;
  if (game.config.mode === 'plant' && c && (c.state === 'planted' || c.state === 'dropped') && (p.team === game.attackers || c.state === 'planted')) {
    const [x, y] = toPx(c.pos.x, c.pos.z);
    mg.fillStyle = c.state === 'planted' && Math.floor(t * 4) % 2 ? '#ffffff' : '#ff4655';
    mg.beginPath(); mg.moveTo(x, y - 6); mg.lineTo(x + 5, y + 4); mg.lineTo(x - 5, y + 4); mg.closePath(); mg.fill();
  }
  for (const s of smokes) {
    const [x, y] = toPx(s.pos.x, s.pos.z);
    mg.fillStyle = 'rgba(177,140,255,0.55)';
    mg.beginPath(); mg.arc(x, y, s.r * s.grow * MM_S, 0, Math.PI * 2); mg.fill();
  }
  for (const f of game.fighters) {
    const ally = f.team === p.team;
    if (!ally && !(t < f.spottedUntil && f.alive)) continue;
    const [x, y] = toPx(f.pos.x, f.pos.z);
    if (!f.alive) {
      if (!ally) continue;
      mg.strokeStyle = 'rgba(255,255,255,0.5)'; mg.lineWidth = 1.5;
      mg.beginPath(); mg.moveTo(x - 3, y - 3); mg.lineTo(x + 3, y + 3); mg.moveTo(x + 3, y - 3); mg.lineTo(x - 3, y + 3); mg.stroke();
      continue;
    }
    if (f.isPlayer) {
      mg.fillStyle = 'rgba(255,255,255,0.15)';
      mg.beginPath(); mg.moveTo(x, y);
      mg.arc(x, y, 34, -f.yaw - Math.PI / 2 - 0.6, -f.yaw - Math.PI / 2 + 0.6); mg.closePath(); mg.fill();
    }
    mg.fillStyle = f.isPlayer ? '#ffffff' : ally ? '#3d8bff' : '#ff4655';
    mg.beginPath(); mg.arc(x, y, f.isPlayer ? 4.5 : 4, 0, Math.PI * 2); mg.fill();
    mg.strokeStyle = f.agent.color; mg.lineWidth = 1.5; mg.stroke();
  }
}

function updateHud(dt) {
  const p = game.player, t = now();
  const viewF = game.spectating && game.specTarget ? game.specTarget : p;
  // top bar
  const tl = Math.max(0, Math.ceil(game.phaseT));
  const planted = game.charge?.state === 'planted';
  setText('timer', game.phase === 'end' ? '—' : `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);
  $('timer').classList.toggle('low', game.phase === 'live' && tl <= 10 && !planted);
  $('timer').classList.toggle('charge', planted && game.phase === 'live');
  const plantMode = game.config.mode === 'plant';
  const sideTxt = plantMode ? (p.team === game.attackers ? ' · ATTACK' : ' · DEFEND') : '';
  setText('roundLabel', planted && game.phase === 'live' ? `CHARGE ON ${game.charge.site}` : game.phase === 'buy' ? 'BUY PHASE' + sideTxt : `ROUND ${game.round}${sideTxt}`);
  for (const f of game.fighters) f.pipEl?.classList.toggle('carrier', plantMode && game.charge?.carrier === f && f.team === p.team);

  // plant / defuse prompt + progress
  let prompt = '';
  if (plantMode && p.alive && game.phase === 'live') {
    if (canPlant(p)) prompt = 'Hold <kbd>F</kbd> to plant';
    else if (canDefuse(p)) prompt = `Hold <kbd>F</kbd> to defuse${game.charge.half ? ' (half saved)' : ''}`;
    else if (game.charge?.carrier === p) prompt = 'You carry the Rift Charge — get to A or B';
  }
  $('prompt').hidden = !prompt || actionProgress >= 0;
  if (textCache.get('prompt') !== prompt) { textCache.set('prompt', prompt); $('prompt').innerHTML = prompt; }
  $('actionBar').hidden = actionProgress < 0;
  if (actionProgress >= 0) {
    $('actionBar').classList.toggle('defuse', planted);
    $('actionBar').firstChild.style.width = `${Math.min(100, actionProgress * 100)}%`;
  }
  setText('score0', String(game.score[0])); setText('score1', String(game.score[1]));
  for (const f of game.fighters) f.pipEl?.classList.toggle('dead', !f.alive);

  // vitals
  setText('hpVal', String(Math.ceil(viewF.hp)));
  $('hpVal').classList.toggle('low', viewF.hp <= 30);
  setText('armorVal', String(Math.ceil(viewF.armor)));
  const w = viewF.weapon();
  setText('ammoMag', viewF.reloadT > 0 ? '··' : String(viewF.ammo[w.key] ?? 0));
  setText('ammoMax', `/${w.mag}`);
  $('ammo').classList.toggle('reload', viewF.reloadT > 0);
  setText('weaponName', w.name.toUpperCase());
  setText('credits', `¤ ${p.credits}`);

  // abilities
  for (const s of ['q', 'e']) {
    const el = $('ab' + s.toUpperCase()), a = p.abil[s], def = p.agent[s];
    el.querySelector('.ch').textContent = a.charges;
    el.classList.toggle('empty', a.charges <= 0);
    el.querySelector('.cd').style.height = def.cooldown > 0 && a.cd > 0 ? `${(a.cd / def.cooldown) * 100}%` : '0';
  }
  const ux = $('abX');
  ux.querySelector('.ch').textContent = `${p.ult}/${MATCH.ultCost}`;
  ux.classList.toggle('ready', p.ult >= MATCH.ultCost);
  ux.classList.toggle('empty', p.ult < MATCH.ultCost);

  const buffs = [];
  if (t < p.overchargeUntil) buffs.push(`<div class="buff" style="color:#ffd23f">OVERCHARGE ${Math.ceil(p.overchargeUntil - t)}</div>`);
  if (p.furyShots > 0) buffs.push(`<div class="buff" style="color:#7dff6b">FURY ×${p.furyShots} — click to fire</div>`);
  if (p.healLeft > 0) buffs.push(`<div class="buff" style="color:#3ee6d6">MENDING</div>`);
  if (t < p.slowUntil) buffs.push(`<div class="buff" style="color:#8cff4a">SLOWED</div>`);
  const bh = buffs.join('');
  if (textCache.get('buffs') !== bh) { textCache.set('buffs', bh); $('buffs').innerHTML = bh; }

  // spectate label
  const spec = game.spectating && game.specTarget;
  $('specLabel').hidden = !spec;
  if (spec) setText('specLabel', `SPECTATING ${game.specTarget.name} (${game.specTarget.agent.name}) · Space to switch`);

  // overlays
  $('centerMsg').style.opacity = t < msgUntil ? 1 : 0;
  $('flash').style.opacity = p.alive && t < flashEnd ? Math.min(1, (flashEnd - t) / Math.min(0.6, flashDur)) : 0;
  $('blackout').style.opacity = p.alive && t < (p.nearsightUntil || 0) ? Math.min(1, (p.nearsightUntil - t) / 0.5) : 0;
  hurtT = Math.max(0, hurtT - dt);
  $('vignette').style.opacity = Math.max(hurtT / 0.35, p.alive && p.hp < 30 ? 0.35 : 0);
  hitT -= dt; if (hitT <= 0) $('hitmarker').classList.remove('show');
  const scoped = p.alive && !game.spectating && p.scoped;
  $('scope').style.opacity = scoped ? 1 : 0;
  $('crosshair').style.opacity = scoped || game.spectating ? 0 : 1;

  // crosshair gap follows spread
  if (p.alive && !game.spectating) {
    const gap = 3 + Math.min(30, (p.weapon().spread + p.bloom + (Math.hypot(p.vel.x, p.vel.z) > 1.2 ? p.weapon().move * 0.5 : 0)) * 260);
    const ch = $('crosshair').children;
    ch[0].style.top = -(gap + 6) + 'px'; ch[1].style.top = gap + 'px';
    ch[2].style.left = -(gap + 6) + 'px'; ch[3].style.left = gap + 'px';
  }

  // buy timer
  if (buyOpen) setText('buyTimer', `${Math.ceil(game.phaseT)}s left`);

  const showBoard = keys.Tab && game.phase !== 'over';
  $('scoreboard').hidden = !showBoard;
  if (showBoard) $('scoreboard').innerHTML = scoreboardHTML();

  for (const el of $('hitDir').children) {
    const rel = Math.atan2(Math.sin(el._yaw - p.yaw), Math.cos(el._yaw - p.yaw));
    el.style.transform = `rotate(${-rel}rad)`;
  }
  drawMinimap();
}

// ---------------------------------------------------------------------------
// Player update
// ---------------------------------------------------------------------------
const _f = new THREE.Vector3(), _r = new THREE.Vector3();
let stepT = 0, wasAirborne = false, airVel = 0, actionProgress = -1;

function updatePlayer(dt) {
  const p = game.player;
  if (!p.alive) return;
  let fx = 0, fz = 0;
  if (!buyOpen) {
    const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    fx = -sy * fwd + cy * side; fz = -cy * fwd - sy * side;
    const l = Math.hypot(fx, fz); if (l > 0) { fx /= l; fz /= l; }
  }
  p.wish = { x: fx, z: fz };
  const walking = keys.ShiftLeft || keys.ShiftRight;
  p.wantCrouch = !!keys.KeyC && !buyOpen;
  const speed = (p.crouch > 0.5 ? MOVE.crouch : walking ? MOVE.walk : MOVE.run) * p.speedMul * (aimK > 0.5 ? 0.8 : 1);
  if (!p.onGround) airVel = Math.min(airVel, p.vel.y);
  moveFighter(p, fx, fz, speed, keys.Space && !buyOpen, dt);
  if (p.onGround && wasAirborne && airVel < -3) { sfx('land', { vol: Math.min(1, -airVel / 8) }); landT = Math.min(1, -airVel / 9); }
  wasAirborne = !p.onGround;
  if (p.onGround) airVel = 0;

  const hs = Math.hypot(p.vel.x, p.vel.z);
  if (p.onGround && hs > 4.5) {
    stepT -= dt * hs;
    if (stepT <= 0) { stepT = 2.4; sfx('step', { vol: 0.45, surface: surfaceUnder(p.pos) }); }
  }

  // hold F to plant / defuse (must stand still)
  actionProgress = keys.KeyF && !buyOpen && game.config.mode === 'plant' ? tickAction(p, dt) : -1;

  if (!buyOpen && locked() && actionProgress < 0) {
    const w = p.weapon();
    if (p.furyShots > 0) { if (mouse.leftPressed) fireFury(p); }
    else if (w.auto ? mouse.left : mouse.leftPressed) tryFire(p);
  }
  mouse.leftPressed = false;
  if (p.scoped && !p.weapon().scope) p.scoped = false;
}

function noiseFootsteps(dt) {
  for (const f of game.fighters) {
    if (f.isPlayer || !f.alive || !f.onGround) continue;
    const hs = Math.hypot(f.vel.x, f.vel.z);
    if (hs < 4.5) continue;
    f.stepT = (f.stepT ?? Math.random() * 2) - dt * hs;
    if (f.stepT <= 0) { f.stepT = 2.4; emitSound(f, 'step', f.team === game.player.team ? 0.5 : 1.3, surfaceUnder(f.pos)); }
  }
}

function playerVision() {
  const p = game.player, t = now();
  if (!p.alive || t < p.blindUntil) return;
  const eye = p.eye(_f);
  for (const e of game.fighters) {
    if (e.team === p.team || !e.alive) continue;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
    const yawTo = Math.atan2(-dx, -dz);
    if (Math.abs(Math.atan2(Math.sin(yawTo - p.yaw), Math.cos(yawTo - p.yaw))) > 0.9) continue;
    if (hasLOS(eye, _r.set(e.pos.x, e.pos.y + 1.4, e.pos.z))) e.spottedUntil = Math.max(e.spottedUntil, t + 0.3);
  }
}

// ---------------------------------------------------------------------------
// Camera + first-person weapon animation
// ---------------------------------------------------------------------------
let forceAim = false; // test hook
let bob = 0, aimK = 0, landT = 0, lastReloadStage = -1;
const _fwd = new THREE.Vector3();

// hip and aim-down-sights poses per weapon slot
const POSE = {
  primary: { hip: [0.19, -0.215, -0.4], rot: 0.02 },
  secondary: { hip: [0.12, -0.135, -0.34], rot: 0.05 },
};

function reloadSounds(p, k) {
  // k: 0..1 progress — mag out at 20%, mag in at 60%, bolt/slide at 85%
  const stage = k < 0.2 ? 0 : k < 0.6 ? 1 : k < 0.85 ? 2 : 3;
  if (stage === lastReloadStage) return;
  lastReloadStage = stage;
  if (stage === 1) sfx('magout');
  if (stage === 2) sfx('magin');
  if (stage === 3) sfx('bolt');
}

function updateCamera(dt) {
  const p = game.player;
  let fov = 75;
  const w = p.weapon();
  const wantAim = (mouse.right && locked() || forceAim) && p.alive && !w.scope && p.reloadT <= 0 && !game.spectating;
  aimK += ((wantAim ? 1 : 0) - aimK) * Math.min(1, dt * 14);
  landT = Math.max(0, landT - dt * 4);
  if (!game.spectating) {
    p.eye(camera.position);
    const hs = Math.hypot(p.vel.x, p.vel.z);
    bob += hs * dt * 1.6;
    if (p.onGround && hs > 1) camera.position.y += Math.sin(bob * 2) * 0.022 * (1 - aimK * 0.7);
    camera.position.y -= landT * 0.12;
    // shake on every shot (decays fast), scaled per gun
    camShake *= Math.exp(-16 * dt);
    const shake = camShake * 0.0035 * (1 - aimK * 0.5);
    camera.rotation.set(p.pitch + p.recoil + (Math.random() - 0.5) * shake, p.yaw + p.recoilYaw + (Math.random() - 0.5) * shake, 0);
    // lean into strafes + a little roll from the kick
    const side = Math.cos(p.yaw) * p.vel.x - Math.sin(p.yaw) * p.vel.z;
    camera.rotation.z = -side * 0.0025 + rs.r.z * 0.08;
    if (!p.alive) {
      // death cam: pull back and look at your own ragdoll
      const body = p.mesh.userData.ragdoll ? p.mesh.userData.ragdoll.pts[0] : p.pos;
      camera.position.set(body.x + Math.sin(p.yaw) * 2.6, body.y + 1.9, body.z + Math.cos(p.yaw) * 2.6);
      camera.lookAt(body.x, body.y, body.z);
    }
    if (p.scoped) fov = 75 / w.scope;
    else fov = 75 - aimK * (75 - (w.adsFov || 62));
  } else {
    const s = game.specTarget && game.specTarget.alive ? game.specTarget : null;
    if (!s) cycleSpectate();
    const tgt = game.specTarget && game.specTarget.alive ? game.specTarget : p;
    const eye = tgt.eye(_f);
    const back = _r.set(Math.sin(tgt.yaw), 0.35, Math.cos(tgt.yaw)).normalize();
    const dist = Math.min(3.4, raycastWorld(eye, back, 3.4) - 0.25);
    camera.position.copy(eye).addScaledVector(back, Math.max(0.3, dist));
    camera.rotation.set(tgt.pitch - 0.2, tgt.yaw, 0);
  }
  camFov += (fov - camFov) * Math.min(1, dt * 18);
  fovKick *= Math.exp(-22 * dt);
  const nf = camFov + fovKick;
  if (Math.abs(camera.fov - nf) > 0.005) { camera.fov = nf; camera.updateProjectionMatrix(); }
  camera.getWorldDirection(_fwd);
  updateListener(camera.position, _fwd);

  // muzzle lights fade
  playerLight.intensity *= Math.exp(-40 * dt);
  otherLight.intensity *= Math.exp(-40 * dt);
  vmFlashLight.intensity *= Math.exp(-40 * dt);

  // view model
  vmRoot.visible = p.alive && !game.spectating && !p.scoped;
  updateCasings(dt);
  if (!vmRoot.visible || !vmGun) { if (vmRoot.visible) setViewModel(p); return; }
  setViewModel(p);
  const u = vmGun.userData;
  const pose = POSE[w.slot];
  swayX *= Math.exp(-9 * dt); swayY *= Math.exp(-9 * dt);
  stepSprings(dt);
  shotT += dt;
  drawT = Math.max(0, drawT - dt * 3.2);
  const hs = Math.hypot(p.vel.x, p.vel.z) / MOVE.run;
  const k = p.reloadT > 0 ? Math.min(1, 1 - p.reloadT / w.reload) : 0;
  if (p.reloadT > 0) reloadSounds(p, k); else lastReloadStage = -1;
  const tilt = p.reloadT > 0 ? Math.sin(Math.min(1, k * 1.15) * Math.PI) : 0;
  // the sniper's long scope sits further out so the eyepiece doesn't crowd the camera
  const hip = u.boltAction ? [pose.hip[0] + 0.01, pose.hip[1] - 0.01, pose.hip[2] - 0.07] : pose.hip, ads = [0, -u.sightY, -0.2];
  const bobAmt = (1 - aimK * 0.85) * hs;
  const breathe = Math.sin(now() * 1.6) * 0.002 * (1 - aimK);
  vmRoot.position.set(
    hip[0] + (ads[0] - hip[0]) * aimK - swayX * (1 - aimK * 0.7) + Math.sin(bob) * 0.012 * bobAmt,
    hip[1] + (ads[1] - hip[1]) * aimK + swayY + breathe - Math.abs(Math.cos(bob)) * 0.01 * bobAmt - tilt * 0.06 - drawT * 0.25 - landT * 0.03,
    hip[2] + (ads[2] - hip[2]) * aimK,
  );
  vmRoot.position.add(rs.p);
  // bolt-action: gun rolls and dips while the bolt is worked
  const cyc = u.boltAction && shotT > 0.28 && shotT < 0.95 ? Math.sin((shotT - 0.28) / 0.67 * Math.PI) : 0;
  vmRoot.position.y -= cyc * 0.02;
  vmRoot.rotation.set(
    rs.r.x - tilt * 0.55 + drawT * 0.6 - cyc * 0.05,
    pose.rot * (1 - aimK) + swayX * 1.5 + rs.r.y,
    tilt * 0.55 - swayX * 1.2 + rs.r.z + cyc * 0.22,
  );
  // magazine out / in, then bolt or slide
  if (u.mag) {
    const out = k > 0.12 && k < 0.7 ? Math.min(1, (k - 0.12) / 0.15) * (k < 0.5 ? 1 : 1 - (k - 0.5) / 0.2) : 0;
    u.mag.position.copy(u.magBase);
    u.mag.position.y -= out * 0.28;
    u.mag.rotation.x = -out * 0.4;
    u.mag.visible = !(k > 0.3 && k < 0.45);
  }
  if (u.bolt) {
    u.bolt.position.copy(u.boltBase);
    u.bolt.rotation.copy(u.boltRot);
    const pull = k > 0.82 && k < 0.95 ? Math.sin((k - 0.82) / 0.13 * Math.PI) : 0;
    // per-shot action: slide blowback / charging handle twitch / hammer fall / bolt cycle
    const blow = shotT < 0.025 ? shotT / 0.025 : Math.max(0, 1 - (shotT - 0.025) / 0.06);
    if (u.slide) u.bolt.position.z += blow * 0.034 + pull * 0.03;
    else if (u.revolver) u.bolt.rotation.x += shotT < 0.03 ? 0.5 : Math.max(0, 0.5 * (1 - (shotT - 0.03) / 0.22));
    else if (u.pumpAction) {
      // pump racks back and forward after each shot
      const back = THREE.MathUtils.smoothstep(shotT, 0.22, 0.34) - THREE.MathUtils.smoothstep(shotT, 0.4, 0.55);
      u.bolt.position.z += back * 0.11 + pull * 0.08;
    } else if (u.boltAction) {
      const lift = THREE.MathUtils.smoothstep(shotT, 0.3, 0.42) - THREE.MathUtils.smoothstep(shotT, 0.78, 0.9);
      const back = THREE.MathUtils.smoothstep(shotT, 0.42, 0.58) - THREE.MathUtils.smoothstep(shotT, 0.6, 0.76);
      u.bolt.rotation.z += lift * 1.2;
      u.bolt.position.z += back * 0.085 + pull * 0.06;
    } else u.bolt.position.z += (blow * 0.35 + pull) * 0.04;
  }
  if (u.cylinder) u.cylinder.rotation.z += (cylAngle - u.cylinder.rotation.z) * Math.min(1, dt * 30);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  if (game.phase === 'menu') { idleCamera(ts); render(); return; }
  if (!game.paused && game.phase !== 'over') step(dt);
  render();
}

function step(dt) {
  game.time += dt;
  const t = game.time;
  game.noises = game.noises.filter((n) => t - n.t < 1);
  updatePhase(dt);
  if (game.phase === 'over') return;
  updatePlayer(dt);
  for (const f of game.fighters) {
    if (!f.alive) continue;
    if (f.brain) f.brain.think(dt);
    updateWeapon(f, dt);
    updateAbilityState(f, dt);
  }
  for (const f of game.fighters) if (!f.alive) updateAbilityState(f, dt);
  separateFighters();
  playerVision();
  noiseFootsteps(dt);
  updateAbilities(dt);
  if (game.config.mode === 'plant') { updateCharge(dt); updateTactics(); }
  updateFx(dt);
  updateRagdolls(dt);
  updateWorldFx(t);
  for (const f of game.fighters) updateFighterMesh(f, dt, game.player);
  updateCamera(dt);
  if (debugCam) { camera.position.copy(debugCam.pos); camera.lookAt(debugCam.look); vmRoot.visible = false; }
  updateHud(dt);
}
let debugCam = null;

function idleCamera(ts) {
  const a = ts * 0.00005;
  camera.position.set(Math.cos(a) * 30, 18, Math.sin(a) * 30);
  camera.lookAt(0, 0, 0);
  vmRoot.visible = false;
  updateWorldFx(ts / 1000);
}

let debugNoPost = false;
function render() {
  renderer.setRenderTarget(null);
  renderer.clear();
  if (composer && !debugNoPost) {
    gradePass.uniforms.time.value = performance.now() / 1000 % 100;
    gradePass.uniforms.damage.value = game.phase === 'menu' ? 0 : Math.min(0.5, hurtT * 1.4);
    composer.render();
  } else renderer.render(scene, camera);
  if (vmRoot.visible && game.phase !== 'menu') {
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
  }
}
requestAnimationFrame(frame);

// debug handle for testing in the console
window.__riftline = {
  game, startMatch, vmScene, cam(pos, look) { debugCam = pos ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) } : null; }, renderer, composer, noPost(v) { debugNoPost = v; }, aim(v) { forceAim = v; },
  spray(n) { const p = game.player, out = []; for (let i = 0; i < n * 8; i++) { if (i % 8 === 0) { tryFire(p); out.push([+(p.recoil * 1000).toFixed(0), +(p.recoilYaw * 1000).toFixed(0)]); } step(1 / 120); } return out; },
  tick(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) if (!game.paused && game.phase !== 'over' && game.phase !== 'menu') step(dt); render(); },
};
