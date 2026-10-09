// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { registerServiceWorker } from './lib/push';
import { getTheme, setTheme } from './lib/theme';
import { checkForUpdates } from './lib/update.svelte';

setTheme(getTheme());
registerServiceWorker();
checkForUpdates();
mount(App, { target: document.getElementById('app')! });
