"use client";

/**
 * "Edit as JSON" dialog for the flow editor.
 *
 * One textarea, prefilled with the current flow as JSON every time the
 * dialog opens. The user can Copy it out, or paste / edit and Apply it
 * back. Apply only replaces editor state (and flips `dirty`) — it does
 * NOT persist; the toolbar's Save does, same as any other edit.
 *
 * Parsing and auto-layout live in `@/lib/flows/json-io` so they stay
 * unit-testable outside React.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { flowToJson, parseFlowJson } from "@/lib/flows/json-io";
import { useFlowEditor } from "./flow-editor-state";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FlowJsonDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-3xl">
        {/* Remounted per open so the textarea always starts from the
            latest editor state, not a stale paste. */}
        {open && <JsonEditorBody onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function JsonEditorBody({ onDone }: { onDone: () => void }) {
  const t = useTranslations("Flows.header");
  const { state, setState } = useFlowEditor();
  const current = () => flowToJson(state);

  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("jsonCopied"));
    } catch {
      toast.error(t("jsonCopyFailed"));
    }
  };

  const apply = () => {
    const result = parseFlowJson(text, state);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setState((s) => ({ ...s, ...result.value }));
    toast.success(t("jsonApplied", { count: result.value.nodes.length }));
    onDone();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-popover-foreground">
          {t("jsonTitle")}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground">
          {t("jsonDesc")}
        </DialogDescription>
      </DialogHeader>

      {state.status === "active" && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-300">
          {t("jsonActiveWarning")}
        </p>
      )}

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        spellCheck={false}
        aria-label={t("jsonTitle")}
        aria-invalid={error ? true : undefined}
        // field-sizing-content would grow with every line; pin the
        // height so long flows scroll inside the box instead.
        className="h-[55vh] resize-none font-mono text-xs leading-relaxed [field-sizing:fixed] md:text-xs"
      />

      {error && (
        <p role="alert" className="text-[12.5px] text-red-400">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText(current());
            setError(null);
          }}
          className="sm:mr-auto"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("jsonReset")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          <Copy className="h-3.5 w-3.5" />
          {t("jsonCopy")}
        </Button>
        <Button size="sm" onClick={apply}>
          {t("jsonApply")}
        </Button>
      </DialogFooter>
    </>
  );
}
