import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so RTL's implicit auto-cleanup does not run.
afterEach(cleanup);
