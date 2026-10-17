import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface Props { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; name: string; /** Keeps the sheet mounted but out of sight while another sheet opened from it is showing. */ hidden?: boolean }

/** A modal sheet. Escape and a click outside close it, Tab stays inside it, and focus returns to where it was. */
export function Sheet({ title, onClose, children, footer, width = 460, name, hidden }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], ' + FOCUSABLE);
    first?.focus();
    return () => before?.focus?.();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const [a, z] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  };
  return createPortal(
    <div className="scrim" hidden={hidden} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} data-sheet={name} style={{ width }} onKeyDown={onKey}>
        <h2 id={id}>{title}</h2>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
