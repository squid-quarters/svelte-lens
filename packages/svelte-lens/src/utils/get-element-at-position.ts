import { isMountHost } from "./is-mount-host.js";

interface GetElementAtPositionOptions {
  // Look through the lens's own UI (e.g. the context-menu backdrop) to the
  // page element underneath instead of reporting no element.
  throughLensUi?: boolean;
}

// Returns null when the pointer is over the lens's own UI (toolbar, menu):
// the host is pointer-events:none, so it only appears in elementsFromPoint
// where an interactive lens element is under the pointer.
export const getElementAtPosition = (
  clientX: number,
  clientY: number,
  options: GetElementAtPositionOptions = {},
): Element | null => {
  if (typeof document === "undefined") return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const candidates = document.elementsFromPoint(clientX, clientY);
  for (const candidate of candidates) {
    if (!isMountHost(candidate)) return candidate;
    if (!options.throughLensUi) return null;
  }
  return null;
};
