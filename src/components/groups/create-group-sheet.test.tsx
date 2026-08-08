import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { createGroupAction } from "@/app/groups/actions";
import { CreateGroupSheet } from "./create-group-sheet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock("@/app/groups/actions", () => ({
  createGroupAction: vi.fn(),
}));

const createGroupActionMock = vi.mocked(createGroupAction);

function renderSheet() {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <CreateGroupSheet open onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("CreateGroupSheet", () => {
  it("refuses to submit a nameless group", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    expect(screen.getByText("Без названия не сохранить")).toBeInTheDocument();
    expect(createGroupActionMock).not.toHaveBeenCalled();
  });

  it("sends the trimmed name with the chosen emoji and opens the new group", async () => {
    createGroupActionMock.mockResolvedValue({
      ok: true,
      group: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Семья",
        emoji: "🎁",
        color: null,
        role: "admin",
        memberCount: 1,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    renderSheet();

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "  Семья  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "🎁" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() =>
      expect(createGroupActionMock).toHaveBeenCalledWith({
        name: "Семья",
        emoji: "🎁",
        color: null,
      }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/groups/33333333-3333-4333-8333-333333333333",
      ),
    );
  });

  it("clears a chosen emoji when it is tapped again", async () => {
    createGroupActionMock.mockResolvedValue({ ok: false, error: "name" });

    renderSheet();

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Друзья" },
    });
    const emoji = screen.getByRole("button", { name: "🎁" });
    fireEvent.click(emoji);
    fireEvent.click(emoji);
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() =>
      expect(createGroupActionMock).toHaveBeenCalledWith({
        name: "Друзья",
        emoji: null,
        color: null,
      }),
    );
  });
});
