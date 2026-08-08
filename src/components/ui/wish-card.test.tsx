import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { WishCard, type BaseWish } from "./wish-card";

const wish: BaseWish = {
  title: "Керамическая ваза",
  imageUrl: "https://storage.test/vase.webp",
  imageStatus: "ready",
  category: "Дом",
  priceType: "exact",
  priceMin: "2400",
  priceMax: null,
  currency: "GEL",
  priority: "want",
  isDream: false,
};

function renderIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const RESERVATION_LABELS = [
  "Свободно",
  "Забронировано",
  "Забронировано вами",
  "Подарено",
];

describe("WishCard types", () => {
  it("refuses reservation data on the owner card", () => {
    const element = (
      <WishCard
        role="owner"
        // @ts-expect-error owner card must not accept reservation data
        reservationStatus="free"
        wish={wish}
      />
    );
    expect(element).toBeTruthy();
  });

  it("requires a reservation status on the viewer card", () => {
    // @ts-expect-error viewer card requires reservationStatus
    const element = <WishCard role="viewer" wish={wish} />;
    expect(element).toBeTruthy();
  });
});

describe("WishCard surprise invariant", () => {
  it("renders no reservation badge for the owner", () => {
    renderIntl(<WishCard role="owner" wish={wish} />);
    for (const label of RESERVATION_LABELS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("renders no reservation badge for the owner of a restricted wish", () => {
    renderIntl(<WishCard role="owner" restrictedVisibility wish={wish} />);
    expect(screen.getByLabelText("Видно не всем")).toBeInTheDocument();
    for (const label of RESERVATION_LABELS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

describe("WishCard viewer states", () => {
  it("shows the free badge", () => {
    renderIntl(<WishCard role="viewer" reservationStatus="free" wish={wish} />);
    expect(screen.getByText("Свободно")).toBeInTheDocument();
  });

  it("shows the reserved badge", () => {
    renderIntl(
      <WishCard role="viewer" reservationStatus="reserved" wish={wish} />,
    );
    expect(screen.getByText("Забронировано")).toBeInTheDocument();
  });

  it("shows the reserved-by-you badge", () => {
    renderIntl(
      <WishCard
        role="viewer"
        reservationStatus="reserved_by_you"
        wish={wish}
      />,
    );
    expect(screen.getByText("Забронировано вами")).toBeInTheDocument();
    expect(screen.queryByText("Забронировано")).toBeNull();
  });
});

describe("WishCard wish content", () => {
  it("renders the dream stamp", () => {
    renderIntl(<WishCard role="owner" wish={{ ...wish, isDream: true }} />);
    expect(screen.getByText("Мечта")).toBeInTheDocument();
  });

  it("renders the formatted price and priority", () => {
    renderIntl(<WishCard role="owner" wish={wish} />);
    expect(screen.getByText("2 400 ₾")).toBeInTheDocument();
    // Cards use the short priority labels (wish.priorityCard.*) — the full
    // ones don't fit next to a price at narrow grid widths.
    expect(screen.getByText("Хочу")).toBeInTheDocument();
  });

  it("renders the null pill when there is no price", () => {
    renderIntl(
      <WishCard
        role="owner"
        wish={{ ...wish, priceType: "none", priceMin: null, currency: null }}
      />,
    );
    expect(screen.getByText("нет цены")).toBeInTheDocument();
  });

  it("shows the generating caption while the image is being drawn", () => {
    renderIntl(
      <WishCard
        role="owner"
        wish={{ ...wish, imageStatus: "generating", imageUrl: null }}
      />,
    );
    expect(screen.getByText("Рисуем…")).toBeInTheDocument();
  });

  it("offers retry and upload when the image failed, and fires both", async () => {
    const onRetryImage = vi.fn();
    const onUploadImage = vi.fn();
    renderIntl(
      <WishCard
        role="owner"
        wish={{ ...wish, imageStatus: "failed", imageUrl: null }}
        onRetryImage={onRetryImage}
        onUploadImage={onUploadImage}
      />,
    );

    screen.getByRole("button", { name: "Повторить" }).click();
    screen.getByRole("button", { name: "Загрузить фото" }).click();

    expect(onRetryImage).toHaveBeenCalledTimes(1);
    expect(onUploadImage).toHaveBeenCalledTimes(1);
  });

  it("translates a raw category key in the failed branch", () => {
    renderIntl(
      <WishCard
        role="owner"
        wish={{
          ...wish,
          imageStatus: "failed",
          imageUrl: null,
          category: "home",
        }}
      />,
    );
    expect(screen.getByText("Дом")).toBeInTheDocument();
    expect(screen.queryByText("home")).toBeNull();
  });

  it("disables the retry button while retryBusy, without blocking upload", () => {
    const onRetryImage = vi.fn();
    const onUploadImage = vi.fn();
    renderIntl(
      <WishCard
        role="owner"
        retryBusy
        wish={{ ...wish, imageStatus: "failed", imageUrl: null }}
        onRetryImage={onRetryImage}
        onUploadImage={onUploadImage}
      />,
    );

    expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
    screen.getByRole("button", { name: "Загрузить фото" }).click();
    expect(onUploadImage).toHaveBeenCalledTimes(1);
    expect(onRetryImage).not.toHaveBeenCalled();
  });
});

describe("WishCard viewer/archive — no owner-only image states", () => {
  it("shows a plain placeholder (no shimmer) for a viewer card while the image is generating", () => {
    renderIntl(
      <WishCard
        role="viewer"
        reservationStatus="free"
        wish={{ ...wish, imageStatus: "generating", imageUrl: null }}
      />,
    );
    expect(screen.queryByText("Рисуем…")).toBeNull();
  });

  it("shows a plain placeholder with no retry/upload buttons for a viewer card whose image failed, and the card click still fires", () => {
    const onClick = vi.fn();
    renderIntl(
      <WishCard
        role="viewer"
        reservationStatus="free"
        onClick={onClick}
        wish={{ ...wish, imageStatus: "failed", imageUrl: null }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Загрузить фото" })).toBeNull();

    screen.getByRole("button", { name: /Керамическая ваза/ }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("WishCard archive", () => {
  it("shows the gifted badge and the meta line", () => {
    renderIntl(
      <WishCard
        role="archive"
        giftedAt="2026-05-12T10:00:00.000Z"
        giftedBy="Маша"
        wish={wish}
      />,
    );
    expect(screen.getByText("Подарено")).toBeInTheDocument();
    expect(screen.getByText(/12\.05\.2026/)).toHaveTextContent("Маша");
  });

  it("omits the meta line when nothing is known", () => {
    renderIntl(<WishCard role="archive" wish={wish} />);
    expect(screen.getByText("Подарено")).toBeInTheDocument();
    expect(screen.queryByText("Маша")).toBeNull();
  });
});

describe("WishCard activation", () => {
  it("makes the title the card's control, so inner buttons stay in the a11y tree", () => {
    const onClick = vi.fn();
    const onRetryImage = vi.fn();
    renderIntl(
      <WishCard
        role="owner"
        wish={{ ...wish, imageStatus: "failed", imageUrl: null }}
        onClick={onClick}
        onRetryImage={onRetryImage}
        onUploadImage={vi.fn()}
      />,
    );

    const title = screen.getByRole("button", { name: "Керамическая ваза" });
    // ARIA's presentational-children rule would swallow these two if the card
    // root were still role="button".
    expect(screen.getByRole("button", { name: "Повторить" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Загрузить фото" }),
    ).toBeVisible();
    // …and the card root must not carry role="button" any more.
    expect(title.parentElement?.closest('[role="button"]')).toBeNull();

    title.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRetryImage).not.toHaveBeenCalled();
  });

  it("fires the card's onClick exactly once when the title is used", () => {
    const onClick = vi.fn();
    renderIntl(
      <WishCard
        role="viewer"
        reservationStatus="free"
        wish={wish}
        onClick={onClick}
      />,
    );

    // The tile keeps its own click handler for pointer convenience; the title
    // must not double-fire through it.
    screen.getByRole("button", { name: "Керамическая ваза" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a plain title when the card is not clickable", () => {
    renderIntl(<WishCard role="archive" wish={wish} />);

    expect(
      screen.queryByRole("button", { name: "Керамическая ваза" }),
    ).toBeNull();
    expect(screen.getByText("Керамическая ваза")).toBeInTheDocument();
  });
});
