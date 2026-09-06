/** The thin insertion line shown at a row's top/bottom edge while a valid
    drag hovers — the visual half of position-aware reordering (the into-ring
    lives on the row itself). */
export function DropLine({ position }: { position: 'top' | 'bottom' }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute right-1 left-1 z-10 h-[2px] rounded-full bg-primary ${
        position === 'top' ? '-top-px' : '-bottom-px'
      }`}
    />
  );
}
