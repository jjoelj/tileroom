// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { registerServiceWorker } from './lib/push';
import { getTheme, setTheme } from './lib/theme';
import { reloadOnReturn } from './lib/update';

setTheme(getTheme());
registerServiceWorker();
reloadOnReturn();
mount(App, { target: document.getElementById('app')! });
