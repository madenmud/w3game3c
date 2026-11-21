// 결정적 난수. 같은 (시드, 키)는 언제나 같은 수열을 만든다.
// 서버 정산과 클라이언트 재현이 같은 결과를 내기 위한 기반이다.

export function hashString(s: string): number {
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 시드와 키 조합으로 독립된 난수원을 만든다. 예: rngFor(seed, 'settle', month) */
export function rngFor(seed: string, ...keys: (string | number)[]): Rng {
  return mulberry32(hashString([seed, ...keys].join('|')));
}

export function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function intBetween(rng: Rng, lo: number, hi: number): number {
  return Math.floor(uniform(rng, lo, hi + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
