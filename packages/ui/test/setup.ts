import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useUi, UI_DEFAULTS } from '../src/store/ui.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState(UI_DEFAULTS);
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.appearance;
});
