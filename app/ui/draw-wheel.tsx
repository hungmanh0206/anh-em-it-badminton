import type { CSSProperties } from "react";

// How long a spin runs: the result is only revealed once the wheel has stopped.
export const DRAW_SPIN_MS = 4500;

const SPIN_TURNS = 5;
const BULBS = Array.from({ length: 12 }, (_, index) => index);

const segmentGradient = (count: number) => {
  const colors = ["var(--wheel-1)", "var(--wheel-2)", "var(--wheel-3)", "var(--wheel-4)"];
  const safeCount = Math.max(1, count);
  return `conic-gradient(${Array.from({ length: safeCount }, (_, index) => {
    const start = (index * 360) / safeCount;
    const end = ((index + 1) * 360) / safeCount;
    return `${colors[index % colors.length]} ${start}deg ${end}deg`;
  }).join(", ")})`;
};

const slotAngle = (index: number, count: number) => (count === 1 ? 0 : (index + 0.5) * (360 / count));

type DrawWheelProps = {
  slots: number[];
  slotClass: (slot: number) => string;
  spinTarget: number | null;
  holding: boolean;
  picked?: number;
  value?: number;
  label?: string;
};

// The wheel turns the target slot up to the pointer while each number counter-rotates to stay upright.
export function DrawWheel({ slots, slotClass, spinTarget, holding, picked, value, label }: DrawWheelProps) {
  const targetIndex = spinTarget === null ? -1 : slots.indexOf(spinTarget);
  const spinning = targetIndex >= 0;
  const style = {
    "--spin-ms": `${DRAW_SPIN_MS}ms`,
    "--spin-end": `${SPIN_TURNS * 360 - (spinning ? slotAngle(targetIndex, slots.length) : 0)}deg`,
    "--wheel-segments": segmentGradient(slots.length),
  } as CSSProperties;
  return <div className={"prize-wheel" + (spinning ? " is-spinning" : "") + (holding ? " is-holding" : "")} style={style}>
    <span className="prize-rim" aria-hidden="true">{BULBS.map((bulb) => <i key={bulb} style={{ "--bulb": bulb } as CSSProperties} />)}</span>
    <span className="prize-pointer" aria-hidden="true" />
    <div className="prize-disc" key={slots.join("-")}>
      {slots.map((slot, index) => <span className="prize-slot" key={slot} style={{ "--slot-angle": `${slotAngle(index, slots.length)}deg` } as CSSProperties}>
        <b className={`prize-badge ${slotClass(slot)}` + (slot === spinTarget ? " is-target" : "") + (slot === picked ? " is-picked" : "")}>{slot}</b>
      </span>)}
    </div>
    <div className="prize-hub"><div className={"prize-hub-face" + (value ? " has-value" : "")} key={`${value ?? "none"}-${label ?? ""}`}><b>{value ?? "?"}</b>{label && <small>{label}</small>}</div></div>
  </div>;
}
