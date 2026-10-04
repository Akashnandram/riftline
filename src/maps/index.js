import oldtown from './oldtown.js';
import dunes from './dunes.js';
import harbor from './harbor.js';
import frostpeak from './frostpeak.js';
import temple from './temple.js';

// Every map shares the arena frame (80 x 60 m, spawns behind x = ±30, A site at +x/-z, B at +x/+z)
// so modes, spawns and the practice range work everywhere; the layouts, heights and looks differ.
export const MAP_LIST = [oldtown, dunes, harbor, frostpeak, temple];
export const MAPS = Object.fromEntries(MAP_LIST.map((m) => [m.id, m]));
export const MAP_IDS = MAP_LIST.map((m) => m.id);
export const DEFAULT_MAP = 'oldtown';
export const randomMap = (not) => { const ids = MAP_IDS.filter((i) => i !== not); return ids[Math.floor(Math.random() * ids.length)]; };
