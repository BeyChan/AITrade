"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function HashOpenDetails({
  id,
  className,
  defaultOpen,
  children,
}: {
  id: string;
  className: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const openTargetDetails = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash || !detailsRef.current) return;
      const target = document.getElementById(hash);
      if (target && (target === detailsRef.current || detailsRef.current.contains(target))) {
        detailsRef.current.open = true;
        // 稍作微任务延时确保展开后几何尺寸已计算
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    };

    openTargetDetails();
    window.addEventListener("hashchange", openTargetDetails);
    return () => window.removeEventListener("hashchange", openTargetDetails);
  }, []);

  return (
    <details ref={detailsRef} id={id} className={className} open={defaultOpen}>
      {children}
    </details>
  );
}
