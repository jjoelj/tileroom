// SPDX-License-Identifier: AGPL-3.0-or-later
import { migrate } from '../runtime/db';

migrate();
console.log('migrated');
