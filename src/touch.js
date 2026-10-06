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
    button('tCrouch', 'CROUCH'), button('tReload', 'R'), button('tSwap', '⇄', 'small'), button('tLoadout', 'LOADOUT', 'top'), button('tPause', 'II', 'top'),
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
  hold('tSwap', () => api.switchWeapon());
  hold('tLoadout', () => api.loadout());
  hold('tPause', () => api.pause());
  // HUD cards become buttons
  // gadget cards are buttons (the weapon card is not: it was too easy to hit by accident)
  for (const [id, fn] of [['abQ', () => api.gadget('q')], ['abE', () => api.gadget('e')]]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  }
  loadLayout();
  applyLayout();
  addEventListener('resize', applyLayout);
}

// ---------------------------------------------------------------------------
// Player-customised layout: position (centre, as a fraction of the screen), size and opacity
// for every button, saved in this browser.
// ---------------------------------------------------------------------------
const LAYOUT_KEY = 'riftline.touchLayout';
const EDITABLE = [['tFire', 'Fire'], ['tFire2', 'Left fire'], ['tAim', 'Aim'], ['tJump', 'Jump'], ['tCrouch', 'Crouch'], ['tReload', 'Reload'],
  ['tSwap', 'Swap weapon'], ['tLoadout', 'Loadout'], ['tPause', 'Pause'], ['abilities', 'Gadgets']];
let layout = {};
function loadLayout() { try { layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch { layout = {}; } }
function saveLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ } }

function applyLayout() {
  for (const [id] of EDITABLE) {
    const el = $(id), L = layout[id];
    if (!el) continue;
    el.style.opacity = L?.o != null ? L.o : '';
    if (L?.x != null) {
      el.style.left = `calc(${(L.x * 100).toFixed(2)}% - ${el.offsetWidth / 2}px)`;
      el.style.top = `calc(${(L.y * 100).toFixed(2)}% - ${el.offsetHeight / 2}px)`;
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.transform = `scale(${L.s ?? 1})`;
    } else {
      el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = '';
    }
  }
}

/** Full-screen editor: drag buttons, change size/opacity of the selected one, reset, done. */
export function openTouchEditor(onClose) {
  if (!IS_TOUCH) return;
  loadLayout();
  const ov = document.createElement('div');
  ov.id = 'touchEdit';
  ov.innerHTML = `<div class="te-panel">
    <b>CUSTOMIZE CONTROLS</b><small id="teSel">Drag any button to move it · tap one to change its size and opacity</small>
    <label>Size <input type="range" id="teSize" min="0.6" max="1.8" step="0.05" value="1"></label>
    <label>Opacity <input type="range" id="teOp" min="0.15" max="1" step="0.05" value="1"></label>
    <label>All buttons <input type="range" id="teAll" min="0.15" max="1" step="0.05" value="1"></label>
    <div class="te-row"><button id="teReset" class="ghost">Reset</button><button id="teDone" class="big">DONE</button></div></div>`;
  document.body.appendChild(ov);
  document.body.classList.add('touch-editing');
  let sel = null, drag = null;
  const ensure = (id) => {
    if (layout[id]?.x != null) return layout[id];
    const r = $(id).getBoundingClientRect();
    layout[id] = { ...(layout[id] || {}), x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, s: layout[id]?.s ?? 1 };
    return layout[id];
  };
  const select = (id) => {
    for (const [k] of EDITABLE) $(k)?.classList.toggle('te-sel', k === id);
    sel = id;
    // keep the panel out of the way: dock it on the other side of the screen from the button
    const r = $(id).getBoundingClientRect(), panel = ov.querySelector('.te-panel');
    panel.classList.toggle('left', r.left + r.width / 2 > innerWidth / 2);
    panel.classList.toggle('right', r.left + r.width / 2 <= innerWidth / 2);
    const L = layout[id] || {};
    $('teSel').textContent = `${EDITABLE.find((e) => e[0] === id)[1]} — drag to move`;
    $('teSize').value = L.s ?? 1; $('teOp').value = L.o ?? 1;
  };
  ov.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.te-panel')) return;
    const hit = EDITABLE.find(([id]) => {
      const el = $(id); if (!el || !el.offsetParent) return false;
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6;
    });
    if (!hit) return;
    select(hit[0]);
    const L = ensure(hit[0]);
    drag = { id: hit[0], pid: e.pointerId, dx: L.x * innerWidth - e.clientX, dy: L.y * innerHeight - e.clientY };
    ov.classList.add('dragging');
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const L = layout[drag.id];
    L.x = Math.max(0.02, Math.min(0.98, (e.clientX + drag.dx) / innerWidth));
    L.y = Math.max(0.03, Math.min(0.97, (e.clientY + drag.dy) / innerHeight));
    applyLayout();
  });
  const endDrag = () => { drag = null; ov.classList.remove('dragging'); };
  ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);
  $('teSize').oninput = (e) => { if (!sel) return; ensure(sel).s = +e.target.value; applyLayout(); };
  $('teOp').oninput = (e) => { if (!sel) return; ensure(sel).o = +e.target.value; applyLayout(); };
  $('teAll').oninput = (e) => { for (const [id] of EDITABLE) ensure(id).o = +e.target.value; $('teOp').value = e.target.value; applyLayout(); };
  $('teReset').onclick = () => { layout = {}; saveLayout(); applyLayout(); sel = null; for (const [k] of EDITABLE) $(k)?.classList.remove('te-sel'); };
  $('teDone').onclick = () => {
    saveLayout();
    for (const [k] of EDITABLE) $(k)?.classList.remove('te-sel');
    ov.remove(); document.body.classList.remove('touch-editing');
    onClose?.();
  };
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
