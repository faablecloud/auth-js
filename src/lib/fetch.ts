import { fetch } from "./globals";

export type JsonResponse<T = any> = {
  data: T | null;
  error?: any;
};

type RequestInitWithToken = RequestInit & {
  token: string;
  raw: boolean;
};

const headers = (init: Partial<RequestInitWithToken> = {}) => {
  let headers = {};
  if (init?.token) {
    headers = { ...headers, Authorization: `Bearer ${init?.token}` };
  }
  return {
    ...init?.headers,
    ...headers,
  };
};

export const _post = async <T>(
  url: string,
  data: object,
  options: Partial<RequestInitWithToken> = {}
): Promise<JsonResponse<T>> => {
  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
      headers: { ...headers(options), "Content-Type": "application/json" },
    });

    const body = options.raw ? await res.text() : await res.json();

    return { data: body, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
};

export const _get = async <T>(
  url: string,
  options: Partial<RequestInitWithToken> = {}
): Promise<JsonResponse<T>> => {
  try {
    const res = await fetch(url, {
      ...options,
      method: "GET",
      headers: headers(options),
    });
    const body = await res.json();

    return { data: body, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
};
