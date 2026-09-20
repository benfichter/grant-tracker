// Ratcliff/Obershelp similarity, the algorithm behind Python's difflib.SequenceMatcher.ratio()
// (no junk heuristics), so the 0.85 threshold behaves the same as the original dedupe script.

function longestMatch(
  a: string,
  b: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): [number, number, number] {
  let bestI = alo
  let bestJ = blo
  let bestK = 0
  let prev = new Array<number>(bhi - blo + 1).fill(0)
  for (let i = alo; i < ahi; i++) {
    const cur = new Array<number>(bhi - blo + 1).fill(0)
    for (let j = blo; j < bhi; j++) {
      if (a[i] === b[j]) {
        const k = (prev[j - blo] ?? 0) + 1
        cur[j - blo + 1] = k
        if (k > bestK) {
          bestK = k
          bestI = i - k + 1
          bestJ = j - k + 1
        }
      }
    }
    prev = cur
  }
  return [bestI, bestJ, bestK]
}

function matchedChars(a: string, b: string): number {
  let total = 0
  const stack: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  while (stack.length) {
    const [alo, ahi, blo, bhi] = stack.pop()!
    if (alo >= ahi || blo >= bhi) continue
    const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi)
    if (!k) continue
    total += k
    stack.push([alo, i, blo, j], [i + k, ahi, j + k, bhi])
  }
  return total
}

export function ratio(a: string, b: string): number {
  const n = a.length + b.length
  if (n === 0) return 1
  return (2 * matchedChars(a, b)) / n
}
