/**
 * Extracts parameters encoded in the URL both in the query and fragment.
 */
export function parseParametersFromURL(href: string) {
  const result: { [parameter: string]: string } = {};

  const url = new URL(href);

  if (url.hash && url.hash[0] === "#") {
    try {
      const hashSearchParams = new URLSearchParams(url.hash.substring(1));
      hashSearchParams.forEach((value, key) => {
        result[key] = value;
      });
    } catch (e: any) {
      // hash is not a query string
    }
  }

  // search parameters take precedence over hash parameters
  url.searchParams.forEach((value, key) => {
    result[key] = value;
  });

  return result;
}

export const clearURLParameters = (delete_params: string[] = []) => {
  const url = new URL(window.location.href);

  delete_params.forEach((param) => {
    url.searchParams.delete(param);
  });

  url.hash = "";

  window.history.replaceState(window.history.state, "", url.toString());
};
