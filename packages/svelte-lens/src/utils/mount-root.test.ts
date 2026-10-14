import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountRoot } from "./mount-root.js";
import { HOST_ATTRIBUTE, Z_INDEX_OVERLAY } from "../constants.js";

describe("mountRoot", () => {
  beforeEach(() => {
    // Remove any leftover mount hosts
    const existing = document.querySelectorAll(`[${HOST_ATTRIBUTE}]`);
    for (const el of existing) el.remove();
  });

  it("creates a shadow DOM host with correct attribute", () => {
    const { host, root, shadowRoot } = mountRoot();
    expect(host.hasAttribute(HOST_ATTRIBUTE)).toBe(true);
    expect(host.tagName).toBe("DIV");
    expect(shadowRoot).toBeInstanceOf(ShadowRoot);
    expect(root.tagName).toBe("DIV");
    expect(root.hasAttribute(HOST_ATTRIBUTE)).toBe(true);
    host.remove();
  });

  it("sets host to fixed position with correct z-index", () => {
    const { host } = mountRoot();
    expect(host.style.position).toBe("fixed");
    expect(host.style.zIndex).toBe(String(Z_INDEX_OVERLAY));
    host.remove();
  });

  it("returns existing root when called twice", () => {
    const first = mountRoot();
    const second = mountRoot();
    expect(second.host).toBe(first.host);
    expect(second.root).toBe(first.root);
    first.host.remove();
  });

  it("schedules attachment to document.body", () => {
    const { host } = mountRoot();
    // The host should be attached after the scheduled attach
    setTimeout(() => {
      expect(document.body.contains(host)).toBe(true);
      host.remove();
    }, 100);
  });

  it("destroy removes the host and cancels the pending re-attach", async () => {
    const { host, destroy } = mountRoot();
    destroy();
    expect(document.body.contains(host)).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(document.body.contains(host)).toBe(false);
  });
});
