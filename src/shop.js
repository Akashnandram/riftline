import { game } from './state.js';
import { WEAPONS, ARMOR, MATCH } from './config.js';
import { setGunLook } from './entities.js';

/** Buy a weapon key or armor key. Re-buying in the same slot refunds this round's earlier purchase. */
export function buy(f, item) {
  if (game.phase !== 'buy' || !f.alive) return false;
  const armor = ARMOR[item];
  const w = WEAPONS[item];
  if (!armor && !w) return false;
  const slot = armor ? 'armor' : w.slot;
  const cost = armor ? armor.cost : w.cost;
  if (armor && f.armor >= armor.value) return false;
  if (w && (f.primary === item || f.secondary === item)) {
    f.cur = w.slot; setGunLook(f); return false;
  }
  const prev = f.bought.find((b) => b.slot === slot);
  const refund = prev ? prev.cost : 0;
  if (f.credits + refund < cost) return false;
  if (prev) f.bought.splice(f.bought.indexOf(prev), 1);
  f.credits += refund - cost;
  if (armor) {
    if (prev) f.armor = prev.armorBefore;
    f.bought.push({ item, cost, slot, armorBefore: f.armor });
    f.armor = armor.value;
  } else {
    f.bought.push({ item, cost, slot });
    f.give(item);
    setGunLook(f);
  }
  return true;
}

export function botBuy(f) {
  const r = Math.random();
  const pistolRound = game.round === 1 || (game.config.mode === 'plant' && game.round === MATCH.halfRounds + 1);
  if (!f.primary) {
    if (pistolRound) {
      if (r < 0.45) buy(f, 'magnum');
      else buy(f, 'light');
    } else if (f.credits >= 5700 && r < 0.2) { buy(f, 'longbow'); }
    else if (f.credits >= 2900) buy(f, 'raptor');
    else if (f.credits >= 2000 || (game.lossStreak[f.team] >= 2 && f.credits >= 1600)) buy(f, 'hornet');
    else if (f.credits >= 800 && r < 0.4) buy(f, 'magnum');
  }
  if (f.armor < 50 && f.credits >= 1000) buy(f, 'heavy');
  else if (f.armor < 25 && f.credits >= 400) buy(f, 'light');
}
