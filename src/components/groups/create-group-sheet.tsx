"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { createGroupAction } from "@/app/groups/actions";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { InfoToast } from "@/components/ui/toast";
import { GroupAppearanceFields } from "./group-appearance-fields";
import { setPendingGroupToast } from "./pending-toast";

/**
 * «Новая группа» (§6.7). Only the name is required; emoji and colour are the
 * decoration that makes the group recognisable in a list.
 *
 * A created group opens immediately and asks for the invite link on arrival —
 * §6.7 ends creation in the share sheet, and the link lives on the detail
 * screen, so the intent is handed over rather than the sheet opened here.
 */

export type CreateGroupSheetProps = {
  open: boolean;
  onClose: () => void;
};

export function CreateGroupSheet({ open, onClose }: CreateGroupSheetProps) {
  const t = useTranslations();
  const router = useRouter();

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function close() {
    if (saving) return;
    setNameError(false);
    onClose();
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    setSaving(true);
    try {
      const result = await createGroupAction({ name: trimmed, emoji, color });
      if (result.ok) {
        setPendingGroupToast({ kind: "created", groupId: result.group.id });
        // The sheet stays in its "creating" state until the route changes —
        // resetting it here would flash an empty form over the old screen.
        router.push(`/groups/${result.group.id}`);
        return;
      }
      setSaving(false);
      if (result.error === "name") setNameError(true);
      else setFailed(true);
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  return (
    <>
      <BottomSheet
        open={open}
        onClose={close}
        title={t("groups.createTitle")}
        footer={
          <>
            <Button className="flex-1" disabled={saving} onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={saving}
              onClick={() => void submit()}
            >
              {saving ? t("groups.creating") : t("groups.createCta")}
            </Button>
          </>
        }
      >
        <TextField
          label={t("groups.nameLabel")}
          placeholder={t("groups.namePlaceholder")}
          value={name}
          error={nameError}
          helperText={t("groups.nameRequired")}
          maxLength={60}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(false);
          }}
        />
        <div className="pt-3">
          <GroupAppearanceFields
            emoji={emoji}
            color={color}
            onEmojiChange={setEmoji}
            onColorChange={setColor}
          />
        </div>
      </BottomSheet>

      <InfoToast
        open={failed}
        message={t("common.actionFailed")}
        onDismiss={() => setFailed(false)}
      />
    </>
  );
}
