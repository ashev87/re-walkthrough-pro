/**
 * Zeilenumbruch für drawtext-Overlays: greedy an Wortgrenzen, maximal
 * `maxLines` Zeilen; was nicht passt, wird mit „…“ gekappt. Einzelne
 * überlange Wörter werden nie zerschnitten.
 */
export function wrapText(
  text: string,
  maxCharsPerLine: number,
  maxLines = 2
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    const word = words[index]!;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || current === "") {
      current = candidate;
      index++;
    } else {
      lines.push(current);
      current = "";
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
    current = "";
  }
  const hasLeftover = index < words.length || current !== "";
  if (hasLeftover) {
    let last = lines[lines.length - 1] ?? "";
    while (last.length + 2 > maxCharsPerLine && last.includes(" ")) {
      last = last.slice(0, last.lastIndexOf(" "));
    }
    lines[lines.length - 1] = last ? `${last} …` : "…";
  }
  return lines.join("\n");
}
