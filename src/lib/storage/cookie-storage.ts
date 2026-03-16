import { SupportedStorage } from "../types";
import { isBrowser } from "../helpers";

interface CookieOptions {
    domain?: string;
    path?: string;
    sameSite?: "Lax" | "Strict" | "None";
    secure?: boolean;
    maxAge?: number;
}

/**
 * A storage adapter that uses document.cookie to persist data.
 * This is useful for SSR as cookies are sent to the server on every request.
 */
export const cookieStorageAdapter = (
    options: CookieOptions = {}
): SupportedStorage => {
    const defaultOptions: CookieOptions = {
        path: "/",
        sameSite: "Lax",
        secure: isBrowser() && window.location.protocol === "https:",
        ...options,
    };

    return {
        getItem: (key: string) => {
            if (!isBrowser()) {
                return null;
            }

            const name = encodeURIComponent(key) + "=";
            const decodedCookie = decodeURIComponent(document.cookie);
            const ca = decodedCookie.split(";");

            for (let i = 0; i < ca.length; i++) {
                let c = ca[i];
                while (c.charAt(0) === " ") {
                    c = c.substring(1);
                }
                if (c.indexOf(name) === 0) {
                    return c.substring(name.length, c.length);
                }
            }
            return null;
        },

        setItem: (key: string, value: string) => {
            if (!isBrowser()) {
                return;
            }

            let cookieString = `${encodeURIComponent(key)}=${encodeURIComponent(
                value
            )}`;

            if (defaultOptions.maxAge) {
                cookieString += `; Max-Age=${defaultOptions.maxAge}`;
            }

            if (defaultOptions.domain) {
                cookieString += `; Domain=${defaultOptions.domain}`;
            }

            if (defaultOptions.path) {
                cookieString += `; Path=${defaultOptions.path}`;
            }

            if (defaultOptions.sameSite) {
                cookieString += `; SameSite=${defaultOptions.sameSite}`;
            }

            if (defaultOptions.secure) {
                cookieString += "; Secure";
            }

            document.cookie = cookieString;
        },

        removeItem: (key: string) => {
            if (!isBrowser()) {
                return;
            }

            // To remove a cookie, we set its expiration date to a time in the past
            let cookieString = `${encodeURIComponent(key)}=; Max-Age=-99999999;`;

            if (defaultOptions.domain) {
                cookieString += ` Domain=${defaultOptions.domain};`;
            }

            if (defaultOptions.path) {
                cookieString += ` Path=${defaultOptions.path};`;
            }

            document.cookie = cookieString;
        },
    };
};
