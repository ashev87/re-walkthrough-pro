/**
 * Zeilenumbruch für drawtext-Overlays: greedy an Wortgrenzen, maximal
 * `maxLines` Zeilen; was nicht passt, wird mit „…“ gekappt. Einzelne
 * überlange Wörter werden beim Umbrechen nie zerschnitten — nur im
 * Ellipsen-Pfad wird hart gekappt, damit das Overlay nie überläuft.
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
    if (last.length + 2 > maxCharsPerLine) {
      // Nur im Ellipsen-Pfad: Layout gewinnt über Wortintegrität — ein
      // einzelnes überlanges Wort wird hart gekappt, damit „Wort …“ passt.
      last = last.slice(0, Math.max(0, maxCharsPerLine - 2)).trimEnd();
    }
    lines[lines.length - 1] = last ? `${last} …` : "…";
  }
  return lines.join("\n");
}

/**
 * Meldet, ob wrapText den kompletten Text unterbringt (keine „…“-Kappung).
 * Vergleich über die normalisierte Wortfolge — robust auch bei Texten, die
 * selbst mit „…“ enden, und bei Mehrfach-Leerzeichen im Eingabetext.
 */
export function wrapTextFits(
  text: string,
  maxCharsPerLine: number,
  maxLines = 2
): boolean {
  const normalized = text.trim().split(/\s+/).filter(Boolean).join(" ");
  const wrapped = wrapText(text, maxCharsPerLine, maxLines)
    .split("\n")
    .join(" ");
  return wrapped === normalized;
}
