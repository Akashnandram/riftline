// Background worker: computes procedural texture pixels (see texgen.js) off the main thread.
import { GEN } from './texgen.js';

self.onmessage = (e) => {
  const { id, name, size } = e.data;
  const r = GEN[name](size);
  self.postMessage({ id, ...r }, [r.col.buffer, r.rough.buffer, r.nrm.buffer]);
};
