import * as fs from 'fs';
import * as path from 'path';

export interface ProjectSnapshotOptions {
  cwd: string;
  maxFiles: number;
  maxChars: number;
  includePackageJson: boolean;
  includeReadme: boolean;
  includeTsConfig: boolean;
}

export interface ProjectSnapshot {
  repoName: string;
  cwd: string;
  packageName?: string;
  packageDescription?: string;
  packageScripts?: Record<string, string>;
  detectedStack: string[];
  importantFiles: string[];
  treeSummary: string[];
  readmeExcerpt?: string;
  frontendPackageName?: string;
  notes: string[];
}

const KNOWN_IMPORTANT_FILES = [
  'package.json',
  'frontend/package.json',
  'tsconfig.json',
  'README.md',
  'src/server.ts',
  'src/configStore.ts',
  'src/sessionStore.ts',
  'src/main/proxy/overflowSanitizer.ts',
  'src/main/proxy/projectSnapshot.ts',
  'frontend/src/App.tsx',
  'frontend/src/pages/Settings.tsx',
  'frontend/src/pages/Logs.tsx',
  'frontend/src/pages/Sessions.tsx',
];

const STACK_PATTERNS: Array<{regex: RegExp; stack: string}> = [
  {regex: /"react"/i, stack: 'React'},
  {regex: /"next"/i, stack: 'Next.js'},
  {regex: /"vue"/i, stack: 'Vue'},
  {regex: /"vite"/i, stack: 'Vite'},
  {regex: /"typescript"/i, stack: 'TypeScript'},
  {regex: /"esbuild"/i, stack: 'esbuild'},
  {regex: /"koa"/i, stack: 'Koa'},
  {regex: /"express"/i, stack: 'Express'},
  {regex: /"axios"/i, stack: 'Axios'},
  {regex: /"puppeteer"/i, stack: 'Puppeteer'},
  {regex: /"koa-static"/i, stack: 'Koa Static'},
  {regex: /"koa-bodyparser"/i, stack: 'Koa Bodyparser'},
  {regex: /"@koa\/router"/i, stack: 'Koa Router'},
];

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.cache',
  'data', 'public', 'lib',
]);

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function detectStackFromPackage(packageJson: Record<string, any> | null): string[] {
  const stack: string[] = [];
  if (!packageJson) return stack;

  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  for (const dep of Object.keys(allDeps)) {
    for (const pattern of STACK_PATTERNS) {
      if (pattern.regex.test(dep) && !stack.includes(pattern.stack)) {
        stack.push(pattern.stack);
      }
    }
  }

  if (stack.length === 0) {
    if (packageJson.scripts) {
      const scripts = Object.values(packageJson.scripts).join(' ');
      if (/\bbun\b/.test(scripts)) stack.push('Bun');
      if (/\bnode\b/.test(scripts)) stack.push('Node');
      if (/\btsc\b/.test(scripts)) stack.push('TypeScript');
    }
  }

  return stack;
}

function detectStack(packageJson: Record<string, any> | null, frontendPackageJson: Record<string, any> | null): string[] {
  const stack = new Set<string>();

  for (const pkg of [packageJson, frontendPackageJson]) {
    for (const s of detectStackFromPackage(pkg)) {
      stack.add(s);
    }
  }

  if (stack.size === 0) {
    if (packageJson?.scripts) {
      const scripts = Object.values(packageJson.scripts).join(' ');
      if (/\bbun\b/.test(scripts)) stack.add('Bun');
      if (/\bnode\b/.test(scripts)) stack.add('Node');
      if (/\btsc\b/.test(scripts)) stack.add('TypeScript');
    }
  }

  return stack.size > 0 ? Array.from(stack) : ['JavaScript/TypeScript'];
}

function walkDir(dir: string, maxFiles: number): string[] {
  const results: string[] = [];
  let count = 0;

  function walk(current: string) {
    if (count >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, {withFileTypes: true});
    } catch {
      return;
    }

    const subdirs: string[] = [];
    for (const entry of entries) {
      if (count >= maxFiles) return;
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(dir, fullPath);

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        subdirs.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        results.push(relative);
        count++;
      }
    }

    for (const sd of subdirs) {
      walk(sd);
    }
  }

  walk(dir);
  return results;
}

function readPackageJson(pkgPath: string): Record<string, any> | null {
  const content = readFileSafe(pkgPath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function buildProjectSnapshot(options: ProjectSnapshotOptions): ProjectSnapshot {
  const cwd = path.resolve(options.cwd);
  const repoName = path.basename(cwd);
  const notes: string[] = [];

  const packageJson = readPackageJson(path.join(cwd, 'package.json'));
  const frontendPackageJson = readPackageJson(path.join(cwd, 'frontend', 'package.json'));
  const packageName = packageJson?.name || undefined;
  const packageDescription = packageJson?.description || undefined;
  const packageScripts = packageJson?.scripts ? {...packageJson.scripts} : undefined;

  const stack = detectStack(packageJson, frontendPackageJson);

  const walkResults = walkDir(cwd, options.maxFiles);
  const importantFiles: string[] = [];
  for (const f of KNOWN_IMPORTANT_FILES) {
    if (fs.existsSync(path.join(cwd, f))) {
      importantFiles.push(f);
    }
  }

  const treeSummary: string[] = [];
  const srcDir = path.join(cwd, 'src');
  const frontendDir = path.join(cwd, 'frontend');

  if (fs.existsSync(srcDir)) {
    const srcFiles = walkResults.filter(f => f.startsWith('src/') && !f.includes('node_modules'));
    for (const sf of srcFiles.slice(0, 15)) {
      treeSummary.push(`- ${sf}`);
    }
    if (srcFiles.length > 15) {
      treeSummary.push(`- ... (${srcFiles.length - 15} more src files)`);
    }
  }

  if (fs.existsSync(frontendDir)) {
    const frontendFiles = walkResults.filter(f => f.startsWith('frontend/') && !f.includes('node_modules'));
    for (const uf of frontendFiles.slice(0, 10)) {
      treeSummary.push(`- ${uf}`);
    }
    if (frontendFiles.length > 10) {
      treeSummary.push(`- ... (${frontendFiles.length - 10} more frontend files)`);
    }
  }

  const otherFiles = walkResults.filter(f => !f.startsWith('src/') && !f.startsWith('frontend/'));
  for (const of2 of otherFiles.slice(0, 5)) {
    treeSummary.push(`- ${of2}`);
  }

  const readmePath = path.join(cwd, 'README.md');
  let readmeExcerpt: string | undefined;
  if (options.includeReadme && fs.existsSync(readmePath)) {
    const readmeContent = readFileSafe(readmePath);
    if (readmeContent) {
      const lines = readmeContent.split('\n').filter(l => l.trim());
      if (lines.length > 1) {
        readmeExcerpt = lines.slice(0, 10).join('\n').slice(0, 2000);
      }
    }
  }

  let totalChars = 0;
  const trimmedTree: string[] = [];
  for (const line of treeSummary) {
    if (totalChars + line.length + 1 > options.maxChars) break;
    trimmedTree.push(line);
    totalChars += line.length + 1;
  }

  return {
    repoName,
    cwd,
    packageName,
    packageDescription,
    packageScripts,
    detectedStack: stack,
    importantFiles,
    treeSummary: trimmedTree,
    readmeExcerpt,
    frontendPackageName: frontendPackageJson?.name,
    notes,
  };
}

export function renderProjectSnapshot(snapshot: ProjectSnapshot): string {
  const lines: string[] = [];

  lines.push('PROJECT_SNAPSHOT:');
  lines.push(`repo_name=${snapshot.repoName}`);
  lines.push(`cwd=${snapshot.cwd}`);
  if (snapshot.packageName) lines.push(`package_name=${snapshot.packageName}`);
  if (snapshot.packageDescription) lines.push(`package_description=${snapshot.packageDescription}`);
  if (snapshot.detectedStack.length > 0) {
    lines.push(`detected_stack=${snapshot.detectedStack.join(', ')}`);
  }
  if (snapshot.packageScripts) {
    const scriptKeys = Object.keys(snapshot.packageScripts);
    if (scriptKeys.length > 0) {
      lines.push('package_scripts:');
      for (const key of scriptKeys.slice(0, 10)) {
        lines.push(`  ${key}: ${snapshot.packageScripts[key]}`);
      }
    }
  }
  if (snapshot.importantFiles.length > 0) {
    lines.push('important_files:');
    for (const f of snapshot.importantFiles) {
      lines.push(`- ${f}`);
    }
  }
  lines.push('');

  if (snapshot.readmeExcerpt) {
    lines.push('README_EXCERPT:');
    lines.push(snapshot.readmeExcerpt);
    lines.push('');
  }

  if (snapshot.treeSummary.length > 0) {
    lines.push('PROJECT_TREE_SUMMARY:');
    lines.push(...snapshot.treeSummary);
    lines.push('');
  }

  return lines.join('\n');
}
