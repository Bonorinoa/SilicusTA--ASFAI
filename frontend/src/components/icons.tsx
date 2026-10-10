/**
 * icons.tsx — small stroke glyphs. State is NEVER color-only: every state
 * marker pairs one of these glyphs with a visible text label.
 */
import type { ProposalStatus } from "../gate/types";

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export function AwaitingIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

export function AcceptedIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.6 8.2 7.3 9.9 10.5 6.4" />
    </svg>
  );
}

export function RenamedIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9.8 3.4 12.6 6.2 6.4 12.4l-3.3.5.5-3.3z" />
      <path d="M9.1 4.1 11.9 6.9" />
    </svg>
  );
}

export function DroppedIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
    </svg>
  );
}

export function AddedIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4" />
      <path d="M8 5.6v4.8M5.6 8h4.8" />
    </svg>
  );
}

export function PlusIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function PrintIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 6V2.8h7V6" />
      <rect x="2.5" y="6" width="11" height="5" rx="1" />
      <path d="M4.5 9.5h7v3.7h-7z" />
    </svg>
  );
}

const STATUS_ICON = {
  proposed: AwaitingIcon,
  accepted: AcceptedIcon,
  renamed: RenamedIcon,
  dropped: DroppedIcon,
  added: AddedIcon,
} as const;

export function StateIcon({ status, size = 14, className }: { status: ProposalStatus } & IconProps) {
  const Glyph = STATUS_ICON[status];
  return <Glyph size={size} className={className} />;
}
