// SPDX-License-Identifier: AGPL-3.0-or-later
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
Object.assign(process.env, {
  DB_PATH: ':memory:',
  PUBLIC_ORIGIN: 'https://tileroom.test',
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: 'mailto:test@tileroom.test',
});
const { migrate } = await import('./src/runtime/db');
migrate();
