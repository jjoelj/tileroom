// SPDX-License-Identifier: AGPL-3.0-or-later
// How a house-word vote stands (SPEC §4.10). Shared so the group screen can preview a change of rule.

/**
 * Unanimous: every member's yes passes, one no rejects. Majority: yes from more than half passes; once half say no,
 * yes can't get there, so it's rejected. Only current members' votes count. Null: still open.
 */
export function tally(members: number, yes: number, no: number, majority: boolean): 'passed' | 'rejected' | null {
  if (members < 1) return null;
  if (majority) return yes * 2 > members ? 'passed' : no * 2 >= members ? 'rejected' : null;
  return no > 0 ? 'rejected' : yes === members ? 'passed' : null;
}
