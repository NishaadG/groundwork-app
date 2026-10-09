/**
 * One-shot notices that survive a navigation to another layout (e.g. "You're signed
 * out" after leaving the app). Stored in sessionStorage, shown once, then removed.
 */
export type FlashKey = "signedOut" | "deleted";

const KEY = "gw.flash";

export function setFlash(key: FlashKey) {
  try {
    window.sessionStorage.setItem(KEY, key);
  } catch {
    // storage unavailable (private mode): the notice is simply skipped
  }
}

export function takeFlash(): FlashKey | null {
  try {
    const v = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return v === "signedOut" || v === "deleted" ? v : null;
  } catch {
    return null;
  }
}
