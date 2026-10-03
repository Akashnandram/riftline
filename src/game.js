import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { game, now } from './state.js';
import { WEAPONS, ARMOR, AGENTS, ECON, MATCH, MOVE, BOT_NAMES } from './config.js';
import { buildWorld, raycastWorld, drawMapBoxes, smokes, BOUNDS, hasLOS, surfaceUnder, updateWorldFx } from './world.js';
import {
  Fighter, TEAM_COLORS, EYE, updateFighterMesh, moveFighter, separateFighters, tryFire, startReload,
  updateWeapon, switchWeapon, setGunLook, emitSound,
} from './entities.js';
import { BotBrain } from './bot.js';
import { useAbility, abilityReady, updateAbilities, updateAbilityState, clearAbilities, fireFury } from './abilities.js';
import { buy, botBuy } from './shop.js';
import { updateFx, clearFx } from './fx.js';
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
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.92));
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
  const w = innerWidth, h = innerHeight;
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
let choice = { agent: store.get('agent', 'volt'), teamSize: store.get('teamSize', 5), difficulty: store.get('difficulty', 'normal') };

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
  for (const [id, prop, parse] of [['segSize', 'teamSize', Number], ['segDiff', 'difficulty', String]]) {
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
  clearAbilities();
  for (const f of game.fighters) scene.remove(f.mesh);
  game.fighters = []; game.player = null;
}

function startMatch(cfg) {
  teardown();
  setPaused(false);
  game.config = cfg;
  game.time = 0; game.round = 0; game.score = [0, 0]; game.lossStreak = [0, 0];
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
  setupAbilityHud();
  buildPips();
  startRound();
}

function spawnPoint(team, i) {
  const s = team === 0 ? -1 : 1;
  return new THREE.Vector3(s * (35.5 + (i % 2) * 2), 0, -6 + i * 3);
}

function startRound() {
  game.round++;
  game.phase = 'buy';
  game.phaseT = MATCH.buyTime;
  game.spectating = false;
  game.noises = [];
  clearAbilities();
  clearFx();
  const counts = [0, 0];
  for (const f of game.fighters) {
    if (!f.alive || game.round === 1) {
      f.primary = null; f.secondary = 'p9'; f.armor = 0;
      f.ammo = { p9: WEAPONS.p9.mag };
    }
    if (game.round === 1) { f.credits = ECON.start; f.ult = 0; }
    else f.ult = Math.min(MATCH.ultCost, f.ult + 1);
    f.alive = true; f.hp = 100;
    for (const k of [f.primary, f.secondary]) if (k) f.ammo[k] = WEAPONS[k].mag;
    f.cur = f.primary ? 'primary' : 'secondary';
    f.reloadT = 0; f.fireCD = 0; f.bloom = 0; f.recoil = 0; f.recoilYaw = 0; f.scoped = false;
    f.pos.copy(spawnPoint(f.team, counts[f.team]++));
    f.vel.set(0, 0, 0);
    f.yaw = f.team === 0 ? -Math.PI / 2 : Math.PI / 2; f.pitch = 0;
    f.blindUntil = f.revealedUntil = f.spottedUntil = f.overchargeUntil = f.slowUntil = f.furyUntil = f.nearsightUntil = 0;
    f.furyShots = 0; f.healLeft = 0; f.dashT = 0;
    f.bought = []; f.damagedBy.clear();
    f.resetAbilities();
    f.deathT = 0;
    setGunLook(f);
    if (f.brain) { f.brain.planRound(); botBuy(f); setGunLook(f); }
  }
  flashMsg(`ROUND ${game.round}`, 'BUY PHASE — press B to open the armory', 3);
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
game.onPlayerDamaged = () => { hurtT = 0.35; };
let flashEnd = 0, flashDur = 1;
game.onBlind = (dur) => { flashEnd = now() + dur; flashDur = dur; };
game.onBlackout = () => {};

let shotKick = 0;
game.onPlayerShot = (p, w) => {
  shotKick = 1;
  muzzleFlash.visible = true;
  muzzleFlash.rotation.z = Math.random() * 3;
  muzzleFlash.scale.setScalar((w.slot === 'primary' ? 1 : 0.7) * (0.8 + Math.random() * 0.4));
  setTimeout(() => (muzzleFlash.visible = false), 35);
  p.muzzle(playerLight.position);
  playerLight.intensity = 9;
  if (vmGun) { vmFlashLight.position.copy(vmGun.userData.tip); vmGun.localToWorld(vmFlashLight.position); vmFlashLight.intensity = 3; }
  if (w.key !== 'magnum') setTimeout(ejectCasing, w.key === 'longbow' ? 350 : 15);
};
game.onAnyShot = (f, muz) => { if (f === game.player && !game.spectating) return; otherLight.position.copy(muz); otherLight.intensity = 7; };

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
  { key: 'p9', cat: 'secondary', hot: '1' }, { key: 'magnum', cat: 'secondary', hot: '2' },
  { key: 'hornet', cat: 'primary', hot: '3' }, { key: 'raptor', cat: 'primary', hot: '4' }, { key: 'longbow', cat: 'primary', hot: '5' },
  { key: 'light', cat: 'armor', hot: '6' }, { key: 'heavy', cat: 'armor', hot: '7' },
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
    const info = isArmor ? `+${def.value} shield` : `${def.dmg} body · ${def.head} head · ${def.auto ? 'auto' : 'semi'}`;
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
  mg.fillStyle = 'rgba(61,139,255,0.12)'; { const [a, b] = toPx(-40, -30), [c, d] = toPx(-30, 30); mg.fillRect(a, b, c - a, d - b); }
  mg.fillStyle = 'rgba(255,70,85,0.12)'; { const [a, b] = toPx(30, -30), [c, d] = toPx(40, 30); mg.fillRect(a, b, c - a, d - b); }
  drawMapBoxes(mg, toPx);
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
  setText('timer', game.phase === 'end' ? '—' : `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);
  $('timer').classList.toggle('low', game.phase === 'live' && tl <= 10);
  setText('roundLabel', game.phase === 'buy' ? 'BUY PHASE' : `ROUND ${game.round}`);
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

  drawMinimap();
}

// ---------------------------------------------------------------------------
// Player update
// ---------------------------------------------------------------------------
const _f = new THREE.Vector3(), _r = new THREE.Vector3();
let stepT = 0, wasAirborne = false, airVel = 0;

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
  const speed = (walking ? MOVE.walk : MOVE.run) * p.speedMul * (aimK > 0.5 ? 0.8 : 1);
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

  if (!buyOpen && locked()) {
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
    // tiny shake on every shot, scaled by the gun's kick
    const shake = (p.kickT || 0) * w.kick * 0.35;
    camera.rotation.set(p.pitch + p.recoil + (Math.random() - 0.5) * shake, p.yaw + p.recoilYaw + (Math.random() - 0.5) * shake, 0);
    // lean into strafes
    const side = Math.cos(p.yaw) * p.vel.x - Math.sin(p.yaw) * p.vel.z;
    camera.rotation.z = -side * 0.0025;
    if (!p.alive) {
      camera.position.y = p.pos.y + 0.4;
      camera.rotation.z = 0.5;
    }
    if (p.scoped) fov = 75 / w.scope;
    else fov = 75 - aimK * 13;
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
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 18); camera.updateProjectionMatrix(); }
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
  shotKick *= Math.exp(-16 * dt);
  drawT = Math.max(0, drawT - dt * 3.2);
  const hs = Math.hypot(p.vel.x, p.vel.z) / MOVE.run;
  const k = p.reloadT > 0 ? Math.min(1, 1 - p.reloadT / w.reload) : 0;
  if (p.reloadT > 0) reloadSounds(p, k); else lastReloadStage = -1;
  const tilt = p.reloadT > 0 ? Math.sin(Math.min(1, k * 1.15) * Math.PI) : 0;
  const hip = pose.hip, ads = [0, -u.sightY, -0.2];
  const bobAmt = (1 - aimK * 0.85) * hs;
  const breathe = Math.sin(now() * 1.6) * 0.002 * (1 - aimK);
  vmRoot.position.set(
    hip[0] + (ads[0] - hip[0]) * aimK - swayX * (1 - aimK * 0.7) + Math.sin(bob) * 0.012 * bobAmt,
    hip[1] + (ads[1] - hip[1]) * aimK + swayY + breathe - Math.abs(Math.cos(bob)) * 0.01 * bobAmt - tilt * 0.06 - drawT * 0.25 - landT * 0.03,
    hip[2] + (ads[2] - hip[2]) * aimK + shotKick * (0.05 - aimK * 0.025),
  );
  vmRoot.rotation.set(
    shotKick * (0.09 - aimK * 0.06) - tilt * 0.55 + drawT * 0.6,
    pose.rot * (1 - aimK) + swayX * 1.5,
    tilt * 0.55 - swayX * 1.2,
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
    const pull = k > 0.82 && k < 0.95 ? Math.sin((k - 0.82) / 0.13 * Math.PI) : 0;
    const cycle = shotKick > 0.3 ? shotKick * 0.6 : 0;
    u.bolt.position.z += (pull + cycle) * 0.04;
  }
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
  updateFx(dt);
  updateWorldFx(t);
  for (const f of game.fighters) updateFighterMesh(f, dt, game.player);
  updateCamera(dt);
  updateHud(dt);
}

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
  game, startMatch, vmScene, renderer, composer, noPost(v) { debugNoPost = v; }, aim(v) { forceAim = v; },
  spray(n) { const p = game.player, out = []; for (let i = 0; i < n * 8; i++) { if (i % 8 === 0) { tryFire(p); out.push([+(p.recoil * 1000).toFixed(0), +(p.recoilYaw * 1000).toFixed(0)]); } step(1 / 120); } return out; },
  tick(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) if (!game.paused && game.phase !== 'over' && game.phase !== 'menu') step(dt); render(); },
};
