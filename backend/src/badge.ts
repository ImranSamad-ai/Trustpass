import type { Tier, TrustPassport } from "./passport.js";

const COLOR: Record<Tier, string> = { New: "#8A8AA3", Proven: "#B07CFF", Trusted: "#7D00FF", Elite: "#2FD6A0" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tone = (p: TrustPassport) => {
  if (p.status === "violated") return { bg: "#FF5A6E", fg: "#fff", name: "Violated" };
  const dark = p.tier === "Elite" || p.tier === "Proven";
  return { bg: COLOR[p.tier], fg: dark ? "#06140F" : "#fff", name: p.tier };
};

/** Compact pill badge, e.g. for READMEs: ![Trust Passport](https://host/badge/agent-id.svg) */
export function badgeSvg(p: TrustPassport): string {
  const t = tone(p);
  const right = `${t.name} · ${p.score}`;
  const lw = 104;
  const rw = Math.round(right.length * 7 + 20);
  const w = lw + rw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24" role="img" aria-label="Trust Passport: ${esc(right)}"><clipPath id="r"><rect width="${w}" height="24" rx="12"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="24" fill="#14141D"/><rect x="${lw}" width="${rw}" height="24" fill="${t.bg}"/></g><g font-family="Inter,Verdana,sans-serif" font-size="11" font-weight="600" text-anchor="middle"><text x="${lw / 2}" y="16" fill="#fff">trust passport</text><text x="${lw + rw / 2}" y="16" fill="${t.fg}">${esc(right)}</text></g></svg>`;
}

/** Shareable 600x315 card with score ring and key stats. */
export function cardSvg(p: TrustPassport): string {
  const t = tone(p);
  const C = 2 * Math.PI * 54;
  const pw = Math.round(t.name.length * 9 + 28);
  const stat = (x: number, v: string, l: string) =>
    `<text x="${x}" y="226" font-size="22" font-weight="700">${esc(v)}</text><text x="${x}" y="246" font-size="11" fill="#9A9AB0">${l}</text>`;
  const vol = `$${p.cleanVolumeUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315" viewBox="0 0 600 315" role="img" aria-label="Trust Passport for ${esc(p.grantId)}: ${t.name}, score ${p.score} of 100"><defs><radialGradient id="g" cx="85%" cy="0%" r="90%"><stop offset="0" stop-color="#7D00FF" stop-opacity=".55"/><stop offset="1" stop-color="#0A0A0F" stop-opacity="0"/></radialGradient></defs><rect width="600" height="315" rx="28" fill="#0A0A0F"/><rect width="600" height="315" rx="28" fill="url(#g)"/><rect x=".5" y=".5" width="599" height="314" rx="27.5" fill="none" stroke="#2A2A40"/><g font-family="Inter,Helvetica,Arial,sans-serif" fill="#fff"><text x="36" y="52" font-size="13" font-weight="700" letter-spacing="2" fill="#B07CFF">TRUST PASSPORT</text><text x="36" y="94" font-size="26" font-weight="700">${esc(clip(p.grantId, 24))}</text><rect x="36" y="114" width="${pw}" height="30" rx="15" fill="${t.bg}"/><text x="${36 + pw / 2}" y="134" font-size="14" font-weight="700" text-anchor="middle" fill="${t.fg}">${t.name}</text><g transform="translate(480 150)"><circle r="54" fill="none" stroke="#24243A" stroke-width="12"/><circle r="54" fill="none" stroke="${t.bg}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${((p.score / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90)"/><text y="10" font-size="34" font-weight="800" text-anchor="middle">${p.score}</text><text y="30" font-size="12" text-anchor="middle" fill="#9A9AB0">/ 100</text></g>${stat(36, String(p.successfulSpends), "clean spends")}${stat(170, vol, "clean volume")}${stat(320, String(p.daysActive), "days active")}<text x="36" y="288" font-size="11" fill="#7A7A92">Self-reported · not independently verified</text></g></svg>`;
}
