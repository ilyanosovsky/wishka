import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Resolved per-request so the module stays importable without env
// (getAuth() memoizes — no per-request construction cost after the first).
export async function GET(request: Request) {
  return toNextJsHandler(getAuth().handler).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth().handler).POST(request);
}
