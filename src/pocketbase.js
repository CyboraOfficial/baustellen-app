import PocketBase from 'pocketbase';

// Während der Entwicklung am PC:
export const pb = new PocketBase("http://82.165.109.54");

// Später, wenn dein VPS fertig ist, änderst du es zu:
// export const pb = new PocketBase('https://deine-vps-domain.de');