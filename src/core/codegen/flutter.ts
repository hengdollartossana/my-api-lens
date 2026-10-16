import { resolve as resolvePath } from "node:path";
import { Eta } from "eta";
import type { Shape } from "../pack/shape";
import { type CallItem, call, dartString, indent, namedParams, WIDTH } from "./dart";
import { type DartModel, ModelRegistry, observedShape, reconcile, specShape } from "./models";
import { camelCase, operationName, pascalCase, resourceName, safeIdent, snakeCase } from "./names";
import type { CodegenEndpoint, CodegenModule, FlutterOptions, GeneratedFile } from "./types";

const VERB: Record<string, string> = { POST: "Create", PUT: "Update", PATCH: "Patch" };
const bodyHint = (e: CodegenEndpoint) =>
  `${VERB[e.method.toUpperCase()] ?? ""}${resourceName(e.path)}Body`;

interface Arg {
  /** Dart parameter declaration, e.g. `required String tenant`. */
  decl: string;
  /** Call-site argument, e.g. `tenant: tenant`. */
  pass: string;
  name: string;
}

interface Plan {
  method: string;
  name: string;
  doc: string[];
  args: Arg[];
  returnType: string;
  /** Statements that turn `response.data` into the return value. */
  decode: string[];
  path: string;
  httpMethod: string;
  query: { name: string; key: string; required: boolean }[];
  body: { name: string; toJson: boolean } | null;
}

function successOf(
  e: CodegenEndpoint,
  options: FlutterOptions,
): { status: string; shape: Shape } | null {
  const statuses = Object.keys(e.responseSchemas).sort();
  const status = statuses.find((s) => /^2/.test(s) && e.responseSchemas[s] != null);
  const spec = status ? specShape(e.responseSchemas[status]) : null;
  if (options.preferObserved && e.observed && e.observed.status < 300 && e.observed.body != null) {
    return spec && status
      ? { status, shape: reconcile(spec, e.observed.body) }
      : { status: String(e.observed.status), shape: observedShape(e.observed.body) };
  }
  return spec && status ? { status, shape: spec } : null;
}

/** Interpolate `{param}` segments into a Dart string literal. */
function pathLiteral(path: string, nameOf: Map<string, string>): string {
  let out = "";
  let rest = path;
  while (rest.length) {
    const m = rest.match(/^([^{]*)\{([^}]+)\}/);
    if (!m) {
      out += rest.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$");
      break;
    }
    const literal = (m[1] as string)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\$/g, "\\$");
    const ident = nameOf.get(m[2] as string) ?? safeIdent(camelCase(m[2] as string));
    rest = rest.slice(m[0].length);
    out += `${literal}${/^[A-Za-z0-9_]/.test(rest) ? `\${${ident}}` : `$${ident}`}`;
  }
  return `'${out}'`;
}

function chain(prefix: string, calls: string[], level: number): string[] {
  const single = `${indent(level)}${prefix}${calls.join("")};`;
  if (single.length <= WIDTH) return [single];
  return [
    `${indent(level)}${prefix}`,
    ...calls.map((c, i) => `${indent(level + 2)}${c}${i === calls.length - 1 ? ";" : ""}`),
  ];
}

function decodeFor(
  shape: Shape,
  reg: ModelRegistry,
  hint: string,
): { type: string; lines: string[] } {
  const t = reg.resolve(shape, hint);
  const type = reg.withNull(t);
  const ret = (expr: string) => chain("return ", [expr], 2);
  if (shape.k === "obj") {
    return { type, lines: ret(`${t.type}.fromJson(response.data as Map<String, dynamic>)`) };
  }
  if (shape.k === "arr") {
    const item = shape.item;
    if (item.k === "obj") {
      const cls = reg.resolve(item, hint).type;
      return {
        type,
        lines: [
          `${indent(2)}final data = response.data as List<dynamic>;`,
          ...chain(
            "return data",
            [`.map((e) => ${cls}.fromJson(e as Map<String, dynamic>))`, ".toList()"],
            2,
          ),
        ],
      };
    }
    const inner = reg.resolve(item, hint);
    if (["String", "int", "bool"].includes(inner.type) && !inner.nullable) {
      return { type, lines: ret(`List<${inner.type}>.from(response.data as List<dynamic>)`) };
    }
    return { type: "dynamic", lines: ret("response.data") };
  }
  if (shape.k === "prim") {
    if (t.type === "String") return { type, lines: ret("response.data as String") };
    if (t.type === "int") return { type, lines: ret("response.data as int") };
    if (t.type === "bool") return { type, lines: ret("response.data as bool") };
    if (t.type === "double") return { type, lines: ret("(response.data as num).toDouble()") };
    if (t.type === "DateTime")
      return { type, lines: ret("DateTime.parse(response.data as String)") };
  }
  return { type: "dynamic", lines: ret("response.data") };
}

function plan(
  e: CodegenEndpoint,
  reg: ModelRegistry,
  taken: Set<string>,
  options: FlutterOptions,
): Plan {
  let name = operationName(e);
  for (let i = 2; taken.has(name); i++) name = `${operationName(e)}${i}`;
  taken.add(name);

  const args: Arg[] = [];
  const nameOf = new Map<string, string>();
  const query: Plan["query"] = [];
  const paramType = (schema: unknown, hint: string) => {
    const shape = specShape(schema);
    if (shape.k === "obj") return "dynamic";
    return reg.withNull(reg.resolve(shape, hint));
  };

  for (const p of e.parameters.filter((x) => x.in === "path")) {
    const ident = safeIdent(camelCase(p.name));
    nameOf.set(p.name, ident);
    args.push({
      decl: `required ${paramType(p.schema, ident)} ${ident}`,
      pass: `${ident}: ${ident}`,
      name: ident,
    });
  }
  let body: Plan["body"] = null;
  if (e.requestBodySchema != null) {
    const shape = specShape(e.requestBodySchema);
    const t = reg.resolve(shape, bodyHint(e));
    body = { name: "body", toJson: shape.k === "obj" };
    args.push({ decl: `required ${reg.withNull(t)} body`, pass: "body: body", name: "body" });
  }
  for (const p of e.parameters.filter((x) => x.in === "query")) {
    const ident = safeIdent(camelCase(p.name));
    const type = paramType(p.schema, ident).replace(/\?$/, "");
    args.push({
      decl: p.required
        ? `required ${type} ${ident}`
        : `${type === "dynamic" ? type : `${type}?`} ${ident}`,
      pass: `${ident}: ${ident}`,
      name: ident,
    });
    query.push({ name: ident, key: p.name, required: p.required });
  }

  const success = successOf(e, options);
  const hint = resourceName(e.path);
  const decoded = success ? decodeFor(success.shape, reg, hint) : null;
  return {
    method: e.method.toUpperCase(),
    name,
    doc: [
      ...(e.summary?.trim() ? [e.summary.trim()] : []),
      `\`${e.method.toUpperCase()} ${e.path}\``,
    ],
    args,
    returnType: decoded ? decoded.type : "void",
    decode: decoded ? decoded.lines : [],
    path: pathLiteral(e.path, nameOf),
    httpMethod: e.method.toLowerCase(),
    query,
    body,
  };
}

function docLines(doc: string[]): string[] {
  return doc.flatMap((d, i) => (i === 0 ? [`  /// ${d}`] : ["  ///", `  /// ${d}`]));
}

/** Parameters are sorted so required ones come first, as `dart format`/lints expect. */
function sortedDecls(args: Arg[]): string[] {
  return [
    ...args.filter((a) => a.decl.startsWith("required ")),
    ...args.filter((a) => !a.decl.startsWith("required ")),
  ].map((a) => a.decl);
}

function clientMethod(p: Plan): string {
  const lines = docLines(p.doc);
  lines.push(namedParams(`Future<${p.returnType}> ${p.name}`, sortedDecls(p.args), " async {", 1));

  const items: CallItem[] = [p.path];
  if (p.query.length) {
    const entries = p.query.map((q) =>
      q.required ? `'${q.key}': ${q.name}` : `if (${q.name} != null) '${q.key}': ${q.name}`,
    );
    items.push({
      single: `queryParameters: {${entries.join(", ")}}`,
      multi: `queryParameters: {\n${entries.map((x) => `  ${x},`).join("\n")}\n}`,
    });
  }
  if (p.body) items.push(`data: ${p.body.toJson ? "body.toJson()" : "body"}`);

  const known = ["get", "post", "put", "patch", "delete"].includes(p.httpMethod);
  if (!known) items.push(`options: Options(method: ${dartString(p.method)})`);
  const head = `final response = await _dio.${known ? p.httpMethod : "request"}<dynamic>`;
  lines.push(call(head, items, ";", 2));
  lines.push(...p.decode);
  lines.push("  }");
  return lines.join("\n");
}

function repoMethod(p: Plan): string {
  const lines = docLines(p.doc);
  lines.push(namedParams(`Future<${p.returnType}> ${p.name}`, sortedDecls(p.args), " async {", 1));
  lines.push(`${indent(2)}try {`);
  const sorted = [
    ...p.args.filter((a) => a.decl.startsWith("required ")),
    ...p.args.filter((a) => !a.decl.startsWith("required ")),
  ];
  const prefix = p.returnType === "void" ? "await" : "return await";
  lines.push(
    call(
      `${prefix} _client.${p.name}`,
      sorted.map((a) => a.pass),
      ";",
      3,
    ),
  );
  lines.push(`${indent(2)}} on DioException catch (e) {`);
  lines.push(`${indent(3)}throw ApiException.fromDio(e);`);
  lines.push(`${indent(2)}}`);
  lines.push("  }");
  return lines.join("\n");
}

/** Import block laid out like dart format: package imports, blank line, relative imports. */
function importBlock(paths: string[]): string {
  const unique = [...new Set(paths)];
  const pkgs = unique.filter((p) => p.startsWith("package:")).sort();
  const rel = unique
    .filter((p) => !p.startsWith("package:"))
    .sort((a, b) => a.replace(/^(\.\.\/)+/, "").localeCompare(b.replace(/^(\.\.\/)+/, "")));
  return [pkgs, rel]
    .filter((g) => g.length)
    .map((g) => g.map((p) => `import '${p}';`).join("\n"))
    .join("\n\n");
}

function etaFor(options: FlutterOptions): Eta {
  const views = options.templatesDir ?? resolvePath(process.cwd(), "templates/flutter");
  return new Eta({ views, autoEscape: false, autoTrim: false });
}

/** Header comment so people know these files are generated. */
const GENERATED = "// GENERATED CODE - DO NOT MODIFY BY HAND.\n// Generated by API Lens.\n";

/** Mirrors dart format: one line, else break after `=`, else one parameter per line. */
function factoryCtor(name: string, fields: string[]): string {
  const head = `const factory ${name}`;
  const tail = `_${name};`;
  const single = `${indent(1)}${head}({${fields.join(", ")}}) = ${tail}`;
  if (fields.length === 0) return `${indent(1)}${head}() = ${tail}`;
  if (single.length <= WIDTH) return single;
  const brokenHead = `${indent(1)}${head}({${fields.join(", ")}}) =`;
  if (brokenHead.length <= WIDTH) return `${brokenHead}\n${indent(3)}${tail}`;
  return namedParams(head, fields, ` = ${tail}`, 1);
}

function modelFile(eta: Eta, m: DartModel): GeneratedFile {
  const fields = m.fields.map((f) => {
    const json = f.jsonName !== f.name ? `@JsonKey(name: ${dartString(f.jsonName)}) ` : "";
    return `${json}${f.required ? "required " : ""}${f.type} ${f.name}`;
  });
  const imports = importBlock([
    "package:freezed_annotation/freezed_annotation.dart",
    ...m.refs.map((r) => `${snakeCase(r)}.dart`),
  ]);
  const ctor = factoryCtor(m.name, fields);
  const fromJson = `  factory ${m.name}.fromJson(Map<String, dynamic> json) => _$${m.name}FromJson(json);`;
  const fromJsonWrapped =
    fromJson.length <= WIDTH
      ? fromJson
      : `  factory ${m.name}.fromJson(Map<String, dynamic> json) =>\n      _$${m.name}FromJson(json);`;
  return {
    path: `lib/api/models/${m.file}.dart`,
    content: eta.render("model.dart.eta", {
      header: GENERATED,
      file: m.file,
      name: m.name,
      imports,
      constructor: ctor,
      fromJson: fromJsonWrapped,
    }),
  };
}

export function generateFlutter(
  modules: CodegenModule[],
  options: FlutterOptions = {},
): GeneratedFile[] {
  const eta = etaFor(options);
  const reg = new ModelRegistry();

  // Pass 1: count shapes so shared models are named well.
  for (const m of modules) {
    for (const e of m.endpoints) {
      if (e.requestBodySchema != null) reg.count(specShape(e.requestBodySchema), bodyHint(e));
      const s = successOf(e, options);
      if (s) reg.count(s.shape, resourceName(e.path));
    }
  }

  const files: GeneratedFile[] = [];
  const moduleDirs: string[] = [];
  const usedDirs = new Set<string>();

  for (const m of modules) {
    let dir = snakeCase(m.name);
    for (let i = 2; usedDirs.has(dir); i++) dir = `${snakeCase(m.name)}_${i}`;
    usedDirs.add(dir);
    moduleDirs.push(dir);

    const cls = pascalCase(m.name);
    const taken = new Set<string>();
    const plans = m.endpoints.map((e) => plan(e, reg, taken, options));
    const methods = (fn: (p: Plan) => string) => plans.map(fn).join("\n\n");

    files.push({
      path: `lib/api/${dir}/${dir}_client.dart`,
      content: eta.render("client.dart.eta", {
        header: GENERATED,
        className: `${cls}Client`,
        imports: importBlock(["package:dio/dio.dart", "../models/models.dart"]),
        methods: methods(clientMethod),
      }),
    });
    files.push({
      path: `lib/api/${dir}/${dir}_repository.dart`,
      content: eta.render("repository.dart.eta", {
        header: GENERATED,
        className: `${cls}Repository`,
        clientClass: `${cls}Client`,
        imports: importBlock([
          "package:dio/dio.dart",
          "../api_exception.dart",
          "../models/models.dart",
          `${dir}_client.dart`,
        ]),
        methods: methods(repoMethod),
      }),
    });
    files.push({
      path: `lib/api/${dir}/${dir}.dart`,
      content: eta.render("barrel.dart.eta", {
        header: GENERATED,
        exports: [`${dir}_client.dart`, `${dir}_repository.dart`],
      }),
    });
  }

  const models = reg.models();
  for (const model of models) files.push(modelFile(eta, model));
  files.push({
    path: "lib/api/models/models.dart",
    content: eta.render("barrel.dart.eta", {
      header: GENERATED,
      exports: models.map((m) => `${m.file}.dart`),
    }),
  });
  files.push({
    path: "lib/api/api_exception.dart",
    content: eta.render("api_exception.dart.eta", { header: GENERATED }),
  });
  files.push({
    path: "lib/api/api.dart",
    content: eta.render("barrel.dart.eta", {
      header: GENERATED,
      exports: [
        "api_exception.dart",
        "models/models.dart",
        ...moduleDirs.map((d) => `${d}/${d}.dart`),
      ].sort(),
    }),
  });

  return files.sort((a, b) => a.path.localeCompare(b.path));
}
