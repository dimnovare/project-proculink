import { useConfirm } from "@/components/ui/confirm";

/**
 * The demoted bulk action: accept EVERY suggestion, low-confidence ones included, but only
 * after the shared confirm dialog. The normal action (>= BULK_ACCEPT_CONFIDENCE) needs none.
 */
export function useAcceptAllConfirm(accept: ((minConfidence: number) => void) | undefined, count: number) {
  const confirm = useConfirm();
  return async () => {
    const ok = await confirm({
      title: "Accept all suggestions, including low-confidence?",
      description: `${count} suggested supplier ${count === 1 ? "code" : "codes"} will be saved as they are, including ones the match is not sure about. You can still change any line afterwards.`,
      confirmLabel: `Accept ${count}`,
    });
    if (ok) accept?.(0);
  };
}
