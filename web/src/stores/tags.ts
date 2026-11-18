import { create } from "zustand";

/**
 * Tags changed by hand on this device (the tags dialog), by track id. Lists fetched before the change show these over
 * what they loaded, so a box row follows the dialog without fetching its page again.
 */
export const useTagEdits = create<{ edits: Record<string, string[]> }>(() => ({ edits: {} }));

export const setTagEdit = (id: string, tags: string[]) => useTagEdits.setState((s) => ({ edits: { ...s.edits, [id]: tags } }));
