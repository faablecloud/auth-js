import { window } from "../globals";

function redirect(url: string) {
  getWindow().location = url as any;
}

function getDocument() {
  return getWindow().document;
}

function getWindow() {
  if (!window) throw new Error("No window in environment");
  return window;
}

export const windowHelpers = {
  redirect: redirect,
  getDocument: getDocument,
  getWindow: getWindow,
};
