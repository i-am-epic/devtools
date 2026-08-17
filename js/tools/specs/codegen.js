// Turning JSON into other things: type definitions, schemas, queries, diffs.

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`Not valid JSON: ${err.message}`);
    }
}

// ---------------------------------------------------------- type naming --

const pascal = (name) => String(name)
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (c) => c.toUpperCase())
    .replace(/^(\d)/, '_$1') || 'Model';

const snake = (name) => String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '') || 'field';

const singular = (name) => (/(ies)$/.test(name) ? `${name.slice(0, -3)}y`
    : /(sses|shes|ches|xes)$/.test(name) ? name.slice(0, -2)
    : /s$/.test(name) && !/ss$/.test(name) ? name.slice(0, -1)
    : name);

/**
 * Describe a JSON value as a type tree.
 * Arrays are merged across all their elements so an array of similar objects
 * produces one type with optional fields rather than a union of shapes.
 */
function inferType(value, name, registry) {
    if (value === null) return { kind: 'null' };
    if (Array.isArray(value)) {
        if (!value.length) return { kind: 'array', of: { kind: 'unknown' } };
        const merged = value.map((item) => inferType(item, singular(name), registry));
        return { kind: 'array', of: mergeTypes(merged, singular(name), registry) };
    }
    if (typeof value === 'object') {
        const typeName = pascal(name);
        const fields = Object.entries(value).map(([key, child]) => ({
            name: key,
            type: inferType(child, key, registry),
            optional: false,
        }));
        const definition = { kind: 'object', name: typeName, fields };
        registry.push(definition);
        return { kind: 'ref', name: typeName, definition };
    }
    if (typeof value === 'number') return { kind: Number.isInteger(value) ? 'int' : 'float' };
    if (typeof value === 'boolean') return { kind: 'bool' };
    if (typeof value === 'string') {
        if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(value)) return { kind: 'datetime' };
        return { kind: 'string' };
    }
    return { kind: 'unknown' };
}

/** Combine the types seen across array elements into a single shape. */
function mergeTypes(types, name, registry) {
    const objects = types.filter((t) => t.kind === 'ref');
    if (objects.length === types.length && objects.length) {
        const merged = new Map();
        const seenIn = new Map();

        for (const ref of objects) {
            for (const field of ref.definition.fields) {
                if (!merged.has(field.name)) merged.set(field.name, field.type);
                seenIn.set(field.name, (seenIn.get(field.name) || 0) + 1);
            }
            // Drop the per-element definitions; one merged type replaces them.
            const index = registry.indexOf(ref.definition);
            if (index >= 0) registry.splice(index, 1);
        }

        const typeName = pascal(name);
        const definition = {
            kind: 'object',
            name: typeName,
            fields: [...merged.entries()].map(([fieldName, type]) => ({
                name: fieldName,
                type,
                optional: seenIn.get(fieldName) !== objects.length,
            })),
        };
        registry.push(definition);
        return { kind: 'ref', name: typeName, definition };
    }

    const kinds = new Set(types.map((t) => t.kind));
    if (kinds.size === 1) return types[0];
    if (kinds.size === 2 && kinds.has('int') && kinds.has('float')) return { kind: 'float' };
    if (kinds.has('null')) {
        const others = types.filter((t) => t.kind !== 'null');
        if (others.length) return { ...mergeTypes(others, name, registry), nullable: true };
    }
    return { kind: 'unknown' };
}

// ---------------------------------------------------------- emitters ----

const EMITTERS = {
    typescript: {
        label: 'TypeScript',
        ext: 'ts',
        map: { string: 'string', int: 'number', float: 'number', bool: 'boolean', datetime: 'string', null: 'null', unknown: 'unknown' },
        emit(registry, options) {
            const type = (t) => {
                if (t.kind === 'array') return `${type(t.of)}[]`;
                if (t.kind === 'ref') return t.name;
                return this.map[t.kind] || 'unknown';
            };
            return registry.map((def) => {
                const fields = def.fields.map((f) => {
                    const optional = f.optional || f.type.nullable;
                    const key = /^[A-Za-z_$][\w$]*$/.test(f.name) ? f.name : `'${f.name}'`;
                    const nullSuffix = f.type.nullable ? ' | null' : '';
                    return `  ${key}${optional ? '?' : ''}: ${type(f.type)}${nullSuffix};`;
                }).join('\n');
                return `export ${options.readonly ? 'type' : 'interface'} ${def.name} ${options.readonly ? '= ' : ''}{\n${fields}\n}${options.readonly ? ';' : ''}`;
            }).join('\n\n');
        },
    },

    python: {
        label: 'Python (dataclass)',
        ext: 'py',
        map: { string: 'str', int: 'int', float: 'float', bool: 'bool', datetime: 'datetime', null: 'None', unknown: 'Any' },
        emit(registry) {
            const type = (t) => {
                if (t.kind === 'array') return `list[${type(t.of)}]`;
                if (t.kind === 'ref') return t.name;
                return this.map[t.kind] || 'Any';
            };
            const body = registry.map((def) => {
                // Required fields must precede defaulted ones in a dataclass.
                const sorted = [...def.fields].sort((a, b) => Number(a.optional) - Number(b.optional));
                const fields = sorted.map((f) => {
                    const base = type(f.type);
                    const annotated = f.type.nullable ? `Optional[${base}]` : base;
                    return `    ${snake(f.name)}: ${annotated}${f.optional || f.type.nullable ? ' = None' : ''}`;
                }).join('\n');
                return `@dataclass\nclass ${def.name}:\n${fields || '    pass'}`;
            }).join('\n\n\n');

            const needsDatetime = /: datetime|\[datetime\]/.test(body);
            const needsOptional = /Optional\[/.test(body);
            const needsAny = /\bAny\b/.test(body);

            const imports = [
                'from dataclasses import dataclass',
                needsDatetime ? 'from datetime import datetime' : '',
                needsOptional || needsAny
                    ? `from typing import ${[needsAny ? 'Any' : '', needsOptional ? 'Optional' : ''].filter(Boolean).join(', ')}`
                    : '',
            ].filter(Boolean).join('\n');

            return `${imports}\n\n\n${body}\n`;
        },
    },

    go: {
        label: 'Go (struct)',
        ext: 'go',
        map: { string: 'string', int: 'int64', float: 'float64', bool: 'bool', datetime: 'time.Time', null: 'interface{}', unknown: 'interface{}' },
        emit(registry) {
            const type = (t) => {
                if (t.kind === 'array') return `[]${type(t.of)}`;
                if (t.kind === 'ref') return t.name;
                return this.map[t.kind] || 'interface{}';
            };
            const body = registry.map((def) => {
                const fields = def.fields.map((f) => {
                    const pointer = f.optional || f.type.nullable ? '*' : '';
                    const omit = f.optional ? ',omitempty' : '';
                    return `\t${pascal(f.name)} ${pointer}${type(f.type)} \`json:"${f.name}${omit}"\``;
                }).join('\n');
                return `type ${def.name} struct {\n${fields}\n}`;
            }).join('\n\n');

            return /time\.Time/.test(body)
                ? `package main\n\nimport "time"\n\n${body}\n`
                : `package main\n\n${body}\n`;
        },
    },

    csharp: {
        label: 'C# (record)',
        ext: 'cs',
        map: { string: 'string', int: 'long', float: 'double', bool: 'bool', datetime: 'DateTime', null: 'object', unknown: 'object' },
        emit(registry) {
            const type = (t) => {
                if (t.kind === 'array') return `List<${type(t.of)}>`;
                if (t.kind === 'ref') return t.name;
                return this.map[t.kind] || 'object';
            };
            const body = registry.map((def) => {
                const fields = def.fields.map((f) => {
                    const nullable = f.optional || f.type.nullable ? '?' : '';
                    return `    [JsonPropertyName("${f.name}")]\n    public ${type(f.type)}${nullable} ${pascal(f.name)} { get; init; }`;
                }).join('\n\n');
                return `public record ${def.name}\n{\n${fields}\n}`;
            }).join('\n\n');
            return `using System;\nusing System.Collections.Generic;\nusing System.Text.Json.Serialization;\n\n${body}\n`;
        },
    },

    rust: {
        label: 'Rust (serde)',
        ext: 'rs',
        map: { string: 'String', int: 'i64', float: 'f64', bool: 'bool', datetime: 'String', null: 'serde_json::Value', unknown: 'serde_json::Value' },
        emit(registry) {
            const type = (t) => {
                if (t.kind === 'array') return `Vec<${type(t.of)}>`;
                if (t.kind === 'ref') return t.name;
                return this.map[t.kind] || 'serde_json::Value';
            };
            const body = registry.map((def) => {
                const fields = def.fields.map((f) => {
                    const inner = type(f.type);
                    const wrapped = f.optional || f.type.nullable ? `Option<${inner}>` : inner;
                    const renamed = snake(f.name) !== f.name ? `    #[serde(rename = "${f.name}")]\n` : '';
                    return `${renamed}    pub ${snake(f.name)}: ${wrapped},`;
                }).join('\n');
                return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${def.name} {\n${fields}\n}`;
            }).join('\n\n');
            return `use serde::{Deserialize, Serialize};\n\n${body}\n`;
        },
    },

    java: {
        label: 'Java (record)',
        ext: 'java',
        map: { string: 'String', int: 'long', float: 'double', bool: 'boolean', datetime: 'Instant', null: 'Object', unknown: 'Object' },
        emit(registry) {
            const type = (t) => {
                if (t.kind === 'array') return `List<${this.boxed(type(t.of))}>`;
                if (t.kind === 'ref') return t.name;
                return this.map[t.kind] || 'Object';
            };
            return registry.map((def) => {
                const fields = def.fields.map((f) => `    @JsonProperty("${f.name}") ${type(f.type)} ${f.name.replace(/[^\w]/g, '_')}`).join(',\n');
                return `public record ${def.name}(\n${fields}\n) {}`;
            }).join('\n\n');
        },
        boxed(t) {
            return { long: 'Long', double: 'Double', boolean: 'Boolean', int: 'Integer' }[t] || t;
        },
    },
};

// ---------------------------------------------------------- JSON Schema --

function toJsonSchema(value, options, name = 'root') {
    if (value === null) return { type: 'null' };

    if (Array.isArray(value)) {
        if (!value.length) return { type: 'array', items: {} };
        const itemSchemas = value.slice(0, 200).map((item) => toJsonSchema(item, options, singular(name)));
        return { type: 'array', items: mergeSchemas(itemSchemas) };
    }

    if (typeof value === 'object') {
        const properties = {};
        for (const [key, child] of Object.entries(value)) {
            properties[key] = toJsonSchema(child, options, key);
        }
        const schema = { type: 'object', properties };
        if (options.required) schema.required = Object.keys(value);
        if (options.additional === false) schema.additionalProperties = false;
        return schema;
    }

    if (typeof value === 'number') {
        const schema = { type: Number.isInteger(value) ? 'integer' : 'number' };
        if (options.examples) schema.examples = [value];
        return schema;
    }

    if (typeof value === 'boolean') return { type: 'boolean' };

    const schema = { type: 'string' };
    if (options.formats) {
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) schema.format = 'date-time';
        else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) schema.format = 'date';
        else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) schema.format = 'email';
        else if (/^https?:\/\//.test(value)) schema.format = 'uri';
        else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) schema.format = 'uuid';
        else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) schema.format = 'ipv4';
    }
    if (options.examples && value.length < 60) schema.examples = [value];
    return schema;
}

function mergeSchemas(schemas) {
    if (!schemas.length) return {};
    if (schemas.length === 1) return schemas[0];

    const types = new Set(schemas.map((s) => s.type));
    if (types.size > 1) {
        if (types.size === 2 && types.has('integer') && types.has('number')) {
            return { type: 'number' };
        }
        return { anyOf: [...new Map(schemas.map((s) => [JSON.stringify(s), s])).values()] };
    }

    const type = schemas[0].type;
    if (type !== 'object') return schemas[0];

    const properties = {};
    const counts = new Map();
    for (const schema of schemas) {
        for (const [key, sub] of Object.entries(schema.properties || {})) {
            if (!properties[key]) properties[key] = sub;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    const merged = { type: 'object', properties };
    const always = [...counts.entries()].filter(([, n]) => n === schemas.length).map(([k]) => k);
    if (always.length && schemas[0].required) merged.required = always;
    if (schemas[0].additionalProperties === false) merged.additionalProperties = false;
    return merged;
}

// ------------------------------------------------------------ JSONPath --

/** Minimal JSONPath: $, dot/bracket access, [*], [n], [start:end], .. */
function jsonPath(data, path) {
    const expression = path.trim();
    if (!expression || expression === '$') return [data];
    if (!expression.startsWith('$')) throw new Error('A JSONPath expression must start with $');

    const tokens = [];
    const pattern = /\.\.(\w+)|\.(\*|\w+)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\*)\s*\]|\[\s*(-?\d+)\s*\]|\[\s*(-?\d*)\s*:\s*(-?\d*)\s*\]|\[\?\(([^)]*)\)\]/g;

    let index = 1;
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(expression)) !== null) {
        if (match.index !== index) {
            throw new Error(`Could not parse the expression at "${expression.slice(match.index === 0 ? 0 : index, match.index + 6)}"`);
        }
        index = pattern.lastIndex;

        if (match[1] !== undefined) tokens.push({ type: 'recursive', name: match[1] });
        else if (match[2] !== undefined) tokens.push(match[2] === '*' ? { type: 'wildcard' } : { type: 'name', name: match[2] });
        else if (match[3] !== undefined) tokens.push({ type: 'name', name: match[3] });
        else if (match[4] !== undefined) tokens.push({ type: 'name', name: match[4] });
        else if (match[5] !== undefined) tokens.push({ type: 'wildcard' });
        else if (match[6] !== undefined) tokens.push({ type: 'index', index: Number(match[6]) });
        else if (match[7] !== undefined || match[8] !== undefined) {
            tokens.push({ type: 'slice', start: match[7] === '' ? null : Number(match[7]), end: match[8] === '' ? null : Number(match[8]) });
        } else if (match[9] !== undefined) tokens.push({ type: 'filter', expression: match[9] });
    }

    if (index !== expression.length) {
        throw new Error(`Could not parse the expression from "${expression.slice(index)}"`);
    }

    let current = [data];
    for (const token of tokens) {
        const next = [];
        for (const node of current) {
            if (node === null || node === undefined) continue;

            switch (token.type) {
                case 'name':
                    if (typeof node === 'object' && !Array.isArray(node) && token.name in node) next.push(node[token.name]);
                    else if (Array.isArray(node)) {
                        for (const item of node) {
                            if (item && typeof item === 'object' && token.name in item) next.push(item[token.name]);
                        }
                    }
                    break;
                case 'wildcard':
                    if (Array.isArray(node)) next.push(...node);
                    else if (typeof node === 'object') next.push(...Object.values(node));
                    break;
                case 'index': {
                    if (!Array.isArray(node)) break;
                    const i = token.index < 0 ? node.length + token.index : token.index;
                    if (i >= 0 && i < node.length) next.push(node[i]);
                    break;
                }
                case 'slice': {
                    if (!Array.isArray(node)) break;
                    next.push(...node.slice(token.start ?? 0, token.end ?? node.length));
                    break;
                }
                case 'recursive': {
                    const walk = (value) => {
                        if (value === null || typeof value !== 'object') return;
                        if (!Array.isArray(value) && token.name in value) next.push(value[token.name]);
                        for (const child of Object.values(value)) walk(child);
                    };
                    walk(node);
                    break;
                }
                case 'filter': {
                    const items = Array.isArray(node) ? node : [node];
                    const test = /^\s*@\.([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/.exec(token.expression);
                    if (!test) throw new Error('Only simple filters like [?(@.price > 10)] are supported');
                    const [, field, operator, rawValue] = test;
                    const wanted = /^['"]/.test(rawValue) ? rawValue.slice(1, -1) : Number(rawValue);

                    for (const item of items) {
                        if (!item || typeof item !== 'object') continue;
                        const actual = field.split('.').reduce((acc, key) => acc?.[key], item);
                        if (actual === undefined) continue;
                        const ok = {
                            '==': actual === wanted || String(actual) === String(wanted),
                            '!=': String(actual) !== String(wanted),
                            '>': actual > wanted,
                            '<': actual < wanted,
                            '>=': actual >= wanted,
                            '<=': actual <= wanted,
                        }[operator];
                        if (ok) next.push(item);
                    }
                    break;
                }
                default:
                    break;
            }
        }
        current = next;
    }

    return current;
}

// ------------------------------------------------------------ JSON diff --

function jsonDiff(left, right, path = '$', out = []) {
    const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    const leftType = typeOf(left);
    const rightType = typeOf(right);

    if (leftType !== rightType) {
        out.push({ path, kind: 'type', left, right });
        return out;
    }

    if (leftType === 'object') {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of [...keys].sort()) {
            const childPath = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}['${key}']`;
            if (!(key in left)) out.push({ path: childPath, kind: 'added', right: right[key] });
            else if (!(key in right)) out.push({ path: childPath, kind: 'removed', left: left[key] });
            else jsonDiff(left[key], right[key], childPath, out);
        }
        return out;
    }

    if (leftType === 'array') {
        const max = Math.max(left.length, right.length);
        for (let i = 0; i < max; i++) {
            const childPath = `${path}[${i}]`;
            if (i >= left.length) out.push({ path: childPath, kind: 'added', right: right[i] });
            else if (i >= right.length) out.push({ path: childPath, kind: 'removed', left: left[i] });
            else jsonDiff(left[i], right[i], childPath, out);
        }
        return out;
    }

    if (left !== right) out.push({ path, kind: 'changed', left, right });
    return out;
}

const preview = (value) => {
    if (value === undefined) return '';
    const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : JSON.stringify(value);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

const SAMPLE = `{
  "id": 1042,
  "name": "Ada Lovelace",
  "active": true,
  "score": 91.5,
  "joined": "2024-03-01T09:30:00Z",
  "tags": ["maths", "computing"],
  "address": { "city": "London", "postcode": "W1A 1AA" },
  "orders": [
    { "ref": "A-1", "total": 25.5, "shipped": true },
    { "ref": "A-2", "total": 10, "shipped": false, "note": "gift" }
  ]
}`;

export const codegenTools = [
    {
        id: 'json-to-types',
        name: 'JSON to Types',
        description: 'Generate TypeScript, Python, Go, C#, Rust or Java models from a JSON sample.',
        category: 'codegen',
        icon: '{ }→',
        keywords: ['json', 'typescript', 'interface', 'type', 'python', 'dataclass', 'go', 'struct',
            'csharp', 'c#', 'record', 'rust', 'serde', 'java', 'pojo', 'generate', 'model', 'class', 'codegen'],
        spec: {
            lede: 'Paste a real API response and get typed models. Arrays of objects are merged, so a field missing from some elements becomes optional rather than producing several near-identical types.',
            input: { label: 'JSON sample', placeholder: '{ "id": 1 }', sample: SAMPLE },
            output: { label: 'Generated types', filename: 'models.ts' },
            options: [
                { id: 'language', type: 'select', label: 'Language', default: 'typescript',
                  choices: Object.entries(EMITTERS).map(([value, e]) => ({ value, label: e.label })) },
                { id: 'rootName', type: 'text', label: 'Root type name', default: 'Root' },
                { id: 'readonly', type: 'checkbox', label: 'TypeScript: emit type aliases instead of interfaces', default: false },
            ],
            run: ({ input, options }) => {
                const value = parseJson(input);
                const emitter = EMITTERS[options.language];

                const registry = [];
                const root = inferType(
                    Array.isArray(value) ? value : value,
                    options.rootName || 'Root',
                    registry,
                );

                if (!registry.length) {
                    throw new Error('The sample has no objects to turn into types — provide an object or an array of objects.');
                }

                // Deepest-first reads better: dependencies appear before use.
                const unique = [];
                const seen = new Set();
                for (const def of registry) {
                    if (seen.has(def.name)) {
                        // Two different shapes wanted the same name; disambiguate.
                        let suffix = 2;
                        while (seen.has(`${def.name}${suffix}`)) suffix++;
                        def.name = `${def.name}${suffix}`;
                    }
                    seen.add(def.name);
                    unique.push(def);
                }

                const code = emitter.emit.call(emitter, unique, options);
                const rootNote = root.kind === 'array' ? ` (root is an array of ${root.of.name || 'values'})` : '';

                return {
                    output: code,
                    filename: `models.${emitter.ext}`,
                    note: `${unique.length} type${unique.length === 1 ? '' : 's'}${rootNote}`,
                };
            },
            footnote: 'Types are inferred from one sample, so anything absent from it cannot be known — a field that is always null here becomes <code>null</code>/<code>None</code>, and a field the API sometimes omits will only be optional if your sample actually varies. Treat the output as a strong first draft, not a contract.',
        },
    },

    {
        id: 'json-schema-generator',
        name: 'JSON Schema Generator',
        description: 'Infer a JSON Schema (draft 2020-12) from an example document.',
        category: 'codegen',
        icon: '⊨',
        keywords: ['json schema', 'schema', 'validate', 'draft', 'openapi', 'generate', 'infer', 'contract'],
        spec: {
            lede: 'Turns a sample payload into a schema you can validate against, detecting formats like date-time, email, uri and uuid.',
            input: { label: 'JSON sample', placeholder: '{ "id": 1 }', sample: SAMPLE },
            output: { label: 'JSON Schema', filename: 'schema.json' },
            options: [
                { id: 'required', type: 'checkbox', label: 'Mark present properties as required', default: true },
                { id: 'formats', type: 'checkbox', label: 'Detect string formats', default: true },
                { id: 'examples', type: 'checkbox', label: 'Include examples', default: false },
                { id: 'additional', type: 'checkbox', label: 'Forbid additional properties', default: false },
                { id: 'title', type: 'text', label: 'Title', default: '' },
            ],
            run: ({ input, options }) => {
                const value = parseJson(input);
                const schema = {
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    ...(options.title ? { title: options.title } : {}),
                    ...toJsonSchema(value, options),
                };

                let properties = 0;
                const walk = (node) => {
                    if (!node || typeof node !== 'object') return;
                    if (node.properties) properties += Object.keys(node.properties).length;
                    Object.values(node).forEach(walk);
                };
                walk(schema);

                return {
                    output: JSON.stringify(schema, null, 2),
                    note: `${properties} propert${properties === 1 ? 'y' : 'ies'} described`,
                };
            },
        },
    },

    {
        id: 'jsonpath',
        name: 'JSONPath Evaluator',
        description: 'Query a JSON document with JSONPath and see exactly what matches.',
        category: 'codegen',
        icon: '$.',
        keywords: ['jsonpath', 'json', 'query', 'path', 'filter', 'extract', 'search', 'select', 'jq'],
        spec: {
            lede: 'Supports $.a.b, [*], [0], [1:3], recursive .., and simple filters like [?(@.total > 10)].',
            input: { label: 'JSON', placeholder: '{ "a": 1 }', sample: SAMPLE },
            output: { label: 'Matches', filename: 'matches.json' },
            options: [
                { id: 'path', type: 'text', label: 'JSONPath', default: '$.orders[*].ref', placeholder: '$.store.book[0].title' },
                { id: 'flatten', type: 'checkbox', label: 'Unwrap a single match', default: false },
            ],
            run: ({ input, options }) => {
                const data = parseJson(input);
                if (!options.path?.trim()) return '';

                const matches = jsonPath(data, options.path);

                const output = options.flatten && matches.length === 1
                    ? JSON.stringify(matches[0], null, 2)
                    : JSON.stringify(matches, null, 2);

                const examples = [
                    ['$.name', 'a top-level field'],
                    ['$.orders[*].ref', 'one field from every array element'],
                    ['$.orders[0]', 'the first element'],
                    ['$.orders[?(@.total > 10)]', 'filter by a comparison'],
                    ['$..city', 'find a key at any depth'],
                    ['$.tags[0:2]', 'a slice'],
                ];

                return {
                    output,
                    note: `${matches.length} match${matches.length === 1 ? '' : 'es'}`,
                    extraHtml: `
                        <div class="tool-section">
                            <div class="alert ${matches.length ? 'ok' : 'warn'}">
                                <span>${matches.length ? '✓' : '!'}</span>
                                <span>${matches.length
                                    ? `${matches.length} match${matches.length === 1 ? '' : 'es'} for <code>${escapeHtml(options.path)}</code>`
                                    : `Nothing matched <code>${escapeHtml(options.path)}</code>`}</span>
                            </div>
                            <h3>Syntax</h3>
                            <div class="table-wrap" style="max-height:260px;">
                                <table class="data">
                                    <tbody>
                                        ${examples.map(([expr, what]) => `
                                            <tr>
                                                <td style="width:230px"><span class="copy-cell"><span>${escapeHtml(expr)}</span>
                                                    <button class="copy-chip" data-copy="${escapeHtml(expr)}">Copy</button></span></td>
                                                <td style="white-space:normal">${what}</td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'json-diff',
        name: 'JSON Diff',
        description: 'Compare two JSON documents structurally — by path, not by line.',
        category: 'codegen',
        icon: '{≠}',
        keywords: ['json', 'diff', 'compare', 'difference', 'change', 'structural', 'merge', 'api'],
        spec: {
            lede: 'Key order and formatting are ignored; only real differences are reported, each with the path you would use to reach it.',
            input: {
                label: 'Original JSON',
                placeholder: '{ "a": 1 }',
                sample: '{\n  "name": "service",\n  "replicas": 3,\n  "ports": [8080, 8443],\n  "env": { "LOG_LEVEL": "info", "REGION": "eu-west-1" }\n}',
            },
            output: { label: 'Differences', filename: 'json-diff.txt' },
            options: [
                { id: 'other', type: 'text', label: 'Compare against (paste JSON here)',
                  default: '{"name":"service","replicas":5,"ports":[8080,9090,443],"env":{"LOG_LEVEL":"debug"},"owner":"platform"}' },
            ],
            run: ({ input, options }) => {
                const left = parseJson(input);
                let right;
                try {
                    right = JSON.parse(options.other || 'null');
                } catch (err) {
                    throw new Error(`The comparison JSON is not valid: ${err.message}`);
                }

                const differences = jsonDiff(left, right);

                if (!differences.length) {
                    return {
                        output: 'The two documents are structurally identical.',
                        note: 'identical',
                        extraHtml: '<div class="tool-section"><div class="alert ok"><span>✓</span><span>No differences — the documents are equivalent.</span></div></div>',
                    };
                }

                const counts = differences.reduce((acc, d) => {
                    acc[d.kind] = (acc[d.kind] || 0) + 1;
                    return acc;
                }, {});

                const symbols = { added: '+', removed: '−', changed: '~', type: '!' };
                const colours = { added: 'var(--green)', removed: 'var(--red)', changed: '#c9a800', type: 'var(--purple)' };

                const text = differences.map((d) => {
                    if (d.kind === 'added') return `+ ${d.path} = ${preview(d.right)}`;
                    if (d.kind === 'removed') return `- ${d.path} = ${preview(d.left)}`;
                    if (d.kind === 'type') return `! ${d.path}: type changed — ${preview(d.left)} → ${preview(d.right)}`;
                    return `~ ${d.path}: ${preview(d.left)} → ${preview(d.right)}`;
                }).join('\n');

                return {
                    output: text,
                    note: Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', '),
                    extraHtml: `
                        <div class="tool-section">
                            <div class="stat-grid">
                                ${['added', 'removed', 'changed', 'type'].filter((k) => counts[k]).map((k) => `
                                    <div class="stat-tile">
                                        <div class="stat-label">${k === 'type' ? 'Type changed' : k}</div>
                                        <div class="stat-value" style="color:${colours[k]}">${counts[k]}</div>
                                    </div>`).join('')}
                            </div>
                            <div class="table-wrap">
                                <table class="data">
                                    <thead><tr><th style="width:40px"></th><th>Path</th><th>Original</th><th>Changed</th></tr></thead>
                                    <tbody>
                                        ${differences.slice(0, 500).map((d) => `
                                            <tr>
                                                <td style="color:${colours[d.kind]};font-weight:800">${symbols[d.kind]}</td>
                                                <td><span class="copy-cell"><span>${escapeHtml(d.path)}</span>
                                                    <button class="copy-chip" data-copy="${escapeHtml(d.path)}">Copy</button></span></td>
                                                <td>${d.left === undefined ? '<span class="nul">—</span>' : escapeHtml(preview(d.left))}</td>
                                                <td>${d.right === undefined ? '<span class="nul">—</span>' : escapeHtml(preview(d.right))}</td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
        },
    },
];

export { jsonPath, jsonDiff, toJsonSchema, inferType, EMITTERS };
