// Player settings: mouse, video, audio, crosshair and key bindings. Saved in localStorage.

const KEY = 'riftline.settings';

export const DEFAULTS = {
  sens: 1, adsSens: 0.85, invertY: false,
  fov: 75, showFps: false, thirdPerson: true,
  volume: 0.7,
  crosshair: { color: '#6effc4', length: 6, thickness: 2, gap: 3, dot: true, outline: true, opacity: 1, dynamic: true },
  binds: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'KeyC',
    reload: 'KeyR', primary: 'Digit1', secondary: 'Digit2', ability1: 'KeyQ', ability2: 'KeyE',
    use: 'KeyF', buy: 'KeyB', scoreboard: 'Tab', mute: 'KeyM',
  },
};

export const ACTION_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump',
  sprint: 'Sprint (hold)', crouch: 'Crouch (hold) · slide while sprinting', reload: 'Reload', primary: 'Primary weapon', secondary: 'Sidearm',
  ability1: 'Gadget 1', ability2: 'Gadget 2', use: 'Interact (hold)',
  buy: 'Buy menu', scoreboard: 'Scoreboard (hold)', mute: 'Mute',
};

const CROSSHAIR_PRESETS = ['#6effc4', '#ffffff', '#ffd23f', '#ff8a1f', '#3ee6d6', '#b18cff', '#00ff00', '#ff7bd5'];

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  // carry over the old standalone sensitivity setting
  try { const old = localStorage.getItem('riftline.sens'); if (old != null && saved.sens == null) saved.sens = JSON.parse(old); } catch { /* ignore */ }
  return {
    ...DEFAULTS, ...saved,
    crosshair: { ...DEFAULTS.crosshair, ...(saved.crosshair || {}) },
    binds: Object.fromEntries(Object.keys(DEFAULTS.binds).map((k) => [k, saved.binds?.[k] ?? DEFAULTS.binds[k]])),
  };
}

export const S = load();
const listeners = new Set();
export function onSettingsChange(fn) { listeners.add(fn); }
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ }
  for (const fn of listeners) fn(S);
}

/** Is the key bound to `action` currently held? */
export const held = (keys, action) => !!keys[S.binds[action]] || (action === 'sprint' && !!keys.ShiftRight && S.binds.sprint === 'ShiftLeft');
export const isAction = (code, action) => S.binds[action] === code;

export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', Tab: 'Tab', CapsLock: 'Caps',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] || code.replace(/Left|Right/, '');
}

// ---------------------------------------------------------------------------
// Crosshair (drawn from four bars + optional dot)
// ---------------------------------------------------------------------------
export function drawCrosshair(el, extraGap = 0) {
  const c = S.crosshair;
  const [t, b, l, r] = el.querySelectorAll('i');
  const dot = el.querySelector('b');
  const gap = c.gap + extraGap, len = c.length, th = c.thickness;
  const shadow = c.outline ? '0 0 0 1px rgba(0,0,0,0.75)' : 'none';
  for (const bar of [t, b, l, r]) { bar.style.background = c.color; bar.style.boxShadow = shadow; bar.style.display = len > 0 ? '' : 'none'; }
  Object.assign(t.style, { width: th + 'px', height: len + 'px', left: -th / 2 + 'px', top: -(gap + len) + 'px' });
  Object.assign(b.style, { width: th + 'px', height: len + 'px', left: -th / 2 + 'px', top: gap + 'px' });
  Object.assign(l.style, { height: th + 'px', width: len + 'px', top: -th / 2 + 'px', left: -(gap + len) + 'px' });
  Object.assign(r.style, { height: th + 'px', width: len + 'px', top: -th / 2 + 'px', left: gap + 'px' });
  Object.assign(dot.style, { display: c.dot ? '' : 'none', background: c.color, boxShadow: shadow, width: th + 'px', height: th + 'px', left: -th / 2 + 'px', top: -th / 2 + 'px' });
  el.style.opacity = c.opacity;
}

// ---------------------------------------------------------------------------
// Settings screen
// ---------------------------------------------------------------------------
let rebinding = null;

export function openSettings(root, { quality, setQuality, onClose }) {
  root.hidden = false;
  render();

  function slider(label, value, min, max, step, fmt, onInput) {
    const id = 's' + Math.random().toString(36).slice(2, 8);
    return { html: `<label class="set-row"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><em id="${id}v">${fmt(value)}</em></label>`,
      bind: () => { const el = root.querySelector('#' + id); el.oninput = () => { const v = +el.value; root.querySelector('#' + id + 'v').textContent = fmt(v); onInput(v); save(); }; } };
  }
  function toggle(label, value, onChange) {
    const id = 't' + Math.random().toString(36).slice(2, 8);
    return { html: `<label class="set-row"><span>${label}</span><input type="checkbox" id="${id}" ${value ? 'checked' : ''}><em></em></label>`,
      bind: () => { const el = root.querySelector('#' + id); el.onchange = () => { onChange(el.checked); save(); }; } };
  }

  function render() {
    const c = S.crosshair;
    const rows = {
      mouse: [
        slider('Sensitivity', S.sens, 0.1, 4, 0.05, (v) => v.toFixed(2), (v) => { S.sens = v; }),
        slider('Aim-down-sights multiplier', S.adsSens, 0.3, 1.5, 0.05, (v) => v.toFixed(2), (v) => { S.adsSens = v; }),
        toggle('Third-person camera (over the shoulder)', S.thirdPerson, (v) => { S.thirdPerson = v; }),
        toggle('Invert vertical look', S.invertY, (v) => { S.invertY = v; }),
      ],
      video: [
        slider('Field of view', S.fov, 60, 100, 1, (v) => `${v}°`, (v) => { S.fov = v; }),
        toggle('Show FPS counter', S.showFps, (v) => { S.showFps = v; }),
      ],
      audio: [slider('Master volume', S.volume, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { S.volume = v; })],
      cross: [
        slider('Length', c.length, 0, 16, 1, (v) => v, (v) => { c.length = v; drawPreview(); }),
        slider('Thickness', c.thickness, 1, 6, 1, (v) => v, (v) => { c.thickness = v; drawPreview(); }),
        slider('Gap', c.gap, 0, 14, 1, (v) => v, (v) => { c.gap = v; drawPreview(); }),
        slider('Opacity', c.opacity, 0.2, 1, 0.05, (v) => v.toFixed(2), (v) => { c.opacity = v; drawPreview(); }),
        toggle('Centre dot', c.dot, (v) => { c.dot = v; drawPreview(); }),
        toggle('Outline', c.outline, (v) => { c.outline = v; drawPreview(); }),
        toggle('Expand while moving / firing', c.dynamic, (v) => { c.dynamic = v; }),
      ],
    };
    const section = (title, list) => `<section><h3>${title}</h3>${list.map((r) => r.html).join('')}</section>`;
    root.innerHTML = `<div class="menuInner settings">
      <div class="set-head"><h2>SETTINGS</h2><button class="ghost" id="setReset">Reset to defaults</button><button class="big" id="setDone">DONE</button></div>
      <div class="set-grid">
        <div>
          ${section('MOUSE', rows.mouse)}
          ${section('VIDEO', rows.video)}
          <section><h3>GRAPHICS QUALITY</h3><div class="seg" id="setQuality">
            ${['low', 'medium', 'high'].map((q) => `<button data-v="${q}" class="${q === quality ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}
          </div><p class="hint">Changing quality reloads the page.</p></section>
          ${section('AUDIO', rows.audio)}
        </div>
        <div>
          <section><h3>CROSSHAIR</h3>
            <div class="xh-preview"><div class="xh" id="xhPreview"><i></i><i></i><i></i><i></i><b></b></div></div>
            <div class="swatches">${CROSSHAIR_PRESETS.map((col) => `<button class="sw${col === c.color ? ' on' : ''}" data-c="${col}" style="background:${col}"></button>`).join('')}
              <input type="color" id="xhCustom" value="${c.color}" title="Custom colour"></div>
            ${rows.cross.map((r) => r.html).join('')}
          </section>
        </div>
        <div>
          <section><h3>CONTROLS</h3><p class="hint">Click a key, then press the new key (Esc cancels).</p>
            <div class="binds">${Object.keys(DEFAULTS.binds).map((a) => `<div class="bind-row"><span>${ACTION_LABELS[a]}</span><button data-a="${a}" class="${rebinding === a ? 'wait' : ''}">${rebinding === a ? 'Press a key…' : keyName(S.binds[a])}</button></div>`).join('')}</div>
          </section>
        </div>
      </div></div>`;
    for (const list of Object.values(rows)) for (const r of list) r.bind();
    drawPreview();
    root.querySelectorAll('.sw').forEach((b) => { b.onclick = () => { c.color = b.dataset.c; save(); render(); }; });
    root.querySelector('#xhCustom').oninput = (e) => { c.color = e.target.value; save(); drawPreview(); };
    root.querySelectorAll('#setQuality button').forEach((b) => { b.onclick = () => { if (b.dataset.v !== quality) setQuality(b.dataset.v); }; });
    root.querySelectorAll('.binds button').forEach((b) => { b.onclick = () => { rebinding = b.dataset.a; render(); }; });
    root.querySelector('#setDone').onclick = close;
    root.querySelector('#setReset').onclick = () => {
      Object.assign(S, JSON.parse(JSON.stringify(DEFAULTS)));
      save(); render();
    };
  }
  function drawPreview() { drawCrosshair(root.querySelector('#xhPreview')); }

  function onKey(e) {
    if (!rebinding || root.hidden) return;
    e.preventDefault(); e.stopPropagation();
    if (e.code !== 'Escape') {
      // swap if another action already uses this key
      const other = Object.keys(S.binds).find((a) => S.binds[a] === e.code && a !== rebinding);
      if (other) S.binds[other] = S.binds[rebinding];
      S.binds[rebinding] = e.code;
      save();
    }
    rebinding = null;
    render();
  }
  window.addEventListener('keydown', onKey, true);

  function close() {
    rebinding = null;
    window.removeEventListener('keydown', onKey, true);
    root.hidden = true;
    root.innerHTML = '';
    onClose?.();
  }
}
