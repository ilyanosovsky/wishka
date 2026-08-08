import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { ProfileIdentity } from "./profile-identity";

/**
 * The three profile-edit server actions are mocked, so this suite covers the
 * sheet's own rules: what is savable, what the availability probe reports, and
 * that the link the copy button writes is built from NEXT_PUBLIC_APP_URL and
 * not from a hardcoded domain (§6.6 / states #3 + #5).
 */

const checkNicknameAction = vi.fn();
const updateNameAction = vi.fn();
const updateNicknameAction = vi.fn();

vi.mock("@/app/profile/actions", () => ({
  checkNicknameAction: (value: string) => checkNicknameAction(value),
  updateNameAction: (value: string) => updateNameAction(value),
  updateNicknameAction: (value: string) => updateNicknameAction(value),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const startUpload = vi.fn();
vi.mock("@/lib/uploadthing-client", () => ({
  useUploadThing: () => ({ startUpload }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  checkNicknameAction.mockResolvedValue("free");
  updateNameAction.mockResolvedValue({ ok: true });
  updateNicknameAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderIdentity(
  props?: Partial<React.ComponentProps<typeof ProfileIdentity>>,
) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ProfileIdentity
        name="Маша"
        image={null}
        nickname="masha"
        appUrl="https://preview.example.com"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function nicknameInput() {
  return screen.getByLabelText("Ник");
}

/** The sheet's confirm — the header also carries a «Сохранить» for the name. */
function saveButtons() {
  return screen.getAllByRole("button", { name: "Сохранить" });
}

describe("ProfileIdentity — public link", () => {
  it("builds the link from NEXT_PUBLIC_APP_URL, never from a hardcoded domain", () => {
    renderIdentity();
    expect(screen.getByText("preview.example.com/u/masha")).toBeInTheDocument();
    expect(screen.queryByText(/wishka\.app/)).not.toBeInTheDocument();
  });

  it("copies the absolute URL and confirms with a toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // `navigator.clipboard` is a getter-only property in happy-dom.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderIdentity();

    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://preview.example.com/u/masha",
      ),
    );
    expect(await screen.findByText("Ссылка скопирована")).toBeInTheDocument();
  });
});

describe("ProfileIdentity — name", () => {
  it("cannot save an unchanged or empty name", () => {
    renderIdentity();
    const save = saveButtons()[0];
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Имя"), {
      target: { value: "   " },
    });
    expect(save).toBeDisabled();
  });

  it("saves a changed name and refreshes", async () => {
    renderIdentity();
    fireEvent.change(screen.getByLabelText("Имя"), {
      target: { value: "Мария" },
    });
    fireEvent.click(saveButtons()[0]);

    await waitFor(() => expect(updateNameAction).toHaveBeenCalledWith("Мария"));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("ProfileIdentity — nickname sheet", () => {
  it("warns that the old link stops working", () => {
    renderIdentity();
    fireEvent.click(screen.getByRole("button", { name: /preview\.example/ }));
    expect(
      screen.getByText("Старая ссылка перестанет работать"),
    ).toBeInTheDocument();
  });

  it("refuses to save an invalid nickname and says why", async () => {
    renderIdentity();
    fireEvent.click(screen.getByRole("button", { name: /preview\.example/ }));
    fireEvent.change(nicknameInput(), { target: { value: "Ma sha" } });

    expect(
      screen.getByText("Только строчные буквы, цифры и дефисы, 3–30 символов"),
    ).toBeInTheDocument();
    expect(saveButtons()[1]).toBeDisabled();
    expect(checkNicknameAction).not.toHaveBeenCalled();
  });

  it("refuses to save the unchanged nickname", () => {
    renderIdentity();
    fireEvent.click(screen.getByRole("button", { name: /preview\.example/ }));
    expect(saveButtons()[1]).toBeDisabled();
  });

  it("reports a taken nickname from the debounced probe and keeps save disabled", async () => {
    checkNicknameAction.mockResolvedValue("taken");
    renderIdentity();
    fireEvent.click(screen.getByRole("button", { name: /preview\.example/ }));
    fireEvent.change(nicknameInput(), { target: { value: "ilya" } });

    await vi.advanceTimersByTimeAsync(500);

    expect(
      await screen.findByText("Ник занят — попробуй другой"),
    ).toBeInTheDocument();
    expect(saveButtons()[1]).toBeDisabled();
    expect(checkNicknameAction).toHaveBeenCalledWith("ilya");
  });

  it("saves a free nickname, lower-cased and trimmed", async () => {
    renderIdentity();
    fireEvent.click(screen.getByRole("button", { name: /preview\.example/ }));
    fireEvent.change(nicknameInput(), { target: { value: " Masha-2 " } });

    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(saveButtons()[1]).toBeEnabled());
    fireEvent.click(saveButtons()[1]);

    await waitFor(() =>
      expect(updateNicknameAction).toHaveBeenCalledWith("masha-2"),
    );
  });

  it("re-marks the field as taken when the write loses the race", async () => {
    updateNicknameAction.mockResolvedValue({ ok: false, error: "taken" });
    renderIdentity();
    fireEvent.click(screen.getByRole("button", { name: /preview\.example/ }));
    fireEvent.change(nicknameInput(), { target: { value: "masha-2" } });

    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(saveButtons()[1]).toBeEnabled());
    fireEvent.click(saveButtons()[1]);

    expect(
      await screen.findByText("Ник занят — попробуй другой"),
    ).toBeInTheDocument();
  });
});

describe("ProfileIdentity — avatar", () => {
  it("rejects a non-image without uploading", async () => {
    renderIdentity();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Это не картинка")).toBeInTheDocument();
    expect(startUpload).not.toHaveBeenCalled();
  });

  it("rejects a source file above the decode cap without uploading", async () => {
    renderIdentity();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Файл слишком большой")).toBeInTheDocument();
    expect(startUpload).not.toHaveBeenCalled();
  });
});
