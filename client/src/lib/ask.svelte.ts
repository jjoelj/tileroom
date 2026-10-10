// SPDX-License-Identifier: AGPL-3.0-or-later
// In-app replacements for the browser's confirm() and prompt(): one sheet (Dialog.svelte), mounted once in App.

type Ask = {
  title: string;
  body?: string;
  /** The confirm button's label, e.g. "Leave group". */
  action: string;
  /** Destructive: the confirm button is red. */
  danger?: boolean;
  /** Present for a prompt: the field's label, start value and length cap. */
  input?: { label: string; value: string; maxlength?: number; password?: boolean };
};

export const dialog = $state<{ open: (Ask & { done: (value: string | null) => void }) | null }>({ open: null });

function ask(a: Ask) {
  dialog.open?.done(null); // a newer question replaces an unanswered one
  return new Promise<string | null>((resolve) => {
    dialog.open = {
      ...a,
      done: (v) => {
        dialog.open = null;
        resolve(v);
      },
    };
  });
}

/** Resolves true if the user confirms. */
export const confirm = async (a: Omit<Ask, 'input'>) => (await ask(a)) !== null;

/** Resolves a password exactly as typed (hidden, not trimmed), or null if cancelled. */
export const askPassword = (a: Omit<Ask, 'input'>) => ask({ ...a, input: { label: 'Password', value: '', password: true } });

/** Resolves the entered text (trimmed), or null if cancelled. */
export const prompt = async (a: Ask & { input: NonNullable<Ask['input']> }) => (await ask(a))?.trim() ?? null;
