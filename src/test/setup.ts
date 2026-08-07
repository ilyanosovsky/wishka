import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts has no `globals: true`, so Testing Library's automatic
// per-test cleanup never self-registers — do it explicitly for every file.
afterEach(cleanup);
