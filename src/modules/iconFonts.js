var defaultIconFonts = [
  // /uicons/i,
  /font\s*awesome/i,
  /material\s*icons/i,
  /ionicons/i,
  /glyphicons/i,
  /feather/i,
  /bootstrap\s*icons/i,
  /remix\s*icons/i,
  /heroicons/i,
  /layui/i,
  /lucide/i
];

var userIconFonts = [];

export function extendIconFonts(fonts) {
  const list = Array.isArray(fonts) ? fonts : [fonts];
  for (const f of list) {
    if (f instanceof RegExp) {
      userIconFonts.push(f);
    } else if (typeof f === "string") {
      userIconFonts.push(new RegExp(f, "i"));
    } else {
      console.warn("[snapdom] Ignored invalid iconFont value:", f);
    }
  }
}

export function isIconFont(input) {
  /* v8 ignore next */
  const text = typeof input === "string" ? input : "";
  const candidates = [...defaultIconFonts, ...userIconFonts];
  for (const rx of candidates) {
    if (rx instanceof RegExp && rx.test(text)) return true;
  }
  /* v8 ignore next */
  if (/icon/i.test(text) || /glyph/i.test(text) || /symbols/i.test(text) || /feather/i.test(text) || /fontawesome/i.test(text)) return true;
  return false;
}