import PocketBase from 'pocketbase';

// Während der Entwicklung am PC:
export const pb = new PocketBase("/");

// Später, wenn dein VPS fertig ist, änderst du es zu:
// export const pb = new PocketBase('https://deine-vps-domain.de');