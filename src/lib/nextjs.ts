import { Session } from "./types";

/**
 * Helper for Next.js to get the session from the server-side cookies.
 * This can be used in API routes or Server Components.
 */
export const getSessionFromCookies = (
    cookiesStore: any,
    storageKey: string
): Session | null => {
    // Try to get the session from the cookie
    // cookiesStore can be the result of calling `cookies()` from `next/headers`
    // or it could be a simple object mapping keys to values.

    let cookieValue: string | undefined;

    if (typeof cookiesStore.get === "function") {
        // Next.js cookies() API
        cookieValue = cookiesStore.get(storageKey)?.value;
    } else {
        // Plain object
        cookieValue = cookiesStore[storageKey];
    }

    if (!cookieValue) {
        return null;
    }

    try {
        return JSON.parse(decodeURIComponent(cookieValue));
    } catch (e) {
        console.error("Failed to parse session from cookie", e);
        return null;
    }
};
