import type { SvelteLensAPI } from "../types.js";

// Internal (not exported from the package): each init() returns a handle onto
// one shared instance. This maps a handle to that instance so the public
// init() wrapper can set the instance up once and expose it globally.
const instances = new WeakMap<SvelteLensAPI, SvelteLensAPI>();

export const markHandle = (handle: SvelteLensAPI, instance: SvelteLensAPI): SvelteLensAPI => {
  instances.set(handle, instance);
  return handle;
};

export const instanceOf = (handle: SvelteLensAPI): SvelteLensAPI | undefined =>
  instances.get(handle);
