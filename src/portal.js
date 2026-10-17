// Game portals (CrazyGames). When the game runs inside CrazyGames, load their SDK and report
// gameplay start / stop, loading, wins ("happy time") and show an ad between matches.
// Everywhere else every call here does nothing.
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

function onCrazyGames() {
  if (window.RIFTLINE_PORTAL === 'crazygames' || new URLSearchParams(location.search).get('portal') === 'crazygames') return true;
  try {
    const anc = [...(location.ancestorOrigins || [])];
    return window.top !== window.self && (anc.some((o) => /crazygames\./.test(o)) || /crazygames\./.test(document.referrer));
  } catch { return false; }
}

let sdk = null, playing = false, lastAd = 0;
export const portal = { active: onCrazyGames(), name: 'crazygames' };

export async function initPortal() {
  if (!portal.active) return;
  try {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = SDK_URL; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    await window.CrazyGames.SDK.init();
    sdk = window.CrazyGames.SDK;
  } catch { sdk = null; }
}

const safe = (fn) => { try { fn(); } catch { /* the portal SDK should never break the game */ } };
export function gameplayStart() { if (sdk && !playing) { playing = true; safe(() => sdk.game.gameplayStart()); } }
export function gameplayStop() { if (sdk && playing) { playing = false; safe(() => sdk.game.gameplayStop()); } }
export function loadingStart() { if (sdk) safe(() => sdk.game.loadingStart()); }
export function loadingStop() { if (sdk) safe(() => sdk.game.loadingStop()); }
export function happytime() { if (sdk) safe(() => sdk.game.happytime()); }

/**
 * Between matches: show a midgame ad (at most every 3 minutes), muting the game while it plays.
 * Always resolves, ad or not, so the caller just continues afterwards.
 */
export function betweenMatches(mute) {
  if (!sdk || performance.now() - lastAd < 180000) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { mute(false); res(); };
    try {
      sdk.ad.requestAd('midgame', { adStarted: () => { lastAd = performance.now(); mute(true); }, adFinished: done, adError: done });
    } catch { res(); }
    setTimeout(res, 45000);   // never get stuck waiting on an ad
  });
}
