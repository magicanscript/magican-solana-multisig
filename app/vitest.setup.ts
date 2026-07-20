// Matchers like toBeDisabled/toHaveTextContent. Registering them is harmless for node tests too:
// jest-dom only extends expect and doesn't touch the DOM until a matcher is called.
import "@testing-library/jest-dom/vitest";
