import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { WishImagePoller } from "./wish-image-poller";

/**
 * `getWishImageStateAction` is a server action; mocked so the poller's
 * interval/timeout logic is tested in isolation without a DB, network, or
 * session — same convention as the rest of the wishes test suite.
 */

afterEach(cleanup);

const getWishImageStateAction = vi.fn();
vi.mock("@/app/wishes/ai-actions", () => ({
  getWishImageStateAction: (wishId: string) => getWishImageStateAction(wishId),
}));

beforeEach(() => {
  getWishImageStateAction.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WishImagePoller", () => {
  it("polls every intervalMs and fires onSettled once a wish turns ready", async () => {
    getWishImageStateAction
      .mockResolvedValueOnce({ imageStatus: "generating", imageUrl: null })
      .mockResolvedValueOnce({ imageStatus: "ready", imageUrl: "https://x" });
    const onSettled = vi.fn();

    render(
      <WishImagePoller
        wishIds={["wish-1"]}
        onSettled={onSettled}
        intervalMs={1000}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(getWishImageStateAction).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSettled).toHaveBeenCalledWith("wish-1", "ready");

    // Settled — no further polling for this id even though the interval
    // keeps ticking (a sibling wish could still be in flight).
    await vi.advanceTimersByTimeAsync(1000);
    expect(getWishImageStateAction).toHaveBeenCalledTimes(2);
  });

  it("fires onSettled with 'failed' the same way", async () => {
    getWishImageStateAction.mockResolvedValue({
      imageStatus: "failed",
      imageUrl: null,
    });
    const onSettled = vi.fn();

    render(
      <WishImagePoller
        wishIds={["wish-1"]}
        onSettled={onSettled}
        intervalMs={1000}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSettled).toHaveBeenCalledWith("wish-1", "failed");
  });

  it("polls multiple ids independently", async () => {
    getWishImageStateAction.mockImplementation((wishId: string) =>
      Promise.resolve(
        wishId === "wish-1"
          ? { imageStatus: "ready", imageUrl: "https://x" }
          : { imageStatus: "generating", imageUrl: null },
      ),
    );
    const onSettled = vi.fn();

    render(
      <WishImagePoller
        wishIds={["wish-1", "wish-2"]}
        onSettled={onSettled}
        intervalMs={1000}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith("wish-1", "ready");

    // wish-2 keeps getting polled; wish-1 doesn't.
    getWishImageStateAction.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(getWishImageStateAction).toHaveBeenCalledExactlyOnceWith("wish-2");
  });

  it("gives up after ~timeoutMs and stops polling without ever settling", async () => {
    getWishImageStateAction.mockResolvedValue({
      imageStatus: "generating",
      imageUrl: null,
    });
    const onSettled = vi.fn();

    render(
      <WishImagePoller
        wishIds={["wish-1"]}
        onSettled={onSettled}
        intervalMs={1000}
        timeoutMs={2500}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000); // t=1000, still generating
    await vi.advanceTimersByTimeAsync(1000); // t=2000, still generating
    expect(getWishImageStateAction).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000); // t=3000, past the 2500ms timeout
    expect(onSettled).not.toHaveBeenCalled();

    getWishImageStateAction.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    // The row is left on whatever it says — no more requests for this id.
    expect(getWishImageStateAction).not.toHaveBeenCalled();
  });

  it("polls nothing and renders nothing for an empty id list", async () => {
    const { container } = render(
      <WishImagePoller wishIds={[]} onSettled={vi.fn()} intervalMs={1000} />,
    );

    expect(container).toBeEmptyDOMElement();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getWishImageStateAction).not.toHaveBeenCalled();
  });

  it("stops polling once unmounted", async () => {
    getWishImageStateAction.mockResolvedValue({
      imageStatus: "generating",
      imageUrl: null,
    });
    const onSettled = vi.fn();

    const { unmount } = render(
      <WishImagePoller
        wishIds={["wish-1"]}
        onSettled={onSettled}
        intervalMs={1000}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(getWishImageStateAction).toHaveBeenCalledTimes(1);

    unmount();
    getWishImageStateAction.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getWishImageStateAction).not.toHaveBeenCalled();
  });
});
