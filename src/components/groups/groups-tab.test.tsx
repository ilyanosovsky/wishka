import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import type { GroupSummary } from "@/db/access/groups";
import { GroupsTab } from "./groups-tab";
import { setPendingGroupToast } from "./pending-toast";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/groups/actions", () => ({
  createGroupAction: vi.fn(async () => ({ ok: false, error: "name" })),
}));

beforeEach(() => {
  window.sessionStorage.clear();
});

function group(overrides: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Семья",
    emoji: "🎁",
    color: "accent",
    role: "admin",
    memberCount: 2,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function renderTab(groups: GroupSummary[]) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <GroupsTab groups={groups} />
    </NextIntlClientProvider>,
  );
}

describe("GroupsTab", () => {
  it("offers both ways into a group when there are none", () => {
    renderTab([]);

    expect(
      screen.getByText("Группы — чтобы видеть списки близких в одном месте"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Создать группу" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "У меня есть приглашение" }),
    ).toBeInTheDocument();
  });

  it("explains that an invite is a link instead of asking for a code", () => {
    renderTab([]);

    const hintCta = screen.getByRole("button", {
      name: "У меня есть приглашение",
    });
    expect(
      screen.queryByText(
        "Открой ссылку из письма или сообщения — она приведёт в группу.",
      ),
    ).toBeNull();

    fireEvent.click(hintCta);

    expect(
      screen.getByText(
        "Открой ссылку из письма или сообщения — она приведёт в группу.",
      ),
    ).toBeInTheDocument();
    // No code field anywhere — invites are links only.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("lists groups with their size and links to each one", () => {
    renderTab([
      group(),
      group({
        id: "22222222-2222-4222-8222-222222222222",
        name: "Друзья",
        memberCount: 5,
      }),
    ]);

    expect(screen.getByRole("link", { name: /Семья/ })).toHaveAttribute(
      "href",
      "/groups/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByText("2 участника")).toBeInTheDocument();
    expect(screen.getByText("5 участников")).toBeInTheDocument();
  });

  it("picks up the confirmation left behind by leaving a group", async () => {
    setPendingGroupToast("left");

    renderTab([]);

    expect(await screen.findByText("Вы вышли из группы")).toBeInTheDocument();
    // Read once: a later visit to /people must stay quiet.
    expect(window.sessionStorage.length).toBe(0);
  });

  it("shows the delete confirmation the same way", async () => {
    setPendingGroupToast("deleted");

    renderTab([group()]);

    expect(await screen.findByText("Группа удалена")).toBeInTheDocument();
  });
});
