import type { SvelteLensAPI } from "../types.js";

// Internal (not exported from the package): marks the handles a repeat
// init() hands out, so the public init() wrapper doesn't set them up again.
const borrowedApis = new WeakSet<SvelteLensAPI>();

export const markBorrowed = (api: SvelteLensAPI): SvelteLensAPI => {
  borrowedApis.add(api);
  return api;
};

export const isBorrowedApi = (api: SvelteLensAPI): boolean => borrowedApis.has(api);
