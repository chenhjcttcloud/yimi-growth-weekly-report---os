const moduleIds = ['results', 'problems', 'nextPlan', 'reflection'];
const maxFragmentLength = 600;

const sentenceEnd = /[。！？；.!?;]+[”’」』】》）)"']*|\r\n|[\r\n\u2028\u2029]/gu;

function fragmentEnd(source, start, end) {
  const limit = start + maxFragmentLength;
  if (end <= limit) return end;

  // Prefer a nearby boundary when a line has no sentence punctuation.
  const searchStart = start + maxFragmentLength * 3 / 4;
  const boundary = source.slice(searchStart, limit).match(/^.*[\s，、]/su);
  if (boundary) return searchStart + boundary[0].length;

  // Offsets use UTF-16, but a boundary must not split a surrogate pair.
  const splitsSurrogate = /[\uD800-\uDBFF]/.test(source[limit - 1]) && /[\uDC00-\uDFFF]/.test(source[limit]);
  return splitsSurrogate ? limit - 1 : limit;
}

function moduleFragments(moduleId, source) {
  if (typeof source !== 'string' || !source.trim()) return [];

  const fragments = [];
  function addFragments(start, end) {
    for (let offset = start; offset < end;) {
      const stop = fragmentEnd(source, offset, end);
      const leadingTrimmed = source.slice(offset, stop).trimStart();
      const text = leadingTrimmed.trimEnd();
      if (text) {
        const start = stop - leadingTrimmed.length;
        fragments.push({id: `${moduleId}-${fragments.length + 1}`, text, start, end: start + text.length});
      }
      offset = stop;
    }
  }

  let start = 0;
  for (const boundary of source.matchAll(sentenceEnd)) {
    const end = boundary.index + boundary[0].length;
    // ASCII sentence marks need a following space so decimals, versions, and URLs stay intact.
    if (!/[。！？；\r\n\u2028\u2029]/u.test(boundary[0]) && end < source.length && !/\s/u.test(source[end])) continue;
    // Keep a numbered list marker with its text.
    if (boundary[0] === '.' && end - start <= 10 && /^\s*\d{1,3}\.$/u.test(source.slice(start, end))) continue;
    addFragments(start, end);
    start = end;
  }
  addFragments(start, source.length);
  return fragments;
}

export function buildReportEvidenceFragments(facts) {
  return Object.fromEntries(moduleIds.map(id => [id, moduleFragments(id, facts?.[id])]));
}
