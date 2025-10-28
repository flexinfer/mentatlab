// Global Immer configuration for Zustand stores that use Map/Set in state
// This must be imported before any store is created.
import { enableMapSet } from 'immer';

try {
  enableMapSet();
} catch {
  // no-op if already enabled or if Immer API changes
}

