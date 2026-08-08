import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import {
  createInviteLinkAction,
  leaveGroupAction,
  removeMemberAction,
  revokeInviteLinkAction,
} from "@/app/groups/actions";
import type { GroupDetail as GroupDetailData } from "@/db/access/groups";
import { GroupDetail } from "./group-detail";
import { setPendingGroupToast } from "./pending-toast";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/app/groups/actions", () => ({
  createInviteLinkAction: vi.fn(),
  deleteGroupAction: vi.fn(),
  leaveGroupAction: vi.fn(),
  removeMemberAction: vi.fn(),
  revokeInviteLinkAction: vi.fn(),
  updateGroupAction: vi.fn(),
}));

const GROUP_ID = "11111111-1111-4111-8111-111111111111";

function detail(overrides: Partial<GroupDetailData> = {}): GroupDetailData {
  return {
    id: GROUP_ID,
    name: "Семья",
    emoji: "🎁",
    color: "accent",
    role: "admin",
    members: [
      {
        userId: "me",
        name: "Илья",
        image: null,
        nickname: "ilya",
        role: "admin",
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        hasVisibleWishes: true,
      },
      {
        userId: "masha",
        name: "Маша",
        image: null,
        nickname: "masha",
        role: "member",
        joinedAt: new Date("2026-01-02T00:00:00.000Z"),
        hasVisibleWishes: true,
      },
      {
        userId: "petya",
        name: "Петя",
        image: null,
        nickname: null,
        role: "member",
        joinedAt: new Date("2026-01-03T00:00:00.000Z"),
        hasVisibleWishes: false,
      },
    ],
    ...overrides,
  };
}

function renderDetail(group: GroupDetailData = detail()) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <GroupDetail group={group} viewerId="me" />
    </NextIntlClientProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Меню группы" }));
}

describe("GroupDetail", () => {
  it("links only to the members whose list the viewer can actually see", () => {
    renderDetail();

    expect(screen.getByRole("link", { name: /Маша/ })).toHaveAttribute(
      "href",
      "/u/masha",
    );
    expect(screen.getByText("Список пока пуст")).toBeInTheDocument();
    // The viewer's own row is never a link — their list is the home screen.
    expect(screen.queryByRole("link", { name: /Илья/ })).toBeNull();
  });

  it("marks the viewer and the admins", () => {
    renderDetail();

    expect(screen.getByText("Вы")).toBeInTheDocument();
    expect(screen.getByText("Админ")).toBeInTheDocument();
    expect(screen.getByText("3 участника")).toBeInTheDocument();
  });

  it("keeps the v2 slot visible but inert", () => {
    renderDetail();

    const placeholder = screen.getByText("Тайный Санта и события");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder.closest("button")).toBeNull();
    expect(placeholder.closest("a")).toBeNull();
  });

  it("offers deletion and exclusion to an admin only", () => {
    renderDetail();
    openMenu();

    expect(
      screen.getByRole("button", { name: "Удалить группу" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Исключить" })).toHaveLength(
      2,
    );
  });

  it("hides admin-only actions from a plain member", () => {
    renderDetail(detail({ role: "member" }));
    openMenu();

    expect(screen.queryByRole("button", { name: "Удалить группу" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Исключить" })).toBeNull();
    // Rename and appearance stay open to everyone (§6.7).
    expect(
      screen.getByRole("button", { name: "Переименовать" }),
    ).toBeInTheDocument();
  });

  it("spells out the visibility consequence before leaving, then hands the toast to /people", async () => {
    vi.mocked(leaveGroupAction).mockResolvedValue({
      ok: true,
      groupDeleted: false,
    });

    renderDetail();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Покинуть группу" }));

    expect(
      screen.getByText(
        "Желания, видимые только этой группе, станут ей недоступны.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Покинуть" }));

    await waitFor(() =>
      expect(leaveGroupAction).toHaveBeenCalledWith(GROUP_ID),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/people"));
    expect(
      JSON.parse(
        window.sessionStorage.getItem("wishka.groups.toast") ?? "null",
      ),
    ).toEqual({ kind: "left" });
  });

  it("confirms an exclusion with the same warning and reports it", async () => {
    vi.mocked(removeMemberAction).mockResolvedValue({ ok: true });

    renderDetail();
    fireEvent.click(screen.getAllByRole("button", { name: "Исключить" })[0]);

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Желания, видимые только этой группе, станут ему недоступны.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Исключить" }));

    await waitFor(() =>
      expect(removeMemberAction).toHaveBeenCalledWith(GROUP_ID, "masha"),
    );
    expect(await screen.findByText("Участник исключён")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("hands the invite link to the share sheet", async () => {
    vi.mocked(createInviteLinkAction).mockResolvedValue({
      ok: true,
      url: "https://wishka.app/invite/token-1",
    });

    renderDetail();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Ссылка-приглашение" }));

    await waitFor(() =>
      expect(createInviteLinkAction).toHaveBeenCalledWith(GROUP_ID),
    );
    expect(
      await screen.findByText("https://wishka.app/invite/token-1"),
    ).toBeInTheDocument();
  });

  it("offers the invite next to the members, nudging a group of one", async () => {
    vi.mocked(createInviteLinkAction).mockResolvedValue({
      ok: true,
      url: "https://wishka.app/invite/token-1",
    });

    renderDetail(detail({ members: [detail().members[0]] }));

    expect(
      screen.getByText("Позови близких — их списки появятся здесь."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Пригласить" }));

    expect(
      await screen.findByText("https://wishka.app/invite/token-1"),
    ).toBeInTheDocument();
  });

  it("drops the nudge once the group has company", () => {
    renderDetail();

    expect(
      screen.getByRole("button", { name: "Пригласить" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Позови близких — их списки появятся здесь."),
    ).toBeNull();
  });

  it("names the viewer's role in the header", () => {
    renderDetail();
    expect(screen.getByText(/Вы админ/)).toBeInTheDocument();

    cleanup();
    renderDetail(detail({ role: "member" }));
    expect(screen.queryByText(/Вы админ/)).toBeNull();
  });

  it("lets an admin kill a leaked link, after saying what that costs", async () => {
    vi.mocked(revokeInviteLinkAction).mockResolvedValue({ ok: true });

    renderDetail();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Отозвать ссылку" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Старая ссылка перестанет работать. Новую можно создать в любой момент.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Отозвать ссылку" }),
    );

    await waitFor(() =>
      expect(revokeInviteLinkAction).toHaveBeenCalledWith(GROUP_ID),
    );
    expect(await screen.findByText("Ссылка отозвана")).toBeInTheDocument();
  });

  it("does not offer revocation to a plain member", () => {
    renderDetail(detail({ role: "member" }));
    openMenu();

    expect(
      screen.queryByRole("button", { name: "Отозвать ссылку" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ссылка-приглашение" }),
    ).toBeInTheDocument();
  });

  it("closes the exclusion dialog before the round trip and ignores a second tap", async () => {
    let finish: (result: { ok: boolean }) => void = () => {};
    vi.mocked(removeMemberAction).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    renderDetail();
    fireEvent.click(screen.getAllByRole("button", { name: "Исключить" })[0]);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Исключить",
      }),
    );

    // Nothing to tap twice: the dialog is gone the moment the call starts, and
    // the row that opened it is inert until the call comes back.
    expect(screen.queryByRole("dialog")).toBeNull();
    const row = screen.getAllByRole("button", { name: "Исключить" })[0];
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(removeMemberAction).toHaveBeenCalledTimes(1);

    finish({ ok: true });
    expect(await screen.findByText("Участник исключён")).toBeInTheDocument();
    expect(screen.queryByText("Не получилось — попробуй ещё раз")).toBeNull();
  });

  it("ignores a second confirmation of leaving while the first is in flight", async () => {
    let finish: (result: {
      ok: boolean;
      groupDeleted: boolean;
    }) => void = () => {};
    vi.mocked(leaveGroupAction).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    renderDetail();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Покинуть группу" }));
    fireEvent.click(screen.getByRole("button", { name: "Покинуть" }));

    expect(screen.queryByRole("dialog")).toBeNull();

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Покинуть группу" }));
    fireEvent.click(screen.getByRole("button", { name: "Покинуть" }));

    expect(leaveGroupAction).toHaveBeenCalledTimes(1);

    finish({ ok: true, groupDeleted: false });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/people"));
  });

  it("opens the share sheet when it is reached straight from creation", async () => {
    vi.mocked(createInviteLinkAction).mockResolvedValue({
      ok: true,
      url: "https://wishka.app/invite/token-1",
    });
    setPendingGroupToast({ kind: "created", groupId: GROUP_ID });

    renderDetail();

    expect(
      await screen.findByText("https://wishka.app/invite/token-1"),
    ).toBeInTheDocument();
    // Claimed once: a reload of the same group must not re-open the sheet.
    expect(window.sessionStorage.length).toBe(0);
  });

  it("confirms a join on arrival", async () => {
    setPendingGroupToast({ kind: "joined", groupId: GROUP_ID });

    renderDetail();

    expect(await screen.findByText("Вы в группе «Семья»")).toBeInTheDocument();
    expect(createInviteLinkAction).not.toHaveBeenCalled();
  });

  it("leaves a handoff addressed to another group alone", () => {
    setPendingGroupToast({
      kind: "created",
      groupId: "99999999-9999-4999-8999-999999999999",
    });

    renderDetail();

    expect(createInviteLinkAction).not.toHaveBeenCalled();
  });
});
