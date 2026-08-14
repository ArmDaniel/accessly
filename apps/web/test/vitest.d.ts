/**
 * Pulls the jest-dom matcher signatures (`toBeInTheDocument`, `toHaveFocus`,
 * `toHaveAttribute`, …) into Vitest's `Assertion` type. Without this the
 * matchers work at runtime but the type checker rejects every call.
 */
import '@testing-library/jest-dom/vitest';
