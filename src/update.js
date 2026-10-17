// "New version" notice: every few minutes (and when the tab comes back) check whether the deployed
// game code changed (its ETag / Last-Modified header). If it did, show a small banner offering a
// reload, but only outside a match, so nobody gets interrupted mid-fight.
const CHECK_EVERY = 3 * 60 * 1000;
let first = null, found = false;

async function stamp() {
  try {
    const r = await fetch('src/game.js', { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) return null;
    return r.headers.get('etag') || r.headers.get('last-modified');
  } catch { return null; }
}

/**
 * idle(): true while it's fine to show the banner (menus, results screen).
 * Calls show() once when an update is found and idle() allows it.
 */
export function watchUpdates(idle, show) {
  const check = async () => {
    if (found) return;
    const s = await stamp();
    if (!s) return;
    if (first == null) { first = s; return; }
    if (s !== first) found = true;
  };
  const maybeShow = () => { if (found && idle()) { show(); clearInterval(poll); } };
  check();
  setInterval(check, CHECK_EVERY);
  const poll = setInterval(maybeShow, 2000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
