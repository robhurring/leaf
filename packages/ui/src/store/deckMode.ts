// Marp files the reader has switched to reading as a document instead of as slides.
import { create } from 'zustand';

type DeckMode = {
  documents: Record<string, true>;
  toggle(path: string): void;
};

export const useDeckMode = create<DeckMode>((set) => ({
  documents: {},
  toggle: (path) =>
    set((s) => {
      const documents = { ...s.documents };
      if (documents[path]) delete documents[path];
      else documents[path] = true;
      return { documents };
    }),
}));
