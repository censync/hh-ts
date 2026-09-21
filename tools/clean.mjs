// Removes the build products: dist/ (the package) and build/ (tests, command line tool, benchmark).
import { rmSync } from "node:fs";

for (const dir of ["dist", "build"]) {
  rmSync(new URL(`../${dir}`, import.meta.url), { recursive: true, force: true });
}
