import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import {
  EVERYONE_AUDIENCE,
  VisibilitySheet,
  type AudienceOptions,
  type WishAudienceValue,
} from "./visibility-sheet";

afterEach(cleanup);

const CANDIDATES: AudienceOptions = {
  groups: [
    { id: "g-1", name: "Семья", emoji: "👨‍👩‍👧", color: "accent" },
    { id: "g-2", name: "Коллеги", emoji: null, color: null },
  ],
  people: [
    { userId: "u-partner", name: "Аня", image: null, isPartner: true },
    { userId: "u-2", name: "Борис", image: null, isPartner: false },
  ],
};

function renderSheet(
  props: Partial<Parameters<typeof VisibilitySheet>[0]> = {},
) {
  const onConfirm = props.onConfirm ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <VisibilitySheet
        open
        onClose={onClose}
        value={props.value ?? EVERYONE_AUDIENCE}
        candidates={props.candidates ?? CANDIDATES}
        onConfirm={onConfirm}
      />
    </NextIntlClientProvider>,
  );
  return { onConfirm, onClose };
}

describe("VisibilitySheet — modes", () => {
  it("offers all three modes and marks the current one", () => {
    renderSheet();

    expect(screen.getByRole("radio", { name: "Всем" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Группам" })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Отдельным людям" }),
    ).toBeInTheDocument();
  });

  it("hides the groups mode entirely when the owner has no groups", () => {
    renderSheet({ candidates: { groups: [], people: CANDIDATES.people } });

    expect(screen.queryByRole("radio", { name: "Группам" })).toBeNull();
    expect(screen.getByText("Групп пока нет")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Создать группу" }),
    ).toHaveAttribute("href", "/people");
  });

  it("keeps the groups mode when it is the wish's current one, even with no candidates left", () => {
    // The owner left the group the wish is restricted to: confirming must
    // still be a deliberate choice, never a silent rewrite.
    renderSheet({
      candidates: { groups: [], people: CANDIDATES.people },
      value: { mode: "restricted", groupIds: ["g-gone"], userIds: [] },
    });

    expect(screen.getByRole("radio", { name: "Группам" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("VisibilitySheet — confirming", () => {
  it("sends the picked groups as a restricted audience", () => {
    const { onConfirm, onClose } = renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Группам" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Семья/ }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "restricted",
      groupIds: ["g-1"],
      userIds: [],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("sends the picked people as a restricted audience", () => {
    const { onConfirm } = renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Отдельным людям" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Борис/ }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "restricted",
      groupIds: [],
      userIds: ["u-2"],
    });
  });

  it("blocks an empty restricted audience instead of hiding the wish", () => {
    const { onConfirm, onClose } = renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Отдельным людям" }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(
      screen.getByText(
        "Выбери хотя бы одного — иначе желание увидишь только ты",
      ),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears every subject when going back to everyone", () => {
    const value: WishAudienceValue = {
      mode: "restricted",
      groupIds: ["g-1"],
      userIds: [],
    };
    const { onConfirm } = renderSheet({ value });

    fireEvent.click(screen.getByRole("radio", { name: "Всем" }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "everyone",
      groupIds: [],
      userIds: [],
    });
  });

  it("de-selects a subject when tapped twice", () => {
    const { onConfirm } = renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Группам" }));
    const family = screen.getByRole("checkbox", { name: /Семья/ });
    fireEvent.click(family);
    fireEvent.click(family);

    expect(family).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancelling confirms nothing", () => {
    const { onConfirm, onClose } = renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Группам" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Семья/ }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("VisibilitySheet — subjects the owner can no longer address", () => {
  // A stale id has no row to untick, so seeding it would ride along on every
  // later confirm and get the whole save rejected as `invalid_subject`.
  it("drops a group the owner has left instead of adding it to the picked ones", () => {
    const { onConfirm } = renderSheet({
      value: { mode: "restricted", groupIds: ["g-gone"], userIds: [] },
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Семья/ }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "restricted",
      groupIds: ["g-1"],
      userIds: [],
    });
  });

  it("drops a person who is no longer a candidate", () => {
    const { onConfirm } = renderSheet({
      value: { mode: "restricted", groupIds: [], userIds: ["u-gone"] },
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Борис/ }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "restricted",
      groupIds: [],
      userIds: ["u-2"],
    });
  });

  it("asks for a subject rather than confirming a stale one on its own", () => {
    const { onConfirm } = renderSheet({
      candidates: { groups: [], people: CANDIDATES.people },
      value: { mode: "restricted", groupIds: ["g-gone"], userIds: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(
      screen.getByText(
        "Выбери хотя бы одного — иначе желание увидишь только ты",
      ),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("VisibilitySheet — people", () => {
  it("marks the partner and filters by the search field", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Отдельным людям" }));
    expect(screen.getByRole("checkbox", { name: /Аня/ })).toHaveTextContent(
      "Партнёр",
    );

    fireEvent.change(screen.getByLabelText("Поиск по участникам"), {
      target: { value: "бор" },
    });

    expect(screen.getByRole("checkbox", { name: /Борис/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Аня/ })).toBeNull();
  });

  it("says there is nobody to pick when the owner's groups are empty of people", () => {
    renderSheet({ candidates: { groups: CANDIDATES.groups, people: [] } });

    fireEvent.click(screen.getByRole("radio", { name: "Отдельным людям" }));

    expect(
      screen.getByText("Пока некого выбрать — сначала позови людей в группу"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Поиск по участникам")).toBeNull();
  });
});

describe("VisibilitySheet — narrowing note", () => {
  // Invariant #1: a note that showed up only when a booking existed would tell
  // the owner one exists. It is unconditional in every mode.
  it.each([
    ["Всем", EVERYONE_AUDIENCE],
    [
      "Группам",
      {
        mode: "restricted",
        groupIds: ["g-1"],
        userIds: [],
      } as WishAudienceValue,
    ],
    [
      "Отдельным людям",
      {
        mode: "restricted",
        groupIds: [],
        userIds: ["u-2"],
      } as WishAudienceValue,
    ],
  ])("renders in the %s mode", (_mode, value) => {
    renderSheet({ value });

    expect(
      screen.getByText(
        "Если после сужения даритель потеряет доступ — бронь всё равно останется за ним, и мы пришлём ему письмо.",
      ),
    ).toBeInTheDocument();
  });
});
