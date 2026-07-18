// Direct port of the original app's prefix-based search keyword generator
// (utils/helper.js in the old backend) — same behavior, so search results
// stay identical to what users are already used to.
export const generateSearchKeywords = (raw: string): string[] => {
  const keywords = new Set<string>();
  const str = raw.toLowerCase().trim();
  const words = str.split(/\s+/).filter(Boolean);

  keywords.add(str);

  for (const word of words) {
    for (let i = 1; i <= word.length; i++) {
      keywords.add(word.substring(0, i));
    }
  }

  for (let start = 0; start < words.length; start++) {
    let phrase = '';
    for (let end = start; end < words.length; end++) {
      phrase += (end === start ? '' : ' ') + words[end];
      for (let i = 1; i <= phrase.length; i++) {
        keywords.add(phrase.substring(0, i));
      }
    }
  }

  return Array.from(keywords);
};
