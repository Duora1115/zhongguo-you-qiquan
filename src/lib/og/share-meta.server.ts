import { getRequest } from "@tanstack/react-start/server";

export function requestHost(): string {
  try {
    const request = getRequest();
    if (!request) return "";
    return request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  } catch {
    return "";
  }
}
