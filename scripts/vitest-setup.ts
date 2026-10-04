import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Every test file gets an isolated data root so importing server code can never
// open, migrate or write keys into the developer's real `data/` directory.
// Suites that need their own fixture still override SLV_DATA_DIR before importing DB code.
process.env.SLV_DATA_DIR = mkdtempSync(join(tmpdir(), "vellium-test-data-"));
delete process.env.SLV_SECRET_KEY;
