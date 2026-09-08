import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface BackgroundState {
  ariaHidden: string | null;
  hadInert: boolean;
}

const openDialogBackdrops: HTMLElement[] = [];
const backgroundStates = new Map<HTMLElement, BackgroundState>();
let pendingReturnFocus: HTMLElement | null = null;

function restoreBackgroundElement(element: HTMLElement) {
  const state = backgroundStates.get(element);
  if (!state) return;

  if (state.hadInert) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }
  if (state.ariaHidden === null) {
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", state.ariaHidden);
  }
}

function makeBackgroundInert(element: HTMLElement) {
  if (!backgroundStates.has(element)) {
    backgroundStates.set(element, {
      ariaHidden: element.getAttribute("aria-hidden"),
      hadInert: element.hasAttribute("inert"),
    });
  }
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}

function synchronizeBackgroundInertness() {
  const activeBackdrop = openDialogBackdrops.at(-1);
  if (!activeBackdrop) {
    backgroundStates.forEach((_, element) => restoreBackgroundElement(element));
    backgroundStates.clear();
    return;
  }

  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child === activeBackdrop) {
      restoreBackgroundElement(child);
    } else {
      makeBackgroundInert(child);
    }
  }
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && !element.closest("[inert], [aria-hidden=\"true\"]"));
}

export interface AccessibleDialogProps {
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
  ariaDescribedby?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  closeOnEscape?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * A small modal dialog primitive for the control plane. It owns modal focus,
 * keyboard containment, Escape policy, and background inertness.
 */
export function AccessibleDialog({
  children,
  className,
  backdropClassName,
  ariaDescribedby,
  ariaLabel,
  ariaLabelledby,
  closeOnEscape = true,
  initialFocusRef,
  onClose,
  returnFocusRef,
}: AccessibleDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.key !== "Escape"
        || !closeOnEscape
        || !onClose
        || openDialogBackdrops.at(-1) !== backdropRef.current
      ) return;

      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [closeOnEscape, onClose]);

  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    const previouslyFocused = returnFocusRef?.current?.isConnected
      ? returnFocusRef.current
      : pendingReturnFocus?.isConnected
        ? pendingReturnFocus
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    pendingReturnFocus = null;
    if (!backdrop || !dialog) return;

    openDialogBackdrops.push(backdrop);
    synchronizeBackgroundInertness();

    const initialFocus = initialFocusRef?.current;
    const focusTarget = initialFocus ?? getFocusableElements(dialog)[0] ?? dialog;
    focusTarget.focus({ preventScroll: true });

    return () => {
      const index = openDialogBackdrops.lastIndexOf(backdrop);
      if (index >= 0) openDialogBackdrops.splice(index, 1);
      synchronizeBackgroundInertness();
      pendingReturnFocus = previouslyFocused;
      queueMicrotask(() => {
        if (openDialogBackdrops.length || pendingReturnFocus !== previouslyFocused) return;
        pendingReturnFocus = null;
        if (previouslyFocused?.isConnected && !previouslyFocused.closest("[inert], [aria-hidden=\"true\"]")) {
          previouslyFocused.focus({ preventScroll: true });
        }
      });
    };
  }, [initialFocusRef, returnFocusRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && closeOnEscape && onClose) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableElements = getFocusableElements(dialog);
    if (!focusableElements.length) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements.at(-1)!;
    const activeElement = document.activeElement;
    const activeIndex = activeElement instanceof HTMLElement
      ? focusableElements.indexOf(activeElement)
      : -1;
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (activeIndex === focusableElements.length - 1 || !dialog.contains(activeElement))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={backdropRef} className={backdropClassName}>
      <div
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-describedby={ariaDescribedby}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
