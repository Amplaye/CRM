"use client";

import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement } from "react";

type Props = { children: ReactElement<{ width?: number; height?: number }> };

export function ChartFrame({ children }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      if (w > 0 && h > 0) {
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      {size && isValidElement(children)
        ? cloneElement(children, { width: size.w, height: size.h })
        : null}
    </div>
  );
}
