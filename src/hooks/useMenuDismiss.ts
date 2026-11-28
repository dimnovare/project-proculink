import { useEffect } from "react";

/**
 * Shared dismiss behavior for the sidebar's anchored menus: click outside
 * (excluding the trigger) and Escape both close; Escape returns focus to the
 * trigger. Shared by OrgSwitcher, UserChipMenu and the language menus so they behave identically.
 * Lives outside OrgSwitcher so public pages can use it without pulling in Clerk.
 */
export function useMenuDismiss(
  open: boolean,
  close: () => void,
  triggerRef: React.RefObject<HTMLElement | null>,
  menuRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, close, triggerRef, menuRef]);
}
