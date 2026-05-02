import PocketBase from 'pocketbase';

// Während der Entwicklung am PC:
export const pb = new PocketBase(
  import.meta.env.MODE === 'development' 
    ? "http://127.0.0.1:8090" 
    : "https://app.elektro-hegener.de"
);