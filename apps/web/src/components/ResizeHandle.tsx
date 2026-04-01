import { useEffect, useRef } from "react";

const KEYBOARD_STEP = 10;

export function ResizeHandle({
  onCommit,
  targetRef,
  min,
  max,
  invert,
}: {
  onCommit: (totalDelta: number) => void;
  targetRef: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  invert?: boolean;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onCommitRef = useRef(onCommit);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    const startWidth = targetRef.current?.offsetWidth ?? 0;
    let accumulated = 0;

    function onMouseMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      accumulated += delta;

      if (targetRef.current) {
        const effectiveDelta = invert ? -accumulated : accumulated;
        const newWidth = Math.max(
          min,
          Math.min(startWidth + effectiveDelta, max),
        );
        targetRef.current.style.width = `${newWidth}px`;
      }
    }

    function onMouseUp() {
      dragging.current = false;
      cleanupRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommitRef.current(accumulated);
    }

    cleanupRef.current = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!targetRef.current) return;

    let delta = 0;
    if (e.key === "ArrowLeft") {
      delta = -KEYBOARD_STEP;
    } else if (e.key === "ArrowRight") {
      delta = KEYBOARD_STEP;
    } else {
      return;
    }

    e.preventDefault();
    const currentWidth = targetRef.current.offsetWidth;
    const effectiveDelta = invert ? -delta : delta;
    const newWidth = Math.max(
      min,
      Math.min(currentWidth + effectiveDelta, max),
    );
    targetRef.current.style.width = `${newWidth}px`;
    onCommitRef.current(delta);
  }

  return (
    <div
      className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent"
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={min}
      aria-valuemax={max}
    />
  );
}

export function ResizeHandleVertical({
  onCommit,
  targetRef,
  min,
  max,
}: {
  onCommit: (totalDelta: number) => void;
  targetRef: React.RefObject<HTMLDivElement | null>;
  min: number;
  max: number;
}) {
  const dragging = useRef(false);
  const lastY = useRef(0);
  const onCommitRef = useRef(onCommit);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    lastY.current = e.clientY;
    const startHeight = targetRef.current?.offsetHeight ?? 0;
    let accumulated = 0;

    function onMouseMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = ev.clientY - lastY.current;
      lastY.current = ev.clientY;
      accumulated += delta;

      // Direct DOM manipulation — no React re-render during drag
      if (targetRef.current) {
        const newHeight = Math.max(
          min,
          Math.min(startHeight - accumulated, max),
        );
        targetRef.current.style.height = `${newHeight}px`;
      }
    }

    function onMouseUp() {
      dragging.current = false;
      cleanupRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Commit final delta to React state
      onCommitRef.current(accumulated);
    }

    cleanupRef.current = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!targetRef.current) return;

    const currentHeight = targetRef.current.offsetHeight;
    let newHeight = currentHeight;

    if (e.key === "ArrowUp") {
      newHeight = Math.min(max, currentHeight + KEYBOARD_STEP);
    } else if (e.key === "ArrowDown") {
      newHeight = Math.max(min, currentHeight - KEYBOARD_STEP);
    } else {
      return;
    }

    if (newHeight === currentHeight) return;

    e.preventDefault();
    targetRef.current.style.height = `${newHeight}px`;
    onCommitRef.current(currentHeight - newHeight);
  }

  return (
    <div
      className="flex h-1.5 shrink-0 cursor-row-resize items-center justify-center hover:bg-accent/50 active:bg-accent"
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panel height"
      aria-valuemin={min}
      aria-valuemax={max}
    />
  );
}
