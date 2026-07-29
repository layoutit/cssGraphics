import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

import ts from "typescript";
import {
  lexicalCompare,
  titleHeadSha256,
} from "./contract.mjs";

export const TITLE_HEAD_DYNLIST_GRAPH_SCHEMA = "cssgraphics-title-head-dynlist-graph@1";
const TITLE_HEAD_DYNLIST_ENTRY = "dynlists/dynlist_mario_master.js";

const TITLE_HEAD_DYNLIST_SOURCE_FILES = Object.freeze([
  "DynlistProc.js",
  "ShapeHelperGlobals.js",
  "gd_types.js",
  "dynlists/anim_group_1.js",
  "dynlists/anim_mario_lips.js",
  "dynlists/anim_mario_mustache_left.js",
  "dynlists/anim_mario_mustache_right.js",
  "dynlists/dynlist_macros.js",
  "dynlists/dynlist_mario_eyebrows_mustache.js",
  "dynlists/dynlist_mario_eyes.js",
  "dynlists/dynlist_mario_face.js",
  "dynlists/dynlist_mario_master.js",
]);

const ALLOWED_FILES = new Set(TITLE_HEAD_DYNLIST_SOURCE_FILES);
const DYNAMIC_CONSTANT_NAMES = Object.freeze([
  "D_CAR_DYNAMICS",
  "D_NET",
  "D_JOINT",
  "D_ANOTHER_JOINT",
  "D_CAMERA",
  "D_VERTEX",
  "D_FACE",
  "D_PLANE",
  "D_BONE",
  "D_MATERIAL",
  "D_SHAPE",
  "D_GADGET",
  "D_LABEL",
  "D_VIEW",
  "D_ANIMATOR",
  "D_DATA_GRP",
  "D_PARTICLE",
  "D_LIGHT",
  "D_GROUP",
  "PARM_PTR_OBJ_VTX",
  "PARM_PTR_CHAR",
]);
const SHAPE_POINTER_NAMES = Object.freeze([
  "silverStarPtr",
  "redStarPtr",
  "silverSparkPtr",
  "redSparkPtr",
]);

const INTERNAL_KIND = Symbol("cssgraphicsDynlistInternalKind");

class DynlistEvaluationError extends Error {
  constructor(message, { file = null, detail = null } = {}) {
    super(file ? `${file}: ${message}` : message);
    this.name = "DynlistEvaluationError";
    this.file = file;
    this.detail = detail;
  }
}

function fail(message, file = null, detail = null) {
  throw new DynlistEvaluationError(message, { file, detail });
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function propertyName(node, file) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  fail(`unsupported computed property name ${ts.SyntaxKind[node.kind]}`, file);
}

function numberFromExpression(node, file) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node)) {
    const value = numberFromExpression(node.operand, file);
    if (node.operator === ts.SyntaxKind.MinusToken) return -value;
    if (node.operator === ts.SyntaxKind.PlusToken) return value;
  }
  fail(`expected a numeric literal, received ${ts.SyntaxKind[node.kind]}`, file);
}

function parseSourceFile(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    fail(`parse error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`, path);
  }
  return sourceFile;
}

function internal(kind, value) {
  return Object.freeze({ [INTERNAL_KIND]: kind, ...value });
}

function namespaceValue(modulePath) {
  return internal("namespace", { modulePath });
}

function macroValue(modulePath, declaration) {
  return internal("macro", { modulePath, declaration });
}

function constantNamespaceValue(modulePath, values) {
  return internal("constant-namespace", { modulePath, values });
}

function symbolValue(modulePath, exportName, path = []) {
  return internal("symbol", { modulePath, exportName, path });
}

function refValue(id) {
  return Object.freeze({ $ref: id });
}

function serializedSymbol(value) {
  return Object.freeze({
    $symbol: Object.freeze({
      module: value.modulePath,
      export: value.exportName,
      path: Object.freeze([...value.path]),
    }),
  });
}

function normalizeRequestedEntry(entry) {
  if (typeof entry !== "string" || isAbsolute(entry) || entry.includes("\\")) {
    fail("entry must be a normalized relative title-head source path");
  }
  const normalized = posix.normalize(entry.replace(/^\.\//, ""));
  if (normalized !== entry.replace(/^\.\//, "") || !ALLOWED_FILES.has(normalized)) {
    fail(`entry is outside the allowed title-head dynlist closure: ${entry}`);
  }
  return normalized;
}

function resolveImportPath(importer, specifier) {
  if (
    typeof specifier !== "string"
    || isAbsolute(specifier)
    || specifier.includes("\\")
    || (!specifier.startsWith("./") && !specifier.startsWith("../"))
  ) {
    fail(`import is outside the allowed relative dynlist closure: ${specifier}`, importer);
  }

  let resolvedPath = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (!posix.extname(resolvedPath)) resolvedPath += ".js";
  if (
    resolvedPath.startsWith("../")
    || resolvedPath.includes("/../")
    || posix.extname(resolvedPath) !== ".js"
    || !ALLOWED_FILES.has(resolvedPath)
  ) {
    fail(`import resolves outside the allowed title-head dynlist closure: ${specifier}`, importer);
  }
  return resolvedPath;
}

function readQualifiedSource(root, relativePath) {
  if (!ALLOWED_FILES.has(relativePath)) fail("source is outside the allowed title-head closure", relativePath);
  const candidate = resolve(root, ...relativePath.split("/"));
  let actual;
  try {
    actual = realpathSync(candidate);
  } catch (error) {
    fail(`required source file is unavailable (${error.code ?? error.message})`, relativePath);
  }
  if (!isInside(root, actual)) fail("source symlink escapes the qualified Goddard root", relativePath);
  const bytes = readFileSync(actual);
  return {
    bytes,
    source: bytes.toString("utf8"),
    sha256: titleHeadSha256(bytes),
  };
}

function parseImport(statement, importer) {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) {
    fail("import specifier must be a string literal", importer);
  }
  const specifier = statement.moduleSpecifier.text;
  const resolvedPath = resolveImportPath(importer, specifier);
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly || clause.name) {
    fail("only namespace and named value imports are allowed", importer);
  }

  const bindings = [];
  if (ts.isNamespaceImport(clause.namedBindings)) {
    bindings.push({ kind: "namespace", local: clause.namedBindings.name.text });
  } else if (ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) fail("type-only imports are not allowed", importer);
      bindings.push({
        kind: "named",
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
      });
    }
  } else {
    fail("import must declare namespace or named bindings", importer);
  }
  return { specifier, resolvedPath, bindings };
}

function validateMacro(declaration, file) {
  const arrow = declaration.initializer;
  if (!ts.isArrowFunction(arrow)) fail("macro initializer must be an arrow function", file);
  const names = new Set();
  for (const parameter of arrow.parameters) {
    if (
      !ts.isIdentifier(parameter.name)
      || parameter.dotDotDotToken
      || parameter.questionToken
      || parameter.initializer
      || parameter.type
    ) {
      fail("macro parameters must be plain identifiers", file);
    }
    if (names.has(parameter.name.text)) fail(`duplicate macro parameter ${parameter.name.text}`, file);
    names.add(parameter.name.text);
  }
  if (!ts.isBlock(arrow.body) || arrow.body.statements.length !== 1) {
    fail("macro body must contain exactly one return statement", file);
  }
  const statement = arrow.body.statements[0];
  if (!ts.isReturnStatement(statement) || !statement.expression || !ts.isObjectLiteralExpression(statement.expression)) {
    fail("macro body must return one object literal", file);
  }
}

function parseDataModule(path, sourceFile, hash) {
  const module = {
    kind: path === "dynlists/dynlist_macros.js" ? "macros" : "data",
    path,
    sha256: hash,
    imports: [],
    importBindings: new Map(),
    declarations: new Map(),
    declarationOrder: [],
    status: "loading",
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (module.declarationOrder.length > 0) fail("imports must precede declarations", path);
      const parsed = parseImport(statement, path);
      module.imports.push(parsed);
      for (const binding of parsed.bindings) {
        if (module.importBindings.has(binding.local) || module.declarations.has(binding.local)) {
          fail(`duplicate binding ${binding.local}`, path);
        }
        module.importBindings.set(binding.local, { ...binding, target: parsed.resolvedPath });
      }
      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      fail(`unsupported top-level statement ${ts.SyntaxKind[statement.kind]}`, path);
    }
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      fail("only const declarations are allowed", path);
    }
    if (statement.declarationList.declarations.length !== 1) {
      fail("each const statement must declare exactly one binding", path);
    }
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      fail("const declarations require an identifier and initializer", path);
    }
    const name = declaration.name.text;
    if (module.declarations.has(name) || module.importBindings.has(name)) {
      fail(`duplicate binding ${name}`, path);
    }
    const record = {
      name,
      node: declaration,
      exported: hasModifier(statement, ts.SyntaxKind.ExportKeyword),
      state: "pending",
      value: undefined,
    };
    if (module.kind === "macros") validateMacro(declaration, path);
    else if (ts.isArrowFunction(declaration.initializer)) fail("functions are only allowed in dynlist_macros.js", path);
    module.declarations.set(name, record);
    module.declarationOrder.push(record);
  }

  if (module.declarationOrder.length === 0) fail("module contains no declarations", path);
  return module;
}

function parseDynlistConstants(path, sourceFile, hash) {
  const classDeclaration = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "DynlistProc",
  );
  if (!classDeclaration) fail("DynlistProc class was not found", path);
  const constructor = classDeclaration.members.find(ts.isConstructorDeclaration);
  if (!constructor?.body) fail("DynlistProc constructor was not found", path);

  const values = new Map();
  for (const statement of constructor.body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
    const assignment = statement.expression;
    if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    if (
      !ts.isPropertyAccessExpression(assignment.left)
      || assignment.left.expression.kind !== ts.SyntaxKind.ThisKeyword
    ) continue;
    const name = assignment.left.name.text;
    if (!DYNAMIC_CONSTANT_NAMES.includes(name)) continue;
    if (values.has(name)) fail(`duplicate DynlistProc constant ${name}`, path);
    values.set(name, numberFromExpression(assignment.right, path));
  }
  for (const name of DYNAMIC_CONSTANT_NAMES) {
    if (!values.has(name)) fail(`missing DynlistProc constant ${name}`, path);
  }

  let exportsInstance = false;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === "DynlistProcInstance"
        && declaration.initializer
        && ts.isNewExpression(declaration.initializer)
        && ts.isIdentifier(declaration.initializer.expression)
        && declaration.initializer.expression.text === "DynlistProc"
        && (declaration.initializer.arguments?.length ?? 0) === 0
      ) exportsInstance = true;
    }
  }
  if (!exportsInstance) fail("DynlistProcInstance export shape was not found", path);

  return {
    kind: "constants",
    path,
    sha256: hash,
    imports: [],
    values,
    status: "loaded",
  };
}

function parseShapeSymbols(path, sourceFile, hash) {
  const classDeclaration = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "ShapeHelperGlobals",
  );
  const constructor = classDeclaration?.members.find(ts.isConstructorDeclaration);
  if (!constructor?.body) fail("ShapeHelperGlobals constructor was not found", path);
  const assignment = constructor.body.statements.find((statement) => (
    ts.isExpressionStatement(statement)
    && ts.isBinaryExpression(statement.expression)
    && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isPropertyAccessExpression(statement.expression.left)
    && statement.expression.left.expression.kind === ts.SyntaxKind.ThisKeyword
    && statement.expression.left.name.text === "gShape"
  ));
  if (!assignment || !ts.isExpressionStatement(assignment)) fail("gShape initializer was not found", path);
  const initializer = assignment.expression.right;
  if (!ts.isObjectLiteralExpression(initializer)) fail("gShape must be an object literal", path);
  const names = [];
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
      fail("gShape entries must be object-literal pointer placeholders", path);
    }
    if (property.initializer.properties.length !== 0) fail("gShape pointer placeholders must be empty", path);
    names.push(propertyName(property.name, path));
  }
  if (names.join("\n") !== SHAPE_POINTER_NAMES.join("\n")) {
    fail(`unexpected gShape pointer set: ${names.join(", ")}`, path);
  }

  let exportsInstance = false;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === "ShapeHelperGlobalsInstance"
        && declaration.initializer
        && ts.isNewExpression(declaration.initializer)
        && ts.isIdentifier(declaration.initializer.expression)
        && declaration.initializer.expression.text === "ShapeHelperGlobals"
        && (declaration.initializer.arguments?.length ?? 0) === 0
      ) exportsInstance = true;
    }
  }
  if (!exportsInstance) fail("ShapeHelperGlobalsInstance export shape was not found", path);

  return {
    kind: "symbols",
    path,
    sha256: hash,
    imports: [],
    names,
    status: "loaded",
  };
}

function initializerKind(initializer) {
  if (ts.isArrayLiteralExpression(initializer)) return "array";
  if (ts.isObjectLiteralExpression(initializer)) return "object";
  if (ts.isArrowFunction(initializer)) return "macro";
  return "value";
}

function createEvaluator(goddardRoot) {
  const root = realpathSync(resolve(goddardRoot));
  const modules = new Map();
  const sources = new Map();

  function loadModule(path) {
    const existing = modules.get(path);
    if (existing) {
      if (existing.status === "loading") fail("cyclic imports are not allowed", path);
      return existing;
    }

    const qualified = readQualifiedSource(root, path);
    sources.set(path, {
      path,
      sha256: qualified.sha256,
      bytes: qualified.bytes.byteLength,
    });
    const sourceFile = parseSourceFile(path, qualified.source);
    let module;
    if (path === "DynlistProc.js") {
      module = parseDynlistConstants(path, sourceFile, qualified.sha256);
    } else if (path === "ShapeHelperGlobals.js") {
      module = parseShapeSymbols(path, sourceFile, qualified.sha256);
    } else {
      module = parseDataModule(path, sourceFile, qualified.sha256);
    }
    modules.set(path, module);

    if (module.kind === "data" || module.kind === "macros") {
      for (const imported of module.imports) loadModule(imported.resolvedPath);
      module.status = "loaded";
    }
    return module;
  }

  function resolveExport(modulePath, name) {
    const module = loadModule(modulePath);
    if (module.kind === "constants") {
      if (name !== "DynlistProcInstance") fail(`unknown semantic export ${name}`, modulePath);
      return constantNamespaceValue(modulePath, module.values);
    }
    if (module.kind === "symbols") {
      if (name !== "ShapeHelperGlobalsInstance") fail(`unknown semantic export ${name}`, modulePath);
      return symbolValue(modulePath, name);
    }
    const declaration = module.declarations.get(name);
    if (!declaration?.exported) fail(`unknown or non-exported binding ${name}`, modulePath);
    return resolveDeclarationBinding(module, declaration);
  }

  function resolveDeclarationBinding(module, declaration) {
    const kind = initializerKind(declaration.node.initializer);
    if (kind === "macro") return macroValue(module.path, declaration);
    if (kind === "array" || kind === "object") return refValue(`${module.path}#${declaration.name}`);
    return evaluateDeclaration(module, declaration);
  }

  function resolveIdentifier(module, name, locals) {
    if (locals?.has(name)) return locals.get(name);
    const imported = module.importBindings.get(name);
    if (imported) {
      if (imported.kind === "namespace") return namespaceValue(imported.target);
      return resolveExport(imported.target, imported.imported);
    }
    const declaration = module.declarations.get(name);
    if (declaration) return resolveDeclarationBinding(module, declaration);
    fail(`unknown identifier ${name}`, module.path);
  }

  function evaluatePropertyAccess(module, expression, locals) {
    const base = evaluateExpression(module, expression.expression, locals);
    const name = expression.name.text;
    if (base?.[INTERNAL_KIND] === "namespace") return resolveExport(base.modulePath, name);
    if (base?.[INTERNAL_KIND] === "constant-namespace") {
      if (!base.values.has(name)) fail(`unknown constant ${name}`, base.modulePath);
      return base.values.get(name);
    }
    if (base?.[INTERNAL_KIND] === "symbol") {
      return symbolValue(base.modulePath, base.exportName, [...base.path, name]);
    }
    fail(`property access ${name} is not on an allowed namespace or source symbol`, module.path);
  }

  function macroReturnExpression(declaration) {
    return declaration.node.initializer.body.statements[0].expression;
  }

  function evaluateCall(module, expression, locals) {
    const callable = evaluateExpression(module, expression.expression, locals);
    if (callable?.[INTERNAL_KIND] !== "macro") {
      fail("only parsed dynlist macros may be called", module.path);
    }
    const parameters = callable.declaration.node.initializer.parameters;
    if (expression.arguments.length !== parameters.length) {
      fail(
        `macro ${callable.declaration.name} expected ${parameters.length} arguments, received ${expression.arguments.length}`,
        module.path,
      );
    }
    const values = expression.arguments.map((argument) => evaluateExpression(module, argument, locals));
    const bound = new Map();
    parameters.forEach((parameter, index) => bound.set(parameter.name.text, values[index]));
    const macroModule = loadModule(callable.modulePath);
    return evaluateExpression(macroModule, macroReturnExpression(callable.declaration), bound);
  }

  function evaluateObject(module, expression, locals) {
    const value = {};
    for (const property of expression.properties) {
      if (ts.isPropertyAssignment(property)) {
        value[propertyName(property.name, module.path)] = evaluateExpression(module, property.initializer, locals);
      } else if (ts.isShorthandPropertyAssignment(property) && !property.objectAssignmentInitializer) {
        value[property.name.text] = resolveIdentifier(module, property.name.text, locals);
      } else {
        fail(`unsupported object member ${ts.SyntaxKind[property.kind]}`, module.path);
      }
    }
    return value;
  }

  function evaluateExpression(module, expression, locals = null) {
    if (ts.isNumericLiteral(expression)) return Number(expression.text);
    if (ts.isStringLiteral(expression)) return expression.text;
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(expression)) {
      const value = evaluateExpression(module, expression.operand, locals);
      if (typeof value !== "number") fail("unary numeric operator requires a number", module.path);
      if (expression.operator === ts.SyntaxKind.MinusToken) return -value;
      if (expression.operator === ts.SyntaxKind.PlusToken) return value;
      fail(`unsupported unary operator ${ts.SyntaxKind[expression.operator]}`, module.path);
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const values = [];
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
          fail("array spreads and holes are not allowed", module.path);
        }
        values.push(evaluateExpression(module, element, locals));
      }
      return values;
    }
    if (ts.isObjectLiteralExpression(expression)) return evaluateObject(module, expression, locals);
    if (ts.isIdentifier(expression)) return resolveIdentifier(module, expression.text, locals);
    if (ts.isPropertyAccessExpression(expression)) return evaluatePropertyAccess(module, expression, locals);
    if (ts.isCallExpression(expression)) return evaluateCall(module, expression, locals);
    if (ts.isParenthesizedExpression(expression)) return evaluateExpression(module, expression.expression, locals);
    fail(`unsupported expression ${ts.SyntaxKind[expression.kind]}`, module.path);
  }

  function serializeValue(value) {
    if (value?.[INTERNAL_KIND] === "symbol") return serializedSymbol(value);
    if (value?.[INTERNAL_KIND]) fail(`internal ${value[INTERNAL_KIND]} escaped graph serialization`);
    if (Array.isArray(value)) return value.map(serializeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)]));
    }
    return value;
  }

  function evaluateDeclaration(module, declaration) {
    if (declaration.state === "complete") return declaration.value;
    if (declaration.state === "evaluating") fail(`cyclic declaration ${declaration.name}`, module.path);
    declaration.state = "evaluating";
    declaration.value = evaluateExpression(module, declaration.node.initializer);
    declaration.state = "complete";
    return declaration.value;
  }

  function serializeExports(module) {
    if (module.kind === "constants") {
      return { DynlistProcInstance: { $constants: `${module.path}#DynlistProcInstance` } };
    }
    if (module.kind === "symbols") {
      return {
        ShapeHelperGlobalsInstance: serializedSymbol(
          symbolValue(module.path, "ShapeHelperGlobalsInstance"),
        ),
      };
    }
    const entries = [];
    for (const declaration of module.declarationOrder) {
      if (!declaration.exported) continue;
      const kind = initializerKind(declaration.node.initializer);
      if (kind === "macro") {
        entries.push([declaration.name, { $macro: `${module.path}#${declaration.name}` }]);
      } else {
        entries.push([declaration.name, serializeValue(resolveDeclarationBinding(module, declaration))]);
      }
    }
    return Object.fromEntries(entries);
  }

  function serializeModule(module) {
    const base = {
      path: module.path,
      sha256: module.sha256,
      kind: module.kind,
      imports: module.imports.map((entry) => ({
        specifier: entry.specifier,
        resolved: entry.resolvedPath,
        bindings: entry.bindings.map((binding) => ({ ...binding })),
      })),
      exports: serializeExports(module),
    };
    if (module.kind === "constants") {
      return {
        ...base,
        constants: Object.fromEntries(DYNAMIC_CONSTANT_NAMES.map((name) => [name, module.values.get(name)])),
      };
    }
    if (module.kind === "symbols") return { ...base, symbols: ["gShape", ...module.names.map((name) => `gShape.${name}`)] };
    if (module.kind === "macros") {
      return {
        ...base,
        macros: module.declarationOrder.map((declaration) => ({
          id: `${module.path}#${declaration.name}`,
          name: declaration.name,
          parameters: declaration.node.initializer.parameters.map((parameter) => parameter.name.text),
        })),
        nodes: [],
      };
    }
    return {
      ...base,
      nodes: module.declarationOrder.map((declaration) => ({
        id: `${module.path}#${declaration.name}`,
        name: declaration.name,
        exported: declaration.exported,
        kind: initializerKind(declaration.node.initializer),
        value: serializeValue(evaluateDeclaration(module, declaration)),
      })),
    };
  }

  function build(entry) {
    const entryModule = loadModule(entry);
    const serializedModules = [...modules.values()]
      .sort((left, right) => lexicalCompare(left.path, right.path))
      .map(serializeModule);
    return {
      schema: TITLE_HEAD_DYNLIST_GRAPH_SCHEMA,
      entry,
      sourcePolicy: "ignored-pinned-sm64js-goddard-title-head-closure",
      sources: [...sources.values()].sort((left, right) => lexicalCompare(left.path, right.path)),
      modules: serializedModules,
      rootExports: serializeExports(entryModule),
    };
  }

  return { build };
}

export function loadTitleHeadDynlistGraph({
  goddardRoot = resolve(process.cwd(), ".local/upstreams/sm64js/src/goddard"),
  entry = TITLE_HEAD_DYNLIST_ENTRY,
} = {}) {
  const normalizedEntry = normalizeRequestedEntry(entry);
  let evaluator;
  try {
    evaluator = createEvaluator(goddardRoot);
  } catch (error) {
    if (error instanceof DynlistEvaluationError) throw error;
    fail(`cannot open the qualified Goddard source root (${error.code ?? error.message})`);
  }
  return evaluator.build(normalizedEntry);
}
