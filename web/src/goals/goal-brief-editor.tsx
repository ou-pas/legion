// Editing a `draft` goal's BRIEF (name and request), in a MODAL rather than inline in the right
// column: the request is the page's longest text (the DoD derives from it), and rereading it in a
// 300 px field was fixing it through an arrow slit. The modal takes the composer's width, so creating
// and editing show the same form at the same scale.
//
// PRESENTATIONAL: no React Query, no API. `GoalAside` calls the PATCH, so a story renders every state
// without mounting half the app.
import { useState } from "react";
import { Save } from "lucide-react";
import type { GoalPatch } from "../api/goals.js";
import { Button } from "../ui/button.js";
import { Spacer, Stack } from "../ui/flex.js";
import { Modal } from "../ui/modal.js";
import { Text } from "../ui/text.js";
import { GoalBriefFields } from "./goal-brief-fields.js";
import { GOAL_TEXT } from "./text.js";

export function GoalBriefEditor({
  name,
  request,
  pending = false,
  onSave,
  onClose,
}: {
  name: string;
  request: string;
  pending?: boolean;
  onSave: (patch: GoalPatch) => void;
  onClose: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftRequest, setDraftRequest] = useState(request);
  const complete = Boolean(draftName.trim() && draftRequest.trim());

  return (
    <Modal
      title={GOAL_TEXT.edit.briefTitle}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Spacer />
          <Button onClick={onClose}>{GOAL_TEXT.edit.cancel}</Button>
          <Button
            variant="primary"
            leading={<Save size={12} />}
            loading={pending}
            disabled={!complete}
            onClick={() => onSave({ name: draftName.trim(), request: draftRequest.trim() })}
          >
            {pending ? GOAL_TEXT.edit.saving : GOAL_TEXT.edit.save}
          </Button>
        </>
      }
    >
      <Stack gap={12}>
        {/* What saving takes WITH it: changing the request clears the shown DoD and has the server
            regenerate it. Announced before the click, never suffered after. */}
        <Text size="sm" tone="muted">
          {GOAL_TEXT.edit.briefWhy}
        </Text>
        <GoalBriefFields
          autoFocus
          rows={10}
          name={draftName}
          request={draftRequest}
          onName={setDraftName}
          onRequest={setDraftRequest}
        />
      </Stack>
    </Modal>
  );
}
