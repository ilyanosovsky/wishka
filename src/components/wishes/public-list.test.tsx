import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import type { ViewerWish } from "@/db/access/types";
import { PublicList, type PublicListProps } from "./public-list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/u/ilya",
}));

// LocaleSwitcher (guest banner) imports the server action; stub it out.
vi.mock("@/i18n/actions", () => ({
  setLocale: vi.fn(async () => {}),
}));

function viewerWish(overrides: Partial<ViewerWish> = {}): ViewerWish {
  return {
    id: "w-1",
    ownerId: "owner-1",
    type: "product",
    title: "Керамическая ваза",
    url: null,
    imageKey: null,
    imageStatus: "none",
    description: null,
    priceType: "none",
    priceMin: null,
    priceMax: null,
    currency: null,
    priority: "nice",
    isDream: false,
    category: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    reservationStatus: "free",
    ...overrides,
  };
}

function renderPublicList(props: Partial<PublicListProps> = {}) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <PublicList
        name="ilya"
        nickname="ilya"
        wishes={[viewerWish()]}
        sizes={{}}
        tastes={[]}
        noGift={[]}
        isGuest={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("PublicList — guest vs friend chrome", () => {
  it("shows the guest banner and hides the tab bar for a guest", () => {
    renderPublicList({ isGuest: true });

    expect(screen.getByText("Вы смотрите список: ilya")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Создать свой" }),
    ).toBeInTheDocument();
    // No app chrome for anonymous visitors.
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows the tab bar and no guest banner for a logged-in viewer", () => {
    renderPublicList({ isGuest: false });

    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.queryByText("Вы смотрите список: ilya")).toBeNull();
  });
});

describe("PublicList — what matters block", () => {
  it("is omitted when the profile has no public parameters", () => {
    renderPublicList();
    expect(screen.queryByText("Что важно знать")).toBeNull();
  });

  it("appears when at least one parameter is set", () => {
    renderPublicList({ tastes: ["coffee"] });
    expect(screen.getByText("Что важно знать")).toBeInTheDocument();
  });
});

describe("PublicList — empty state", () => {
  it("shows the owner-empty message with a hint for a logged-in viewer", () => {
    renderPublicList({ wishes: [], isGuest: false });
    expect(screen.getByText("У ilya пока нет желаний")).toBeInTheDocument();
    expect(screen.getByText(/Загляни в «Что важно знать»/)).toBeInTheDocument();
  });

  it("drops the friend hint for a guest", () => {
    renderPublicList({ wishes: [], isGuest: true });
    expect(screen.getByText("У ilya пока нет желаний")).toBeInTheDocument();
    expect(screen.queryByText(/Загляни в «Что важно знать»/)).toBeNull();
  });
});
