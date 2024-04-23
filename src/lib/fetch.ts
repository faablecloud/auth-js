import { error } from "console";
import fetch from "isomorphic-fetch";

type RequestInitWithToken = RequestInit & {
  token?: string;
  transform?: (data: any) => any;
};

const headers = (init?: RequestInitWithToken) => {
  let headers = {};
  if (init?.token) {
    headers = { ...headers, Authorization: `Bearer ${init?.token}` };
  }
  return {
    ...init?.headers,
    ...headers,
  };
};

export const _post = async (
  url: string,
  data: object,
  init?: RequestInitWithToken
) => {
  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
      headers: { ...headers(init), "Content-Type": "application/json" },
    });

    const body = await res.json();

    return init && init.transform
      ? init.transform(body)
      : { data: body, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
};

export const _get = async (url: string, init?: RequestInitWithToken) => {
  try {
    const res = await fetch(url, {
      ...init,
      method: "GET",
      headers: headers(init),
    });
    const body = await res.json();

    return init && init.transform
      ? init.transform(body)
      : { data: body, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
};
