"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const MIN_COL_WIDTH = 40;

export type ResizeHandle = {
  widths: number[];
  selected: Set<number>;
  tableRef: React.RefObject<HTMLTableElement | null>;
  startResize: (e: React.MouseEvent, colIdx: number) => void;
  autoFit: (colIdx: number) => void;
  /** Auto-fit `dataIndices` to content width; optionally size `noteIndices` to 1.5× the KPI (col 0) width. */
  autoFitIndices: (dataIndices: number[], noteIndices?: number[]) => void;
  toggleSelect: (e: React.MouseEvent, colIdx: number) => void;
  startDragSelect: (e: React.MouseEvent, colIdx: number) => void;
};

/**
 * Measure the minimum width a cell needs so its content fits on one line.
 *
 * Uses an off-screen text probe with the cell's exact computed font so the
 * measurement is independent of the current column width (avoids the
 * tableLayout:fixed / scrollWidth pitfall where scrollWidth === clientWidth).
 *
 * For cells that contain nested child elements (badges with a dot + padding,
 * buttons with icons, etc.) the innerText probe under-estimates by the extra
 * chrome. A 24px buffer covers the worst case: Status badge dot (6px) +
 * flex-gap (4px) + badge inline-padding (12px) + rounding ≈ 24px.
 */
function measureCellWidth(cell: HTMLElement): number {
  const text = cell.innerText?.trim();
  if (!text) return 0;

  const cs = window.getComputedStyle(cell);
  const paddingH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);

  const probe = document.createElement("span");
  probe.style.cssText = [
    "position:fixed",
    "top:-9999px",
    "left:-9999px",
    "visibility:hidden",
    "white-space:nowrap",
    `font-family:${cs.fontFamily}`,
    `font-size:${cs.fontSize}`,
    `font-weight:${cs.fontWeight}`,
    `font-style:${cs.fontStyle}`,
    `letter-spacing:${cs.letterSpacing}`,
  ].join(";");
  probe.textContent = text;
  document.body.appendChild(probe);
  const textWidth = probe.getBoundingClientRect().width;
  document.body.removeChild(probe);

  // Add buffer when cell has nested children (badge dot, icon, internal padding).
  // Skip absolutely-positioned children (e.g. resize handles) — they don't occupy
  // flow space. Find the first flow child, then check if it has element children.
  const firstFlowChild = Array.from(cell.children).find((child) => {
    const pos = window.getComputedStyle(child as HTMLElement).position;
    return pos !== "absolute" && pos !== "fixed";
  }) as HTMLElement | undefined;
  const hasNestedChildren = firstFlowChild?.firstElementChild != null;

  return Math.ceil(textWidth) + paddingH + (hasNestedChildren ? 24 : 0);
}

export function useResizableColumns(initialWidths: number[]): ResizeHandle {
  const [widths, setWidths] = useState<number[]>(() => [...initialWidths]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const tableRef = useRef<HTMLTableElement | null>(null);

  // Reset when column count changes (e.g. hasPlanData flips)
  useEffect(() => {
    setWidths([...initialWidths]);
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWidths.length]);

  const startResize = useCallback(
    (e: React.MouseEvent, colIdx: number) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const colsToResize =
        selected.size > 1 && selected.has(colIdx) ? [...selected] : [colIdx];
      const startWidths = colsToResize.map((ci) => widths[ci] ?? MIN_COL_WIDTH);

      const colEls = tableRef.current
        ? Array.from(tableRef.current.querySelectorAll<HTMLElement>("colgroup col"))
        : [];

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        const delta = ev.clientX - startX;
        colsToResize.forEach((ci, i) => {
          const newW = Math.max(MIN_COL_WIDTH, startWidths[i] + delta);
          if (colEls[ci]) colEls[ci].style.width = `${newW}px`;
        });
      }

      function onUp() {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setWidths(
          colEls.map((el) => {
            const w = parseFloat(el.style.width);
            return isNaN(w) || w < MIN_COL_WIDTH ? MIN_COL_WIDTH : w;
          })
        );
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [widths, selected]
  );

  const autoFit = useCallback(
    (colIdx: number) => {
      const table = tableRef.current;
      if (!table) return;

      const colsToFit =
        selected.size > 1 && selected.has(colIdx) ? [...selected] : [colIdx];

      let maxWidth = 0;
      for (const ci of colsToFit) {
        table
          .querySelectorAll<HTMLElement>(
            `tr th:nth-child(${ci + 1}), tr td:nth-child(${ci + 1})`
          )
          .forEach((cell) => {
            maxWidth = Math.max(maxWidth, measureCellWidth(cell));
          });
      }

      if (maxWidth < MIN_COL_WIDTH) return;

      const colEls = Array.from(
        table.querySelectorAll<HTMLElement>("colgroup col")
      );
      colsToFit.forEach((ci) => {
        if (colEls[ci]) colEls[ci].style.width = `${maxWidth}px`;
      });

      setWidths((prev) => {
        const next = [...prev];
        colsToFit.forEach((ci) => { next[ci] = maxWidth; });
        return next;
      });
    },
    [selected]
  );

  const autoFitIndices = useCallback(
    (dataIndices: number[], noteIndices?: number[]) => {
      const table = tableRef.current;
      if (!table) return;

      const colEls = Array.from(
        table.querySelectorAll<HTMLElement>("colgroup col")
      );
      const measured: Record<number, number> = {};

      for (const ci of dataIndices) {
        let maxW = MIN_COL_WIDTH;
        table
          .querySelectorAll<HTMLElement>(
            `tr th:nth-child(${ci + 1}), tr td:nth-child(${ci + 1})`
          )
          .forEach((cell) => {
            maxW = Math.max(maxW, measureCellWidth(cell));
          });
        if (colEls[ci]) colEls[ci].style.width = `${maxW}px`;
        measured[ci] = maxW;
      }

      if (noteIndices?.length) {
        const noteWidth = Math.round((measured[0] ?? MIN_COL_WIDTH) * 1.5);
        for (const ci of noteIndices) {
          if (colEls[ci]) colEls[ci].style.width = `${noteWidth}px`;
          measured[ci] = noteWidth;
        }
      }

      setWidths((prev) => {
        const next = [...prev];
        for (const [ciStr, w] of Object.entries(measured)) {
          next[Number(ciStr)] = w;
        }
        return next;
      });
    },
    []
  );

  const toggleSelect = useCallback(
    (e: React.MouseEvent, colIdx: number) => {
      setSelected((prev) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          const next = new Set(prev);
          if (next.has(colIdx)) next.delete(colIdx);
          else next.add(colIdx);
          return next;
        }
        if (prev.size === 1 && prev.has(colIdx)) return new Set();
        return new Set([colIdx]);
      });
    },
    []
  );

  const startDragSelect = useCallback(
    (e: React.MouseEvent, colIdx: number) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      setSelected((prev) => {
        const next = new Set(prev);
        next.add(colIdx);
        return next;
      });

      function colIdxFromPoint(x: number, y: number): number | null {
        const el = document.elementFromPoint(x, y);
        const th = el?.closest("[data-col-idx]") as HTMLElement | null;
        if (!th) return null;
        const idx = parseInt(th.dataset.colIdx ?? "", 10);
        return isNaN(idx) ? null : idx;
      }

      function onMove(ev: MouseEvent) {
        const idx = colIdxFromPoint(ev.clientX, ev.clientY);
        if (idx === null) return;
        setSelected((prev) => {
          if (prev.has(idx)) return prev;
          const next = new Set(prev);
          next.add(idx);
          return next;
        });
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    []
  );

  return { widths, selected, tableRef, startResize, autoFit, autoFitIndices, toggleSelect, startDragSelect };
}
