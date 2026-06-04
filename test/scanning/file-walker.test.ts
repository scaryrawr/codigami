import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { commonDirectory, walkDirectories, walkDirectory } from "../../src/scanning/file-walker.ts";
import { CodigamiError } from "../../src/types.ts";

const execFileAsync = promisify(execFile);

describe("walkDirectory", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "codigami-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns files matching given extensions", async () => {
    await writeFile(join(root, "main.ts"), "const x = 1;");
    await writeFile(join(root, "style.css"), "body {}");
    await writeFile(join(root, "util.ts"), "export {};");

    const files = await walkDirectory(root, [".ts"]);

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.relativePath)).toEqual(["main.ts", "util.ts"]);
    for (const f of files) {
      expect(f.absolutePath).toBe(join(root, f.relativePath));
    }
  });

  it("recurses into subdirectories", async () => {
    await mkdir(join(root, "src", "lib"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "");
    await writeFile(join(root, "src", "lib", "helper.ts"), "");

    const files = await walkDirectory(root, [".ts"]);

    expect(files.map((f) => f.relativePath)).toEqual([
      join("src", "index.ts"),
      join("src", "lib", "helper.ts"),
    ]);
  });

  it("skips node_modules directory", async () => {
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "index.ts"), "");
    await writeFile(join(root, "app.ts"), "");

    const files = await walkDirectory(root, [".ts"]);

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe("app.ts");
  });

  it("skips .git directory", async () => {
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, ".git", "objects", "abc.ts"), "");
    await writeFile(join(root, "app.ts"), "");

    const files = await walkDirectory(root, [".ts"]);

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe("app.ts");
  });

  it("skips files and directories ignored by the repository gitignore", async () => {
    await execFileAsync("git", ["init"], { cwd: root });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "dist/\n*.generated.ts\n");
    await writeFile(join(root, "dist", "bundle.ts"), "");
    await writeFile(join(root, "keep.ts"), "");
    await writeFile(join(root, "schema.generated.ts"), "");

    const files = await walkDirectory(root, [".ts"]);

    expect(files.map((f) => f.relativePath)).toEqual(["keep.ts"]);
  });

  it("skips files ignored by nested gitignores", async () => {
    await execFileAsync("git", ["init"], { cwd: root });
    await mkdir(join(root, "packages", "a", "src"), { recursive: true });
    await writeFile(join(root, "packages", "a", ".gitignore"), "coverage/\n*.tmp.ts\n");
    await mkdir(join(root, "packages", "a", "coverage"), { recursive: true });
    await writeFile(join(root, "packages", "a", "coverage", "report.ts"), "");
    await writeFile(join(root, "packages", "a", "src", "keep.ts"), "");
    await writeFile(join(root, "packages", "a", "src", "fixture.tmp.ts"), "");

    const files = await walkDirectory(root, [".ts"]);

    expect(files.map((f) => f.relativePath)).toEqual([join("packages", "a", "src", "keep.ts")]);
  });

  it("skips hidden files and directories", async () => {
    await mkdir(join(root, ".hidden"), { recursive: true });
    await writeFile(join(root, ".hidden", "secret.ts"), "");
    await writeFile(join(root, ".env.ts"), "");
    await writeFile(join(root, "visible.ts"), "");

    const files = await walkDirectory(root, [".ts"]);

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe("visible.ts");
  });

  it("returns empty array for empty directory", async () => {
    const files = await walkDirectory(root, [".ts"]);

    expect(files).toEqual([]);
  });

  it("throws CodigamiError for non-existent directory", async () => {
    const badPath = join(root, "does-not-exist");

    await expect(walkDirectory(badPath, [".ts"])).rejects.toThrow(CodigamiError);
  });

  it("returns results sorted by relative path", async () => {
    await mkdir(join(root, "b"), { recursive: true });
    await mkdir(join(root, "a"), { recursive: true });
    await writeFile(join(root, "b", "z.ts"), "");
    await writeFile(join(root, "a", "y.ts"), "");
    await writeFile(join(root, "c.ts"), "");

    const files = await walkDirectory(root, [".ts"]);

    const paths = files.map((f) => f.relativePath);
    expect(paths).toEqual([join("a", "y.ts"), join("b", "z.ts"), "c.ts"]);
  });

  it("supports multiple extensions", async () => {
    await writeFile(join(root, "app.ts"), "");
    await writeFile(join(root, "style.css"), "");
    await writeFile(join(root, "readme.md"), "");

    const files = await walkDirectory(root, [".ts", ".css"]);

    expect(files.map((f) => f.relativePath)).toEqual(["app.ts", "style.css"]);
  });

  it("walks multiple directories together with distinct relative paths", async () => {
    await mkdir(join(root, "packages", "a", "src"), { recursive: true });
    await mkdir(join(root, "packages", "b", "src"), { recursive: true });
    await writeFile(join(root, "packages", "a", "src", "index.ts"), "");
    await writeFile(join(root, "packages", "b", "src", "index.ts"), "");

    const files = await walkDirectories(
      [join(root, "packages", "a"), join(root, "packages", "b")],
      [".ts"],
    );

    expect(files.map((f) => f.relativePath)).toEqual([
      join("a", "src", "index.ts"),
      join("b", "src", "index.ts"),
    ]);
  });

  it("deduplicates files when directories overlap", async () => {
    await mkdir(join(root, "src", "lib"), { recursive: true });
    await writeFile(join(root, "src", "lib", "helper.ts"), "");

    const files = await walkDirectories([join(root, "src"), join(root, "src", "lib")], [".ts"]);

    expect(files.map((f) => f.relativePath)).toEqual([join("lib", "helper.ts")]);
  });
});

describe("commonDirectory", () => {
  it("returns the only path for single path input", () => {
    const path = resolve("packages", "a");

    expect(commonDirectory([path])).toBe(path);
  });

  it("returns the deepest shared parent for sibling paths", () => {
    const parent = resolve("packages");

    expect(commonDirectory([join(parent, "a"), join(parent, "b")])).toBe(parent);
  });

  it("returns the root when paths share no directory below it", () => {
    expect(commonDirectory([`${sep}repo-a`, `${sep}repo-b`])).toBe(sep);
  });
});
