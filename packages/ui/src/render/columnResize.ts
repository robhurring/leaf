// Column widths by dragging, for any table with a header row: each header cell gets a grip on its
// right edge. The first drag pins every column at the width it has, so from then on a drag changes
// the one column and the table grows or shrinks with it (its wrapper scrolls sideways), catching
// on the page's edge as it passes. A click on a grip puts that column back, and once every column
// is back the table lays itself out again; a double-click fits the column to what it holds. The
// widths live on the elements, like the sort marks, and last until the page reloads.
import { useEffect, useRef, type RefObject } from 'react';

const MIN_WIDTH = 60;
const SNAP = 10;
/** How far the pointer travels before a press on a grip is a drag and not a click. */
const DRAG = 3;

export function useColumnResize(ref: RefObject<HTMLTableElement | null>, content: unknown) {
  // Each column's width before any drag, to return to.
  const natural = useRef(new WeakMap<HTMLTableCellElement, number>());

  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const was = natural.current;
    const heads = [...table.querySelectorAll<HTMLTableCellElement>(':scope > thead th')];
    const pinned = () => table.dataset.sized !== undefined;
    const room = () => table.parentElement?.clientWidth ?? 0;

    const release = () => {
      for (const th of table.querySelectorAll<HTMLTableCellElement>(':scope > thead th'))
        th.style.width = '';
      table.style.width = '';
      table.style.maxWidth = '';
      delete table.dataset.sized;
    };
    const pin = () => {
      if (pinned()) return;
      const widths = heads.map((th) => th.getBoundingClientRect().width);
      const whole = table.getBoundingClientRect().width;
      heads.forEach((th, i) => {
        was.set(th, widths[i]!);
        th.style.width = `${widths[i]}px`;
      });
      table.style.width = `${whole}px`;
      // Inline, because a theme may cap its tables at the page's width.
      table.style.maxWidth = 'none';
      table.dataset.sized = '';
    };
    const setWidth = (th: HTMLTableCellElement, width: number) => {
      const from = parseFloat(th.style.width);
      th.style.width = `${width}px`;
      table.style.width = `${parseFloat(table.style.width) + width - from}px`;
    };
    /** The width the column takes with nothing in it wrapped, and no wider than the page. */
    const fitting = (th: HTMLTableCellElement) => {
      const held = { table: table.style.width, cols: heads.map((h) => h.style.width) };
      // Laid out freely and as wide as it likes, the table gives each column its longest line.
      delete table.dataset.sized;
      table.style.width = 'max-content';
      for (const h of heads) h.style.width = '';
      const width = th.getBoundingClientRect().width;
      table.dataset.sized = '';
      table.style.width = held.table;
      heads.forEach((h, i) => (h.style.width = held.cols[i]!));
      return Math.max(MIN_WIDTH, room() > 0 ? Math.min(width, room()) : width);
    };

    // A live edit that changed the columns leaves widths that fit nothing: start over.
    if (pinned() && heads.some((th) => !th.style.width)) release();

    const offs = heads.map((th) => {
      let grip = th.querySelector<HTMLSpanElement>(':scope > .leaf-col-grip');
      if (!grip) {
        grip = document.createElement('span');
        grip.className = 'leaf-col-grip';
        grip.setAttribute('aria-hidden', 'true');
        th.appendChild(grip);
      }
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        pin();
        const startX = e.clientX;
        const startWidth = parseFloat(th.style.width);
        const root = document.documentElement;
        let dragged = false;
        root.classList.add('leaf-col-resizing');
        grip.dataset.active = '';
        const onMove = (m: PointerEvent) => {
          if (!dragged && Math.abs(m.clientX - startX) < DRAG) return;
          dragged = true;
          let width = Math.max(MIN_WIDTH, startWidth + m.clientX - startX);
          // Near the page's edge the table's own edge lands on it exactly, so a table drawn out
          // to full width shows its right border instead of scrolling it a few pixels out of sight.
          const gap = room() - (parseFloat(table.style.width) + width - parseFloat(th.style.width));
          if (Math.abs(gap) <= SNAP && width + gap >= MIN_WIDTH) width += gap;
          setWidth(th, width);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          root.classList.remove('leaf-col-resizing');
          delete grip.dataset.active;
          if (!dragged) return;
          // The click that ends a drag is nobody's: not a reset here, and not a sort when the
          // pointer has come off the grip and is let go over the header cell. It comes at once
          // or not at all, so the next press (or the next turn of the loop) ends the wait.
          const swallow = (c: MouseEvent) => c.stopPropagation();
          const done = () => {
            window.removeEventListener('click', swallow, true);
            window.removeEventListener('pointerdown', done, true);
          };
          window.addEventListener('click', swallow, true);
          window.addEventListener('pointerdown', done, true);
          setTimeout(done);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      };
      // The grip sits in the header cell: a click on it is never a click to sort.
      const onClick = (e: MouseEvent) => {
        e.stopPropagation();
        if (!pinned()) return;
        const back = was.get(th);
        if (back !== undefined) setWidth(th, back);
        if (heads.every((h) => Math.abs(parseFloat(h.style.width) - (was.get(h) ?? NaN)) < 0.5))
          release();
      };
      // Its two clicks have already put the column back; now it takes the width of what it holds.
      const onDouble = (e: MouseEvent) => {
        e.stopPropagation();
        pin();
        setWidth(th, fitting(th));
      };
      grip.addEventListener('pointerdown', onDown);
      grip.addEventListener('click', onClick);
      grip.addEventListener('dblclick', onDouble);
      return () => {
        grip.removeEventListener('pointerdown', onDown);
        grip.removeEventListener('click', onClick);
        grip.removeEventListener('dblclick', onDouble);
      };
    });
    return () => offs.forEach((off) => off());
  }, [ref, content]);
}
