const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourceRoots = ["src", "server", "electron"];
const defaultLineBudget = 1800;
const lineBudgets = new Map([
  ["server/modules/agents/runtime.ts", 3810],
  ["src/features/chat/ChatScreen.tsx", 3790],
  ["src/features/settings/SettingsScreen.tsx", 3020],
  ["src/features/writer/WritingScreen.tsx", 2780],
  ["src/features/agents/AgentsScreen.tsx", 2600],
  ["electron/main.ts", 1480],
  ["src/shared/types/contracts.ts", 1020]
]);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, files);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(absolutePath);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isProductionSource(file) {
  const name = relative(file);
  return !/\.test\.tsx?$/.test(name)
    && !name.startsWith("src/shared/locales/");
}

const files = sourceRoots.flatMap((directory) => walk(path.join(root, directory)));
const productionFiles = files.filter(isProductionSource);
const knownFiles = new Set(productionFiles);
const graph = new Map();
const errors = [];

function resolveImport(fromFile, request) {
  if (!request.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), request.replace(/\.js$/, ""));
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx")
  ];
  return candidates.find((candidate) => knownFiles.has(candidate)) || null;
}

for (const file of productionFiles) {
  const name = relative(file);
  const source = fs.readFileSync(file, "utf8");
  const lineCount = source.split(/\r?\n/).length;
  const budget = lineBudgets.get(name) ?? defaultLineBudget;
  if (lineCount > budget) {
    errors.push(`${name} has ${lineCount} lines; budget is ${budget}`);
  }

  const requests = [
    ...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)
  ].map((match) => match[1]);
  const dependencies = requests
    .map((request) => resolveImport(file, request))
    .filter(Boolean);
  graph.set(file, [...new Set(dependencies)]);

  const featureMatch = name.match(/^src\/features\/([^/]+)\//);
  if (featureMatch) {
    const ownFeature = featureMatch[1];
    for (const dependency of dependencies) {
      const dependencyMatch = relative(dependency).match(/^src\/features\/([^/]+)\//);
      if (!dependencyMatch) continue;
      const targetFeature = dependencyMatch[1];
      const usesPublicApi = relative(dependency).endsWith("/public.ts");
      if (targetFeature !== ownFeature && targetFeature !== "plugins" && !usesPublicApi) {
        errors.push(`${name} imports feature ${targetFeature}; use shared contracts or a public feature API`);
      }
    }
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycleKeys = new Set();

function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = stack.slice(start).concat(file).map(relative);
    const key = cycle.slice(0, -1).sort().join("|");
    if (!cycleKeys.has(key)) {
      cycleKeys.add(key);
      errors.push(`circular import: ${cycle.join(" -> ")}`);
    }
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) || []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of productionFiles) visit(file);

if (errors.length > 0) {
  console.error("Architecture checks failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Architecture checks passed for ${productionFiles.length} production TypeScript files.`);
