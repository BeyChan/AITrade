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
      if (target && detailsRef.current.contains(target)) {
        detailsRef.current.open = true;
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
