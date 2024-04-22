import fetch from "isomorphic-fetch";

type RequestInitWithToken = RequestInit & { token?: string };

export const _post = async (url: string, data: object) => {
  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { data: res.json() };
  } catch (e) {
    return { data: null, error: e };
  }
};

export const _get = async (url: string, init?: RequestInitWithToken) => {
  let headers = {};
  if (init?.token) {
    headers = { ...headers, Authorization: `Bearer ${init?.token}` };
  }
  try {
    const res = await fetch(url, {
      ...init,
      method: "GET",
      headers: {
        ...init?.headers,
        ...headers,
      },
    });
    return { data: await res.json() };
  } catch (e) {
    return { data: null, error: e };
  }
};
