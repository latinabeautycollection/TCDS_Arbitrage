const RISKY = [
  /\bbrand new\b/i, /\bperfect\b/i, /\bflawless\b/i, /\bguaranteed\b/i,
  /\brare\b/i, /\bauthentic\b/i, /\b100%\b/i, /\bno issues\b/i,
];

export function detectUnsupportedClaims(text: string): string[] {
  return RISKY.filter(r => r.test(text)).map(r => `Potential unsupported claim: ${String(r)}`);
}
