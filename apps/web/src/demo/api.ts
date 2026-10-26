import { createBrowserDemo } from "./model.ts";

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const demo = createBrowserDemo(browserStorage());

export async function demoApi(path: string, body?: unknown): Promise<unknown> {
  return demo.request(path, body);
}
