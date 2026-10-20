// Match the typed letter (case-insensitive, for Caps Lock). Fall back to the
// physical key (code) only when key is not a plain letter, e.g. macOS
// Option-modified output like "ç"/"©" or dead keys. Matching code
// unconditionally would hijack other letters on non-QWERTY layouts (Dvorak
// Cmd+Option+I sends code "KeyG"). Never fall back under AltGr: Windows reports
// it as Ctrl+Alt, and AltGr+G types "]" on Czech/Slovak/Hungarian layouts.
export const matchesLetter = (event: KeyboardEvent, letter: string): boolean => {
  const key = event.key?.toLowerCase() ?? "";
  if (key === letter) return true;
  return (
    !/^[a-z]$/.test(key) &&
    !event.getModifierState?.("AltGraph") &&
    event.code === `Key${letter.toUpperCase()}`
  );
};
