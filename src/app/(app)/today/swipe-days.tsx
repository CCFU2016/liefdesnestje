"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Document-level swipe handler for navigating between days on Today.
// Swipe left → next day, swipe right → previous day. We only act on
// clearly-horizontal, fast-enough gestures so vertical scrolling and
// taps aren't hijacked. Swipes that start inside editable fields or
// interactive controls are ignored outright.
export function SwipeDays({
  prevDate,
  nextDate,
}: {
  prevDate: string;
  nextDate: string;
}) {
  const router = useRouter();

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let active = false;

    const isInteractive = (el: EventTarget | null): boolean => {
      if (!(el instanceof Element)) return false;
      return !!el.closest(
        'input, textarea, select, button, a, [role="button"], [contenteditable="true"], .ProseMirror'
      );
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        active = false;
        return;
      }
      if (isInteractive(e.target)) {
        active = false;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      active = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startTime;
      // Must be a deliberate horizontal flick: > 60px, more X than Y, < 700ms.
      if (dt > 700) return;
      if (Math.abs(dx) < 60) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) router.push(`/today?date=${nextDate}`);
      else router.push(`/today?date=${prevDate}`);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [prevDate, nextDate, router]);

  return null;
}
