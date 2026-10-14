import { HOST_ATTRIBUTE, MOUNT_ROOT_RECHECK_DELAY_MS, Z_INDEX_OVERLAY } from "../constants.js";

interface MountRootResult {
  root: HTMLDivElement;
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  // Cancels any pending attach and removes the host.
  destroy: () => void;
}

const attachToBody = (host: HTMLElement): void => {
  // Guard against the document being torn down (e.g. between tests, or SSR).
  if (typeof document === "undefined" || !document.body) return;
  const candidates = document.querySelectorAll<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
  for (const candidate of candidates) {
    if (candidate === host) continue;
    if (!candidate.shadowRoot) candidate.remove();
  }
  document.body.appendChild(host);
};

// Returns a function that cancels a still-pending DOMContentLoaded attach.
const scheduleAttach = (host: HTMLElement): (() => void) => {
  if (typeof document === "undefined") return () => {};
  if (document.body) {
    attachToBody(host);
    return () => {};
  }
  const onReady = (): void => {
    document.removeEventListener("DOMContentLoaded", onReady);
    attachToBody(host);
  };
  document.addEventListener("DOMContentLoaded", onReady, { once: true });
  return () => document.removeEventListener("DOMContentLoaded", onReady);
};

export const mountRoot = (): MountRootResult => {
  const existing = document.querySelectorAll<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
  for (const existingHost of existing) {
    const existingRoot = existingHost.shadowRoot?.querySelector(`[${HOST_ATTRIBUTE}]`);
    if (existingRoot instanceof HTMLDivElement && existingHost.shadowRoot) {
      return {
        root: existingRoot,
        host: existingHost,
        shadowRoot: existingHost.shadowRoot,
        destroy: () => existingHost.remove(),
      };
    }
    existingHost.remove();
  }

  const host = document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "true");
  host.style.zIndex = String(Z_INDEX_OVERLAY);
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.contain = "strict";

  const shadowRoot = host.attachShadow({ mode: "open" });

  const root = document.createElement("div");
  root.setAttribute(HOST_ATTRIBUTE, "true");
  shadowRoot.appendChild(root);

  let destroyed = false;
  const cancelReady = scheduleAttach(host);

  const recheckTimer = setTimeout(() => {
    if (!destroyed) attachToBody(host);
  }, MOUNT_ROOT_RECHECK_DELAY_MS);

  const destroy = (): void => {
    destroyed = true;
    clearTimeout(recheckTimer);
    cancelReady();
    host.remove();
  };

  return { root, host, shadowRoot, destroy };
};
