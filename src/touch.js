// Phone / tablet controls: a floating move stick on the left, swipe-to-look on the right and
// thumb buttons (fire, aim, jump, crouch, reload, loadout, pause). The gadget chips and the
// weapon card on the HUD become tap targets too. Uses pointer events, so it's fully multi-touch.

export const IS_TOUCH = (() => {
  try { return matchMedia('(pointer: coarse)').matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0); } catch { return false; }
})();

/** Live touch input, read by the game every frame. */
export const touch = {
  on: IS_TOUCH,
  move: { x: 0, y: 0 },     // stick, -1..1 (y: +1 = forward)
  lookX: 0, lookY: 0,       // accumulated swipe pixels since the last frame
  jump: false, crouch: false, aimToggle: false,
};

const $ = (id) => document.getElementById(id);
let api = null;

function button(id, label, cls = '') {
  const b = document.createElement('div');
  b.id = id; b.className = 'tbtn ' + cls; b.textContent = label;
  return b;
}

/** Build the overlay. api: { fire(down), aim(), reload(), switchWeapon(), gadget(slot), loadout(), pause(), active() } */
export function initTouch(gameApi) {
  if (!IS_TOUCH) return;
  api = gameApi;
  document.body.classList.add('touch');
  const root = document.createElement('div');
  root.id = 'touchUI';
  root.innerHTML = '<div id="tStick"><div id="tKnob"></div></div>';
  const btns = [
    button('tFire', 'FIRE', 'big'), button('tFire2', '●', 'small'), button('tAim', 'AIM'), button('tJump', 'JUMP'),
    button('tCrouch', 'CROUCH'), button('tReload', 'R'), button('tLoadout', 'LOADOUT', 'top'), button('tPause', 'II', 'top'),
  ];
  for (const b of btns) root.appendChild(b);
  $('hud').appendChild(root);

  // ---- move stick (appears where the left thumb lands) + look swipes ----
  let stickId = null, stickX = 0, stickY = 0, lookId = null, lastX = 0, lastY = 0;
  const stick = $('tStick'), knob = $('tKnob');
  const R = 58;
  root.addEventListener('pointerdown', (e) => {
    if (e.target !== root || !api.active()) return;
    if (e.clientX < innerWidth * 0.42 && stickId == null) {
      stickId = e.pointerId; stickX = e.clientX; stickY = e.clientY;
      stick.style.left = stickX - R + 'px'; stick.style.top = stickY - R + 'px';
      stick.classList.add('on');
    } else if (lookId == null) { lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY; }
    try { root.setPointerCapture?.(e.pointerId); } catch { /* synthetic or ended pointer */ }
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - stickX, dy = e.clientY - stickY;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      touch.move.x = dx / R; touch.move.y = -dy / R;
    } else if (e.pointerId === lookId) {
      touch.lookX += e.clientX - lastX; touch.lookY += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  const release = (e) => {
    if (e.pointerId === stickId) { stickId = null; touch.move.x = touch.move.y = 0; knob.style.transform = ''; stick.classList.remove('on'); }
    if (e.pointerId === lookId) lookId = null;
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  // ---- buttons ----
  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); down(); });
    const off = (e) => { el.classList.remove('down'); up?.(); };
    el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
  };
  // the big fire button also steers the view while held (thumb rolls on it), like most mobile shooters
  for (const id of ['tFire', 'tFire2']) {
    const el = $(id);
    let fid = null, fx = 0, fy = 0;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fid = e.pointerId; fx = e.clientX; fy = e.clientY; el.classList.add('down'); api.fire(true); try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ } });
    el.addEventListener('pointermove', (e) => { if (e.pointerId !== fid) return; touch.lookX += e.clientX - fx; touch.lookY += e.clientY - fy; fx = e.clientX; fy = e.clientY; });
    const off = (e) => { if (e.pointerId !== fid) return; fid = null; el.classList.remove('down'); api.fire(false); };
    el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
  }
  hold('tAim', () => api.aim());
  hold('tJump', () => { touch.jump = true; }, () => { touch.jump = false; });
  hold('tCrouch', () => { touch.crouch = true; }, () => { touch.crouch = false; });
  hold('tReload', () => api.reload());
  hold('tLoadout', () => api.loadout());
  hold('tPause', () => api.pause());
  // HUD cards become buttons
  for (const [id, fn] of [['abQ', () => api.gadget('q')], ['abE', () => api.gadget('e')], ['bottomRight', null]]) {
    const el = $(id);
    if (!el || !fn) continue;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  }
  $('weaponName')?.parentElement?.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); api.switchWeapon(); });
}

/** Take (and clear) the look movement gathered since the last frame. */
export function takeLook() {
  const x = touch.lookX, y = touch.lookY;
  touch.lookX = touch.lookY = 0;
  return [x, y];
}

/** Go fullscreen + landscape when a match starts (phones). */
export function enterFullscreen() {
  if (!IS_TOUCH) return;
  try {
    const el = document.documentElement;
    const p = el.requestFullscreen?.({ navigationUI: 'hide' }) || el.webkitRequestFullscreen?.();
    p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch?.(() => {});
  } catch { /* not allowed: keep playing in the browser UI */ }
}
