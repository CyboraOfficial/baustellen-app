import PocketBase from 'pocketbase';

// Während der Entwicklung am PC:
export const pb = new PocketBase(
  import.meta.env.MODE === 'development' 
    ? "http://127.0.0.1:8090" 
    : "https://app.elektro-hegener.de"
);

export const ensureAuthSession = async () => {
  if (!pb.authStore.token) {
    throw new Error("Nicht angemeldet");
  }

  if (!pb.authStore.isValid) {
    await pb.collection("users").authRefresh();
  }

  return pb.authStore.model;
};

export const getSecureFileUrl = async (record, fileName, { download = false } = {}) => {
  await ensureAuthSession();

  const fileToken = await pb.files.getToken();
  const options = {
    token: fileToken,
  };

  if (download) {
    options.download = 1;
  }

  return pb.files.getUrl(record, fileName, options);
};