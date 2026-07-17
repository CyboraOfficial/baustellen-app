import PocketBase from 'pocketbase';

// Während der Entwicklung am PC:
export const pb = new PocketBase(
  import.meta.env.MODE === 'development' 
    ? "http://127.0.0.1:8090" 
    : "https://app.elektro-hegener.de"
);

let authRefreshPromise = null;

const isAuthExpiredError = (error) => {
  const status = Number(error?.status || error?.response?.status || 0);
  return status === 401 || status === 403;
};

export const ensureAuthSession = async () => {
  if (!pb.authStore.token) {
    throw new Error("Nicht angemeldet");
  }

  if (!pb.authStore.isValid) {
    if (!authRefreshPromise) {
      authRefreshPromise = pb
        .collection("users")
        .authRefresh({ requestKey: null })
        .catch((error) => {
          if (isAuthExpiredError(error)) {
            pb.authStore.clear();
            throw new Error("Session abgelaufen");
          }

          throw error;
        })
        .finally(() => {
          authRefreshPromise = null;
        });
    }

    await authRefreshPromise;
  }

  if (!pb.authStore.model) {
    throw new Error("Nicht angemeldet");
  }

  return pb.authStore.model;
};

let cachedFileToken = null;
let cachedFileTokenExpiresAt = 0;
let fileTokenPromise = null;

const getFileTokenSafe = async () => {
  const now = Date.now();
  if (cachedFileToken && now < cachedFileTokenExpiresAt) {
    return cachedFileToken;
  }

  if (!fileTokenPromise) {
    fileTokenPromise = pb.files
      .getToken({ requestKey: null })
      .then((token) => {
        cachedFileToken = token;
        // Keep token for a short period to avoid burst requests/autocancel races.
        cachedFileTokenExpiresAt = Date.now() + 55 * 1000;
        return token;
      })
      .finally(() => {
        fileTokenPromise = null;
      });
  }

  return fileTokenPromise;
};

export const getSecureFileUrl = async (record, fileName, { download = false } = {}) => {
  const options = {
  };

  try {
    const fileToken = await getFileTokenSafe();
    if (fileToken) {
      options.token = fileToken;
    }
  } catch {
    // Wenn kein Token verfügbar ist, versuchen wir die öffentliche URL.
  }

  if (download) {
    options.download = 1;
  }

  return pb.files.getURL(record, fileName, options);
};