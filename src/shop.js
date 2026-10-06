import { game } from './state.js';
import { WEAPONS, ARMOR, MATCH, GADGETS } from './config.js';
import { setGunLook } from './entities.js';
import { giveGadget } from './abilities.js';

/** Gadget price for this fighter (Quartermaster perk halves it). */
export const gadgetCost = (f, key) => Math.round(GADGETS[key].cost * (f.agent.key === 'haze' ? 0.5 : 1));

/** Buy a weapon key or armor key. Re-buying in the same slot refunds this round's earlier purchase. */
export function buy(f, item) {
  if (game.phase !== 'buy' || !f.alive) return false;
  if (GADGETS[item]) {
    const cost = gadgetCost(f, item);
    if (f.credits < cost || !giveGadget(f, item)) return false;
    f.credits -= cost;
    return true;
  }
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

const pick = (opts) => { let r = Math.random() * opts.reduce((t, o) => t + o[1], 0); for (const [k, wt] of opts) if ((r -= wt) <= 0) return k; return opts[0][0]; };

export function botBuy(f) {
  const r = Math.random();
  const pistolRound = game.round === 1 || (game.config.mode === 'plant' && game.round === MATCH.halfRounds + 1);
  // defenders lean on shotguns/LMGs for holding close angles; attackers prefer rifles
  const defending = game.config.mode === 'plant' && f.team !== game.attackers;
  if (!f.primary) {
    if (pistolRound) {
      buy(f, pick([['magnum', 3], ['wasp', 3], ['light', 4]]));
    } else if (f.credits >= 5700 && r < 0.18) buy(f, 'longbow');
    else if (f.credits >= 3200 && r < 0.12) buy(f, 'hammer');
    else if (f.credits >= 2900) buy(f, pick([['raptor', 5], ['wraith', 4], ['sentry', 1]]));
    else if (f.credits >= 2050) buy(f, pick([['talon', 4], ['sentry', 2], ['warden', defending ? 3 : 1], ['hornet', 2]]));
    else if (f.credits >= 1600 || (game.lossStreak[f.team] >= 2 && f.credits >= 1600)) buy(f, pick([['hornet', 3], ['warden', defending ? 3 : 1]]));
    else if (f.credits >= 800 && r < 0.4) buy(f, 'magnum');
    else if (f.credits >= 450 && r < 0.6) buy(f, 'wasp');
  }
  if (f.armor < 50 && f.credits >= 1000) buy(f, 'heavy');
  else if (f.armor < 25 && f.credits >= 400) buy(f, 'light');
  // gadgets: mostly the operative's favourites, sometimes something else
  for (let i = 0; i < 2; i++) {
    const keys = Object.keys(GADGETS);
    const k = Math.random() < 0.75 ? f.agent.picks[i % f.agent.picks.length] : keys[Math.floor(Math.random() * keys.length)];
    if (f.credits >= gadgetCost(f, k) + (pistolRound ? 0 : 200)) buy(f, k);
  }
}
