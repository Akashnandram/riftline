// Share card: a 1200×630 image of a match result (Victory/Defeat, score, your stats) that can be
// sent with the phone's share sheet, or downloaded on desktop. Drawn on a canvas, nothing uploaded.
const URL_TEXT = 'riftline-flame.vercel.app';
const MODE_NAMES = { uplink: 'UPLINK', dom: 'DOMINATION', tdm: 'TEAM DEATHMATCH', kc: 'KILL CONFIRMED' };

export function drawCard(r) {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
  const g = c.getContext('2d');
  const font = (w, px) => `${w} ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
  // background: dark slate with a team-coloured glow
  const bg = g.createLinearGradient(0, 0, 1200, 630);
  bg.addColorStop(0, '#0d1117'); bg.addColorStop(1, '#1b2230');
  g.fillStyle = bg; g.fillRect(0, 0, 1200, 630);
  const accent = r.title === 'VICTORY' ? '#6effc4' : r.title === 'DEFEAT' ? '#ff4d5e' : '#e8eaed';
  const glow = g.createRadialGradient(900, 140, 0, 900, 140, 520);
  glow.addColorStop(0, accent + '33'); glow.addColorStop(1, 'transparent');
  g.fillStyle = glow; g.fillRect(0, 0, 1200, 630);
  // diagonal stripes
  g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 18;
  for (let x = -600; x < 1400; x += 60) { g.beginPath(); g.moveTo(x, 630); g.lineTo(x + 400, 0); g.stroke(); }
  // logo
  g.font = font('italic 800', 46); g.textBaseline = 'top';
  g.fillStyle = '#e8eaed'; g.fillText('RIFT', 64, 52);
  g.fillStyle = '#ff8a1f'; g.fillText('LINE', 64 + g.measureText('RIFT').width, 52);
  g.font = font(600, 22); g.fillStyle = '#9aa3ad';
  g.fillText(`${MODE_NAMES[r.mode] || 'MATCH'} · ${r.map.toUpperCase()}`, 64, 112);
  // result + score
  g.font = font(800, 120); g.fillStyle = accent; g.fillText(r.title, 58, 170);
  g.font = font(700, 64);
  g.fillStyle = '#7fb2ff'; g.fillText(String(r.my), 64, 310);
  const w1 = g.measureText(String(r.my)).width;
  g.fillStyle = '#9aa3ad'; g.fillText(' – ', 64 + w1, 310);
  g.fillStyle = '#ffb066'; g.fillText(String(r.their), 64 + w1 + g.measureText(' – ').width, 310);
  // stat tiles
  const tiles = [['KILLS', r.kills], ['DEATHS', r.deaths], ['ASSISTS', r.assists], ['ACCURACY', r.acc], ['BEST GUN', r.best]];
  tiles.forEach(([k, v], i) => {
    const x = 64 + i * 216, y = 430;
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y, 200, 110);
    g.fillStyle = accent; g.fillRect(x, y, 4, 110);
    g.fillStyle = '#e8eaed'; g.font = font(700, String(v).length > 9 ? 28 : 44); g.fillText(String(v), x + 20, y + 16);
    g.fillStyle = '#9aa3ad'; g.font = font(600, 18); g.fillText(k, x + 20, y + 76);
  });
  // player + footer
  g.font = font(700, 26); g.fillStyle = '#ffd23f'; g.textAlign = 'right';
  g.fillText(`LEVEL ${r.level}`, 1136, 60);
  g.font = font(600, 22); g.fillStyle = '#9aa3ad';
  g.fillText(`Play free: ${URL_TEXT}`, 1136, 572);
  return c;
}

/** Share (phones) or download (desktop) the result card. Resolves to what happened. */
export async function shareResult(r) {
  try { await document.fonts?.load('800 40px "Chakra Petch"'); } catch { /* use fallback font */ }
  const canvas = drawCard(r);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const text = `${r.title} ${r.my}–${r.their} in Riftline (${MODE_NAMES[r.mode] || 'match'}) · ${r.kills} kills. Play free: https://${URL_TEXT}`;
  const file = blob && new File([blob], 'riftline-result.png', { type: 'image/png' });
  try {
    if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, title: 'Riftline' }); return 'shared'; }
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text, title: 'Riftline', url: `https://${URL_TEXT}` }); return 'shared'; }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  // desktop: save the image and copy the text
  if (blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'riftline-result.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  try { await navigator.clipboard?.writeText(text); } catch { /* ignore */ }
  return 'downloaded';
}
