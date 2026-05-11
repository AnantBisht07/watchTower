import type { ReactNode } from "react";
import type { Tone } from "../types";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: Tone;
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`statusBadge ${tone}`}>{children}</span>;
}
