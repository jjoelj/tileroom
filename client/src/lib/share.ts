// SPDX-License-Identifier: AGPL-3.0-or-later
// Inviting people: phones get the share sheet (one message with the code and link); anything with a mouse gets
// separate "copy code" and "copy link" buttons that copy just that.
import { say } from './say.svelte';

export const canShare = !!navigator.share && matchMedia('(pointer: coarse)').matches;

export const shareText = (text: string) => void navigator.share({ text }).catch(() => {});

/** Copies `text` and says so; `what` names it in the message ("Code", "Link"). */
export function copy(text: string, what: string) {
  if (!navigator.clipboard) return say(`Copy this: ${text}`);
  navigator.clipboard.writeText(text).then(
    () => say(`${what} copied`),
    () => say(`Copy this: ${text}`),
  );
}
