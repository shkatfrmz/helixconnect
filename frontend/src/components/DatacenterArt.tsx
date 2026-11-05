import { useMemo } from "react";

type Rack = {
  x: number;
  w: number;
  h: number;
  units: number;
  lit: number[];
};

function makeRacks(count: number, seed: number): Rack[] {
  const racks: Rack[] = [];
  let x = 30;
  for (let i = 0; i < count; i++) {
    const w = 58 + ((i * 37 + seed * 11) % 26);
    const h = 230 + ((i * 53 + seed * 7) % 180);
    const units = Math.max(6, Math.floor(h / 20));
    const litCount = 2 + ((i * 3 + seed) % 4);
    const lit = Array.from({ length: litCount }, (_, k) => (i * 5 + k * 7 + seed) % units);
    racks.push({ x, w, h, units, lit });
    x += w + 22;
  }
  return racks;
}

/**
 * Original vector illustration of a server-room aisle: rack silhouettes with
 * blinking status LEDs and a couple of cable runs carrying a slow data pulse.
 * `hero` is the large login-screen backdrop; `mark` is a small quiet corner
 * watermark used on the pages behind the login wall.
 */
export function DatacenterArt({ variant = "hero", className = "" }: { variant?: "hero" | "mark"; className?: string }) {
  const seed = variant === "hero" ? 3 : 11;
  const count = variant === "hero" ? 10 : 4;
  const racks = useMemo(() => makeRacks(count, seed), [count, seed]);
  const baseY = variant === "hero" ? 460 : 260;
  const width = racks.length ? racks[racks.length - 1].x + racks[racks.length - 1].w + 30 : 100;

  return (
    <svg
      className={`dc-art dc-art-${variant} ${className}`}
      viewBox={`0 0 ${width} ${baseY + 20}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="dc-cables">
        {racks.slice(0, -1).map((r, i) => {
          const next = racks[i + 1];
          const x1 = r.x + r.w;
          const x2 = next.x;
          const y = baseY - 10;
          return (
            <path
              key={`c-${i}`}
              d={`M ${x1} ${y} C ${x1 + 18} ${y - 26}, ${x2 - 18} ${y - 26}, ${x2} ${y}`}
              className="dc-cable"
            />
          );
        })}
        {racks.length > 3 && (
          <circle r="2.6" className="dc-pulse">
            <animateMotion
              dur="7s"
              repeatCount="indefinite"
              path={`M ${racks[0].x + racks[0].w} ${baseY - 10} C ${racks[0].x + racks[0].w + 18} ${baseY - 36}, ${racks[1].x - 18} ${baseY - 36}, ${racks[1].x} ${baseY - 10} L ${racks[1].x + racks[1].w} ${baseY - 10} C ${racks[1].x + racks[1].w + 18} ${baseY - 36}, ${racks[2].x - 18} ${baseY - 36}, ${racks[2].x} ${baseY - 10}`}
            />
          </circle>
        )}
      </g>
      {racks.map((r, i) => (
        <g key={i} transform={`translate(${r.x}, ${baseY - r.h})`}>
          <rect width={r.w} height={r.h} rx="3" className="dc-rack" />
          <rect width={r.w} height="6" className="dc-rack-cap" />
          {Array.from({ length: r.units }).map((_, u) => {
            const uy = 10 + u * ((r.h - 14) / r.units);
            const lit = r.lit.includes(u);
            const ok = (u + i) % 3 === 0;
            return (
              <g key={u}>
                <line x1="5" x2={r.w - 5} y1={uy} y2={uy} className="dc-slot-line" />
                {lit && (
                  <rect
                    x={r.w - 11}
                    y={uy + 3}
                    width="4"
                    height="4"
                    className={`dc-led ${ok ? "dc-led-ok" : ""}`}
                    style={{ animationDelay: `${((u * 0.37 + i * 0.6) % 3).toFixed(2)}s` }}
                  />
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
