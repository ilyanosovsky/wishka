import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/ru.json";
import { AcceptInvitePanel } from "./accept-invite-panel";
import { acceptInviteAction } from "./actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock("./actions", () => ({
  acceptInviteAction: vi.fn(),
}));

const acceptInviteActionMock = vi.mocked(acceptInviteAction);
const GROUP_ID = "11111111-1111-4111-8111-111111111111";

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <AcceptInvitePanel token="token-1" groupName="Семья" groupEmoji="🎁" />
    </NextIntlClientProvider>,
  );
}

function accept() {
  fireEvent.click(screen.getByRole("button", { name: "Присоединиться" }));
}

describe("AcceptInvitePanel", () => {
  it("opens the group and hands it the confirmation", async () => {
    acceptInviteActionMock.mockResolvedValue({
      ok: true,
      groupId: GROUP_ID,
      groupName: "Семья",
      alreadyMember: false,
    });

    renderPanel();
    accept();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/groups/${GROUP_ID}`),
    );
    expect(
      JSON.parse(
        window.sessionStorage.getItem("wishka.groups.toast") ?? "null",
      ),
    ).toEqual({ kind: "joined", groupId: GROUP_ID });
  });

  it("keeps the retry in place when the action itself throws", async () => {
    // What a dropped connection — or a group deleted between render and tap —
    // looks like from here. The token may still be good, so the screen stays.
    acceptInviteActionMock.mockRejectedValue(new Error("connection lost"));

    renderPanel();
    accept();

    expect(
      await screen.findByText(
        "Не получилось присоединиться — попробуйте ещё раз",
      ),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Присоединиться" });
    expect(button).toBeEnabled();
    expect(push).not.toHaveBeenCalled();

    acceptInviteActionMock.mockResolvedValue({
      ok: true,
      groupId: GROUP_ID,
      groupName: "Семья",
      alreadyMember: false,
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/groups/${GROUP_ID}`),
    );
  });

  it("sends a dead invite to the same dead end the page would have", async () => {
    acceptInviteActionMock.mockResolvedValue({ ok: false, state: "revoked" });

    renderPanel();
    accept();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(window.sessionStorage.length).toBe(0);
  });

  it("accepts once however often it is tapped", async () => {
    let finish: () => void = () => {};
    acceptInviteActionMock.mockReturnValue(
      new Promise((resolve) => {
        finish = () =>
          resolve({
            ok: true,
            groupId: GROUP_ID,
            groupName: "Семья",
            alreadyMember: false,
          });
      }),
    );

    renderPanel();
    accept();

    const button = screen.getByRole("button", { name: "Заходим…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(acceptInviteActionMock).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/groups/${GROUP_ID}`),
    );
  });
});
