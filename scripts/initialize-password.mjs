// Behålls för äldre installationsanvisningar: skapar ägaren "admin" med ett tillfälligt lösenord som måste bytas vid
// första inloggningen. Nya installationer använder scripts/create-owner.mjs eller onboardingen i panelen.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UserStore, usersFile } from '../src/users.mjs';
const file = usersFile(process.env, process.env.CHARLOTTENDAL_STATE_DIR || fileURLToPath(new URL('../var', import.meta.url)));
const password = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const store = new UserStore(file, { legacyFile: process.env.CHARLOTTENDAL_AUTH_FILE || null });
await store.createOwner({ username: 'admin', password, mustChange: true });
console.log(`Ägaren admin skapad i ${file} med tillfälligt lösenord. Byte krävs vid första inloggningen.`);
