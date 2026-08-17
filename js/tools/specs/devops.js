// DevOps tooling: YAML formatting, and lint/validation for the config files
// that break deployments — Dockerfile, docker-compose, Kubernetes manifests
// and GitHub Actions workflows.
//
// These are opinionated checks, not schema validators. Each one says what it
// does and does not cover.

import { libs } from '../../lib/loader.js';
import { utf8ToBytes, bytesToBase64, base64ToBytes, bytesToUtf8 } from '../../lib/bytes.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const statTile = (label, value, sub = '') => `
    <div class="stat-tile">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;

/** Shared findings table used by every linter here. */
function findingsReport(findings, okMessage) {
    const errors = findings.filter((f) => f.level === 'error').length;
    const warnings = findings.filter((f) => f.level === 'warn').length;
    const infos = findings.filter((f) => f.level === 'info').length;

    const colour = { error: 'var(--red)', warn: '#c9a800', info: 'var(--blue)' };

    const banner = findings.length
        ? `<div class="alert ${errors ? 'err' : warnings ? 'warn' : 'info'}">
               <span>${errors ? '✕' : warnings ? '!' : 'ℹ'}</span>
               <span>${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${infos} note${infos === 1 ? '' : 's'}</span>
           </div>`
        : `<div class="alert ok"><span>✓</span><span>${okMessage}</span></div>`;

    const table = findings.length ? `
        <div class="table-wrap" style="max-height:460px;">
            <table class="data">
                <thead><tr><th style="width:60px">Line</th><th style="width:80px">Level</th><th style="width:150px">Rule</th><th>Finding</th></tr></thead>
                <tbody>
                    ${findings.map((f) => `
                        <tr>
                            <td class="num">${f.line ?? '—'}</td>
                            <td style="color:${colour[f.level]};font-weight:800">${f.level}</td>
                            <td>${escapeHtml(f.rule)}</td>
                            <td style="white-space:normal;max-width:none">${f.message}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>` : '';

    return { banner, table, errors, warnings, infos };
}

const asText = (findings, okMessage) => (findings.length
    ? findings.map((f) => `line ${String(f.line ?? '-').padStart(4)}  ${f.level.toUpperCase().padEnd(5)}  ${f.rule.padEnd(22)}  ${f.message.replace(/<[^>]+>/g, '')}`).join('\n')
    : okMessage);

/** Cheap line lookup for a key in a YAML document. */
function lineOf(text, pattern) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) return i + 1;
    }
    return null;
}

// --------------------------------------------------------------------------

export const devopsTools = [
    {
        id: 'yaml-formatter',
        name: 'YAML Beautifier',
        description: 'Reformat and normalise YAML with consistent indentation and quoting.',
        category: 'devops',
        icon: 'Y{}',
        keywords: ['yaml', 'yml', 'format', 'beautify', 'pretty', 'indent', 'normalise', 'normalize',
            'sort', 'lint', 'clean', 'kubernetes', 'compose', 'ansible', 'devops'],
        spec: {
            lede: 'Parses the YAML then re-emits it, so the output is guaranteed to be equivalent — and anything that will not parse is reported instead of silently mangled.',
            input: {
                label: 'YAML',
                accept: '.yaml,.yml,.txt',
                placeholder: 'key: value',
                sample: `name:    my-service
replicas: 3
image:   "nginx:1.25"
env:
    - name: LOG_LEVEL
      value: debug
    - name: PORT
      value: "8080"
resources:
      limits: {cpu: 500m, memory: 512Mi}
      requests: {cpu: 250m, memory: 256Mi}
enabled: yes
empty:
`,
            },
            output: { label: 'Formatted', filename: 'formatted.yaml' },
            options: [
                { id: 'indent', type: 'number', label: 'Indent', default: 2, min: 1, max: 8 },
                { id: 'sortKeys', type: 'checkbox', label: 'Sort keys alphabetically', default: false },
                { id: 'quoteStrings', type: 'checkbox', label: 'Quote every string', default: false },
                { id: 'lineWidth', type: 'number', label: 'Wrap at column (0 = never)', default: 0, min: 0, max: 400 },
                { id: 'explicitStart', type: 'checkbox', label: 'Start documents with ---', default: false },
            ],
            run: async ({ input, options }) => {
                const yaml = await libs.yaml();

                let documents;
                try {
                    documents = yaml.loadAll(input);
                } catch (err) {
                    const message = err.message.split('\n').slice(0, 3).join(' ').trim();
                    throw new Error(message);
                }

                if (!documents.length || (documents.length === 1 && documents[0] === undefined)) {
                    throw new Error('That YAML is empty.');
                }

                const dumpOptions = {
                    indent: options.indent,
                    lineWidth: options.lineWidth > 0 ? options.lineWidth : -1,
                    noRefs: true,
                    sortKeys: options.sortKeys,
                    quotingType: '"',
                    forceQuotes: options.quoteStrings,
                };

                const formatted = documents
                    .map((document) => yaml.dump(document, dumpOptions))
                    .join('---\n');

                const output = (options.explicitStart ? '---\n' : '') + formatted;

                // Things that are legal YAML but usually a mistake.
                const notes = [];
                if (/^\s*\w+\s*:\s*(yes|no|on|off)\s*$/im.test(input)) {
                    notes.push('Unquoted <code>yes</code>/<code>no</code>/<code>on</code>/<code>off</code> parse as booleans in YAML 1.1 — quote them if you meant the words. (The classic "Norway problem": <code>NO</code> becomes <code>false</code>.)');
                }
                if (/:\s*\d{2,}:\d{2}/.test(input)) {
                    notes.push('A bare <code>hh:mm</code> value can be read as a sexagesimal number — quote it.');
                }
                if (/\t/.test(input)) {
                    notes.push('The source contains tab characters. YAML forbids tabs for indentation; they have been normalised to spaces.');
                }

                return {
                    output,
                    note: `${documents.length} document${documents.length === 1 ? '' : 's'} · ${output.split('\n').length} lines`,
                    extraHtml: notes.length ? `
                        <div class="tool-section">
                            <div class="alert warn"><span>!</span><span>${notes.join('<br><br>')}</span></div>
                        </div>` : '',
                };
            },
            footnote: 'Re-emitting normalises the document: comments are <strong>not</strong> preserved, because YAML comments are not part of the parsed data. If you need comments kept, format by hand or use a comment-preserving tool such as <code>yq</code>.',
        },
    },

    {
        id: 'dockerfile-linter',
        name: 'Dockerfile Linter',
        description: 'Catch cache-busting layer order, missing USER, latest tags and other Dockerfile mistakes.',
        category: 'devops',
        icon: '🐳',
        keywords: ['docker', 'dockerfile', 'lint', 'check', 'best practice', 'hadolint', 'image',
            'layer', 'cache', 'security', 'container', 'build', 'devops'],
        spec: {
            lede: 'The checks that actually bite: images that rebuild from scratch on every code change, containers running as root, and unpinned tags.',
            input: {
                label: 'Dockerfile',
                accept: '*',
                placeholder: 'FROM node:20\n…',
                sample: `FROM node:latest

WORKDIR /app

COPY . .
RUN npm install
RUN apt-get update
RUN apt-get install -y curl

ADD https://example.com/tool.tar.gz /tmp/

ENV API_KEY=sk-supersecret

EXPOSE 3000
CMD npm start`,
            },
            output: { label: 'Report', filename: 'dockerfile-report.txt' },
            run: ({ input }) => {
                const lines = input.split('\n');
                const findings = [];
                const add = (line, level, rule, message) => findings.push({ line, level, rule, message });

                const instructions = [];
                lines.forEach((raw, index) => {
                    const line = raw.trim();
                    if (!line || line.startsWith('#')) return;
                    const match = /^(\w+)\s+(.*)$/s.exec(line);
                    if (match) instructions.push({ line: index + 1, name: match[1].toUpperCase(), args: match[2], raw: line });
                });

                if (!instructions.length) throw new Error('No Dockerfile instructions found.');
                if (instructions[0].name !== 'FROM' && instructions[0].name !== 'ARG') {
                    add(instructions[0].line, 'error', 'first-instruction', 'A Dockerfile must begin with <code>FROM</code> (or <code>ARG</code> before it).');
                }

                let sawUser = false;
                let sawHealthcheck = false;
                let firstCopyAll = null;
                let lastDependencyInstall = null;

                for (const instruction of instructions) {
                    const { line, name, args } = instruction;

                    if (name === 'FROM') {
                        if (/:latest\b/.test(args) || !/[:@]/.test(args.split(/\s+/)[0])) {
                            add(line, 'error', 'pin-base-image',
                                'Base image is unpinned or uses <code>:latest</code> — the build is not reproducible. Pin a version, ideally by digest (<code>image@sha256:…</code>).');
                        }
                    }

                    if (name === 'RUN') {
                        if (/\bapt-get\s+install\b/.test(args) && !/apt-get\s+update/.test(args)) {
                            add(line, 'error', 'apt-update-separate',
                                '<code>apt-get install</code> in a separate layer from <code>apt-get update</code> — the cached update layer goes stale and installs old or missing packages. Combine them with <code>&amp;&amp;</code>.');
                        }
                        if (/\bapt-get\s+install\b/.test(args) && !/--no-install-recommends/.test(args)) {
                            add(line, 'warn', 'no-install-recommends',
                                'Add <code>--no-install-recommends</code> to avoid pulling in packages you did not ask for.');
                        }
                        if (/\bapt-get\b/.test(args) && !/rm\s+-rf\s+\/var\/lib\/apt\/lists/.test(args)) {
                            add(line, 'warn', 'clean-apt-lists',
                                'Clean the package lists in the same layer (<code>rm -rf /var/lib/apt/lists/*</code>) or they stay in the image.');
                        }
                        if (/\b(npm\s+install|npm\s+ci|pip\s+install|yarn\s+install|go\s+mod\s+download|dotnet\s+restore)\b/.test(args)) {
                            lastDependencyInstall = line;
                        }
                        if (/\bsudo\b/.test(args)) {
                            add(line, 'warn', 'no-sudo', 'No need for <code>sudo</code> in a Dockerfile — use <code>USER</code> instead.');
                        }
                        if (/\bcurl\b[^|]*\|\s*(ba)?sh/.test(args)) {
                            add(line, 'warn', 'curl-pipe-shell',
                                'Piping a downloaded script straight into a shell executes whatever the server returns at build time, unverified.');
                        }
                    }

                    if (name === 'COPY' || name === 'ADD') {
                        if (/^\.\s+\.?/.test(args) || /^\.\s/.test(args)) {
                            if (firstCopyAll === null) firstCopyAll = line;
                        }
                        if (name === 'ADD' && /^https?:\/\//.test(args)) {
                            add(line, 'warn', 'add-remote-url',
                                '<code>ADD</code> with a URL does not verify the download and cannot be cached well. Use <code>RUN curl</code> with a checksum, or <code>COPY</code> a vendored file.');
                        }
                        if (name === 'ADD' && !/^https?:\/\//.test(args) && !/\.(tar|tgz|tar\.gz|tar\.bz2|tar\.xz|zip)\b/.test(args)) {
                            add(line, 'info', 'prefer-copy', '<code>COPY</code> is preferred over <code>ADD</code> unless you want automatic archive extraction.');
                        }
                    }

                    if (name === 'USER') sawUser = true;
                    if (name === 'HEALTHCHECK') sawHealthcheck = true;

                    if (name === 'ENV' || name === 'ARG') {
                        if (/(?:^|\s)(\w*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)\w*)\s*=\s*\S/i.test(args)) {
                            add(line, 'error', 'secret-in-image',
                                'This looks like a credential baked into the image. Every layer is readable by anyone who can pull it — pass secrets at runtime or use BuildKit secret mounts.');
                        }
                    }

                    if ((name === 'CMD' || name === 'ENTRYPOINT') && !args.trim().startsWith('[')) {
                        add(line, 'warn', 'exec-form',
                            `Shell form <code>${name} ${escapeHtml(args.slice(0, 30))}…</code> runs under <code>/bin/sh -c</code>, so your process is not PID 1 and will not receive SIGTERM. Use the exec form: <code>${name} ["npm", "start"]</code>.`);
                    }

                    if (name === 'MAINTAINER') {
                        add(line, 'info', 'deprecated', '<code>MAINTAINER</code> is deprecated — use <code>LABEL maintainer=…</code>.');
                    }

                    if (name === 'WORKDIR' && !args.startsWith('/') && !args.startsWith('$')) {
                        add(line, 'warn', 'absolute-workdir', 'Use an absolute path for <code>WORKDIR</code>.');
                    }
                }

                if (firstCopyAll !== null && lastDependencyInstall !== null && firstCopyAll < lastDependencyInstall) {
                    add(firstCopyAll, 'error', 'layer-order',
                        `<code>COPY . .</code> before the dependency install on line ${lastDependencyInstall} busts the layer cache on <em>every</em> source change, so dependencies reinstall each build. Copy the manifest first, install, then copy the rest.`);
                }

                if (!sawUser) {
                    add(null, 'error', 'run-as-non-root',
                        'No <code>USER</code> instruction — the container runs as root. Add a non-root user and switch to it before <code>CMD</code>.');
                }
                if (!sawHealthcheck) {
                    add(null, 'info', 'healthcheck', 'No <code>HEALTHCHECK</code> — orchestrators cannot tell whether the process is actually serving.');
                }
                if (!instructions.some((i) => i.name === 'CMD' || i.name === 'ENTRYPOINT')) {
                    add(null, 'error', 'no-entrypoint', 'Neither <code>CMD</code> nor <code>ENTRYPOINT</code> — the image has nothing to run.');
                }

                const stages = instructions.filter((i) => i.name === 'FROM').length;
                if (stages === 1 && instructions.some((i) => /\b(npm|yarn|pip|go build|dotnet publish|mvn|gradle)\b/.test(i.args))) {
                    add(null, 'info', 'multi-stage',
                        'Single-stage build with a toolchain in it — a multi-stage build would leave the compilers and caches out of the final image.');
                }

                findings.sort((a, b) => (a.line ?? 9999) - (b.line ?? 9999));
                const report = findingsReport(findings, 'No problems found.');

                return {
                    output: asText(findings, 'No problems found.'),
                    note: `${report.errors} errors, ${report.warnings} warnings`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${report.banner}
                            <div class="stat-grid">
                                ${statTile('Instructions', String(instructions.length))}
                                ${statTile('Build stages', String(stages))}
                                ${statTile('Errors', String(report.errors))}
                                ${statTile('Warnings', String(report.warnings))}
                            </div>
                            ${report.table}
                        </div>`,
                };
            },
            footnote: 'These are heuristics over the instruction list, not a full parse — heredocs, line continuations inside strings and BuildKit-specific syntax may confuse them. For CI, run <code>hadolint</code> as well.',
        },
    },

    {
        id: 'compose-validator',
        name: 'Docker Compose Validator',
        description: 'Validate a compose file and flag port clashes, missing images and risky settings.',
        category: 'devops',
        icon: '🐙',
        keywords: ['docker', 'compose', 'docker-compose', 'validate', 'lint', 'yaml', 'services',
            'ports', 'volumes', 'check', 'devops'],
        spec: {
            lede: 'Parses the YAML, then checks the things a schema will not: duplicate host ports, services depending on names that do not exist, and containers given more privilege than they need.',
            input: {
                label: 'docker-compose.yml',
                accept: '.yaml,.yml',
                placeholder: 'services:\n  web:\n    image: nginx',
                sample: `version: "3.8"
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    depends_on:
      - api
    environment:
      - DB_PASSWORD=hunter2
  api:
    build: .
    ports:
      - "8080:3000"
    privileged: true
    volumes:
      - /:/host
    restart: always
  worker:
    image: myapp/worker
    depends_on:
      - queue
`,
            },
            output: { label: 'Report', filename: 'compose-report.txt' },
            run: async ({ input }) => {
                const yaml = await libs.yaml();
                let document;
                try {
                    document = yaml.load(input);
                } catch (err) {
                    throw new Error(err.message.split('\n').slice(0, 3).join(' ').trim());
                }

                if (!document || typeof document !== 'object') throw new Error('That is not a compose document.');

                const findings = [];
                const add = (line, level, rule, message) => findings.push({ line, level, rule, message });

                const services = document.services;
                if (!services || typeof services !== 'object') {
                    throw new Error('No `services:` block found — is this a compose file?');
                }

                if (document.version) {
                    add(lineOf(input, /^\s*version\s*:/), 'info', 'version-obsolete',
                        'The top-level <code>version</code> key is obsolete in the Compose Specification and is ignored by recent Docker Compose. It can be deleted.');
                }

                const names = Object.keys(services);
                const hostPorts = new Map();

                for (const [name, service] of Object.entries(services)) {
                    const at = lineOf(input, new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`));

                    if (!service || typeof service !== 'object') {
                        add(at, 'error', 'empty-service', `Service <code>${escapeHtml(name)}</code> has no configuration.`);
                        continue;
                    }

                    if (!service.image && !service.build) {
                        add(at, 'error', 'no-image', `Service <code>${escapeHtml(name)}</code> has neither <code>image</code> nor <code>build</code>.`);
                    }

                    if (typeof service.image === 'string' && (/:latest$/.test(service.image) || !service.image.includes(':'))) {
                        add(at, 'warn', 'pin-image', `<code>${escapeHtml(name)}</code> uses an unpinned image (<code>${escapeHtml(service.image)}</code>) — pin a tag or digest.`);
                    }

                    for (const port of service.ports || []) {
                        const text = typeof port === 'object' ? `${port.published}:${port.target}` : String(port);
                        const match = /^(?:([\d.]+):)?(\d+):(\d+)/.exec(text);
                        if (!match) continue;
                        const host = match[2];
                        if (hostPorts.has(host)) {
                            add(at, 'error', 'port-clash',
                                `Host port <strong>${host}</strong> is published by both <code>${escapeHtml(hostPorts.get(host))}</code> and <code>${escapeHtml(name)}</code> — the second container will fail to start.`);
                        } else hostPorts.set(host, name);
                    }

                    const dependsOn = Array.isArray(service.depends_on)
                        ? service.depends_on
                        : Object.keys(service.depends_on || {});
                    for (const dependency of dependsOn) {
                        if (!names.includes(dependency)) {
                            add(at, 'error', 'missing-dependency',
                                `<code>${escapeHtml(name)}</code> depends on <code>${escapeHtml(dependency)}</code>, which is not defined.`);
                        }
                    }

                    if (service.privileged === true) {
                        add(at, 'error', 'privileged',
                            `<code>${escapeHtml(name)}</code> runs <code>privileged: true</code> — that is effectively root on the host. Grant specific capabilities with <code>cap_add</code> instead.`);
                    }

                    if (service.network_mode === 'host') {
                        add(at, 'warn', 'host-network', `<code>${escapeHtml(name)}</code> uses host networking, bypassing container network isolation.`);
                    }

                    for (const volume of service.volumes || []) {
                        const text = typeof volume === 'object' ? `${volume.source}:${volume.target}` : String(volume);
                        if (/^\/:(?!\/)/.test(text) || text.startsWith('/:')) {
                            add(at, 'error', 'mount-root', `<code>${escapeHtml(name)}</code> mounts the host root filesystem (<code>${escapeHtml(text)}</code>).`);
                        } else if (text.startsWith('/var/run/docker.sock')) {
                            add(at, 'warn', 'docker-socket', `<code>${escapeHtml(name)}</code> mounts the Docker socket — that grants control of the host daemon.`);
                        }
                    }

                    const environment = Array.isArray(service.environment)
                        ? Object.fromEntries(service.environment.map((e) => {
                            const eq = String(e).indexOf('=');
                            return eq > 0 ? [String(e).slice(0, eq), String(e).slice(eq + 1)] : [String(e), ''];
                        }))
                        : (service.environment || {});
                    for (const [key, value] of Object.entries(environment)) {
                        if (/KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL/i.test(key) && value && !String(value).startsWith('${')) {
                            add(at, 'error', 'inline-secret',
                                `<code>${escapeHtml(name)}</code> has a literal value for <code>${escapeHtml(key)}</code>. Reference an environment variable (<code>\${${escapeHtml(key)}}</code>) or a secret instead.`);
                        }
                    }

                    if (!service.restart && !service.deploy?.restart_policy) {
                        add(at, 'info', 'restart-policy', `<code>${escapeHtml(name)}</code> has no restart policy.`);
                    }

                    if (!service.healthcheck && service.image) {
                        add(at, 'info', 'healthcheck', `<code>${escapeHtml(name)}</code> has no healthcheck, so <code>depends_on: condition: service_healthy</code> cannot be used against it.`);
                    }

                    if (!service.deploy?.resources?.limits && !service.mem_limit) {
                        add(at, 'info', 'resource-limits', `<code>${escapeHtml(name)}</code> has no memory limit — one runaway container can take the host down.`);
                    }
                }

                findings.sort((a, b) => (a.line ?? 9999) - (b.line ?? 9999));
                const report = findingsReport(findings, 'The compose file looks sound.');

                return {
                    output: asText(findings, 'The compose file looks sound.'),
                    note: `${names.length} services · ${report.errors} errors, ${report.warnings} warnings`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${report.banner}
                            <div class="stat-grid">
                                ${statTile('Services', String(names.length))}
                                ${statTile('Published ports', String(hostPorts.size))}
                                ${statTile('Errors', String(report.errors))}
                                ${statTile('Warnings', String(report.warnings))}
                            </div>
                            ${report.table}
                        </div>`,
                };
            },
        },
    },

    {
        id: 'k8s-validator',
        name: 'Kubernetes Manifest Checker',
        description: 'Check manifests for missing limits, root containers, latest tags and probe gaps.',
        category: 'devops',
        icon: '☸✓',
        keywords: ['kubernetes', 'k8s', 'manifest', 'yaml', 'validate', 'lint', 'deployment', 'pod',
            'security context', 'probe', 'limits', 'requests', 'devops', 'helm'],
        spec: {
            lede: 'Handles multi-document YAML. Checks the production readiness items that reviews usually catch late — resource limits, probes, security context and image pinning.',
            input: {
                label: 'Kubernetes YAML',
                accept: '.yaml,.yml',
                placeholder: 'apiVersion: apps/v1\nkind: Deployment\n…',
                sample: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: myrepo/api:latest
          ports:
            - containerPort: 8080
          env:
            - name: DB_PASSWORD
              value: hunter2
`,
            },
            output: { label: 'Report', filename: 'k8s-report.txt' },
            run: async ({ input }) => {
                const yaml = await libs.yaml();
                let documents;
                try {
                    documents = yaml.loadAll(input).filter(Boolean);
                } catch (err) {
                    throw new Error(err.message.split('\n').slice(0, 3).join(' ').trim());
                }
                if (!documents.length) throw new Error('No YAML documents found.');

                const findings = [];
                const add = (level, rule, message) => findings.push({ line: null, level, rule, message });
                const kinds = [];

                for (const document of documents) {
                    if (!document || typeof document !== 'object') continue;

                    const kind = document.kind;
                    const name = document.metadata?.name || '(unnamed)';
                    kinds.push(kind || '?');

                    if (!document.apiVersion) add('error', 'apiVersion', `<code>${escapeHtml(name)}</code> has no <code>apiVersion</code>.`);
                    if (!kind) { add('error', 'kind', 'A document has no <code>kind</code>.'); continue; }
                    if (!document.metadata?.name) add('error', 'metadata.name', `A ${escapeHtml(kind)} has no <code>metadata.name</code>.`);

                    if (document.apiVersion === 'extensions/v1beta1' || /v1beta1$/.test(document.apiVersion || '')) {
                        add('warn', 'deprecated-api', `<code>${escapeHtml(name)}</code> uses <code>${escapeHtml(document.apiVersion)}</code>, which is deprecated or removed in current Kubernetes.`);
                    }

                    // Checks for kinds that have no pod template must come before
                    // the early continue below.
                    if (kind === 'Secret' && (document.data || document.stringData)) {
                        add('warn', 'secret-in-git', `<code>${escapeHtml(name)}</code> is a Secret with inline data. Base64 is encoding, not encryption — do not commit this. Use sealed-secrets, SOPS or an external secret store.`);
                    }

                    const podSpec = kind === 'Pod' ? document.spec : document.spec?.template?.spec;
                    if (!podSpec) {
                        if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet' || kind === 'Job') {
                            add('error', 'pod-template', `<code>${escapeHtml(name)}</code> (${escapeHtml(kind)}) has no pod template.`);
                        }
                        continue;
                    }

                    if (kind === 'Deployment' && (document.spec.replicas ?? 1) < 2) {
                        add('info', 'replicas', `<code>${escapeHtml(name)}</code> runs a single replica — any node drain or rollout is downtime.`);
                    }

                    if (!podSpec.securityContext?.runAsNonRoot) {
                        add('warn', 'run-as-non-root', `<code>${escapeHtml(name)}</code> does not set <code>securityContext.runAsNonRoot: true</code>.`);
                    }

                    const containers = [...(podSpec.containers || []), ...(podSpec.initContainers || [])];
                    if (!containers.length) add('error', 'no-containers', `<code>${escapeHtml(name)}</code> defines no containers.`);

                    for (const container of containers) {
                        const label = `${name}/${container.name || '?'}`;

                        if (!container.image) {
                            add('error', 'no-image', `<code>${escapeHtml(label)}</code> has no image.`);
                        } else if (/:latest$/.test(container.image) || !/[:@]/.test(container.image)) {
                            add('error', 'pin-image', `<code>${escapeHtml(label)}</code> uses an unpinned image (<code>${escapeHtml(container.image)}</code>) — rollouts become non-deterministic and rollback does not work.`);
                        }

                        if (!container.resources?.limits) {
                            add('error', 'resource-limits', `<code>${escapeHtml(label)}</code> has no resource limits — it can starve everything else on the node.`);
                        }
                        if (!container.resources?.requests) {
                            add('warn', 'resource-requests', `<code>${escapeHtml(label)}</code> has no resource requests, so the scheduler cannot place it sensibly.`);
                        }
                        if (!container.livenessProbe) {
                            add('warn', 'liveness-probe', `<code>${escapeHtml(label)}</code> has no liveness probe — a hung process is never restarted.`);
                        }
                        if (!container.readinessProbe) {
                            add('warn', 'readiness-probe', `<code>${escapeHtml(label)}</code> has no readiness probe, so traffic is sent before it is ready.`);
                        }
                        if (container.securityContext?.privileged) {
                            add('error', 'privileged', `<code>${escapeHtml(label)}</code> is privileged.`);
                        }
                        if (container.securityContext?.allowPrivilegeEscalation !== false) {
                            add('info', 'privilege-escalation', `<code>${escapeHtml(label)}</code> does not set <code>allowPrivilegeEscalation: false</code>.`);
                        }
                        if (container.securityContext?.readOnlyRootFilesystem !== true) {
                            add('info', 'read-only-root', `<code>${escapeHtml(label)}</code> does not use a read-only root filesystem.`);
                        }
                        if (container.imagePullPolicy === 'Always' && /@sha256:/.test(container.image || '')) {
                            add('info', 'pull-policy', `<code>${escapeHtml(label)}</code> pins a digest but still pulls Always — unnecessary.`);
                        }

                        for (const variable of container.env || []) {
                            if (/KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL/i.test(variable.name || '') && variable.value) {
                                add('error', 'inline-secret', `<code>${escapeHtml(label)}</code> sets <code>${escapeHtml(variable.name)}</code> to a literal value. Use <code>valueFrom.secretKeyRef</code> — and remember a Secret is only base64, not encrypted at rest by default.`);
                            }
                        }
                    }

                }

                const report = findingsReport(findings, 'No problems found.');

                return {
                    output: asText(findings, 'No problems found.'),
                    note: `${documents.length} documents · ${report.errors} errors, ${report.warnings} warnings`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${report.banner}
                            <div class="stat-grid">
                                ${statTile('Documents', String(documents.length))}
                                ${statTile('Kinds', [...new Set(kinds)].join(', ') || '—')}
                                ${statTile('Errors', String(report.errors))}
                                ${statTile('Warnings', String(report.warnings))}
                            </div>
                            ${report.table}
                        </div>`,
                };
            },
            footnote: 'This checks structure and production-readiness conventions. It does <strong>not</strong> validate against the Kubernetes OpenAPI schema — for that use <code>kubectl apply --dry-run=server</code>, <code>kubeconform</code> or <code>kubeval</code>.',
        },
    },

    {
        id: 'gha-validator',
        name: 'GitHub Actions Checker',
        description: 'Lint a workflow for unpinned actions, script injection and missing permissions.',
        category: 'devops',
        icon: '⚡',
        keywords: ['github actions', 'workflow', 'ci', 'cd', 'yaml', 'validate', 'lint', 'pipeline',
            'security', 'pin', 'permissions', 'devops', 'gha'],
        spec: {
            lede: 'Includes the script-injection check — interpolating <code>${{ github.event... }}</code> straight into a run block lets a pull request title execute code in your runner.',
            input: {
                label: 'Workflow YAML',
                accept: '.yaml,.yml',
                placeholder: 'on: push\njobs:\n  build:\n    …',
                sample: `name: CI
on:
  pull_request_target:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: some/action@main
      - name: Greet
        run: echo "Building \${{ github.event.pull_request.title }}"
      - name: Deploy
        run: ./deploy.sh
        env:
          TOKEN: ghp_hardcodedtokenvalue123456
`,
            },
            output: { label: 'Report', filename: 'workflow-report.txt' },
            run: async ({ input }) => {
                const yaml = await libs.yaml();
                let workflow;
                try {
                    workflow = yaml.load(input);
                } catch (err) {
                    throw new Error(err.message.split('\n').slice(0, 3).join(' ').trim());
                }
                if (!workflow || typeof workflow !== 'object') throw new Error('That is not a workflow document.');

                const findings = [];
                const add = (line, level, rule, message) => findings.push({ line, level, rule, message });

                // `on:` parses as the boolean true in YAML 1.1 unless quoted.
                const triggers = workflow.on ?? workflow.true;
                if (!triggers) add(null, 'error', 'no-trigger', 'The workflow has no <code>on:</code> trigger.');
                if (workflow.true !== undefined && workflow.on === undefined) {
                    add(lineOf(input, /^\s*on\s*:/), 'info', 'yaml-on-boolean',
                        'YAML 1.1 parses an unquoted <code>on</code> key as the boolean <code>true</code>. GitHub handles it, but some tools do not — quoting it as <code>"on":</code> avoids the ambiguity.');
                }

                const triggerNames = typeof triggers === 'string' ? [triggers]
                    : Array.isArray(triggers) ? triggers : Object.keys(triggers || {});

                if (triggerNames.includes('pull_request_target')) {
                    add(lineOf(input, /pull_request_target/), 'error', 'pull-request-target',
                        '<code>pull_request_target</code> runs with a read/write token and repository secrets in the context of the <em>base</em> repo. Combined with checking out the PR head, this lets any fork run code with your secrets. Use <code>pull_request</code> unless you genuinely need it, and never check out untrusted code in it.');
                }

                if (!workflow.permissions) {
                    add(null, 'warn', 'permissions',
                        'No top-level <code>permissions:</code> — the default token may have write access to the whole repository. Set <code>permissions: contents: read</code> and widen per job.');
                }

                const jobs = workflow.jobs || {};
                if (!Object.keys(jobs).length) add(null, 'error', 'no-jobs', 'The workflow defines no jobs.');

                for (const [jobName, job] of Object.entries(jobs)) {
                    const jobLine = lineOf(input, new RegExp(`^\\s*${jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`));

                    if (!job || typeof job !== 'object') continue;
                    if (!job['runs-on'] && !job.uses) {
                        add(jobLine, 'error', 'runs-on', `Job <code>${escapeHtml(jobName)}</code> has no <code>runs-on</code>.`);
                    }
                    if (typeof job['runs-on'] === 'string' && /-latest$/.test(job['runs-on'])) {
                        add(jobLine, 'info', 'runner-latest',
                            `<code>${escapeHtml(jobName)}</code> uses <code>${escapeHtml(job['runs-on'])}</code>; the image changes over time and can break builds without a commit.`);
                    }
                    if (!job['timeout-minutes']) {
                        add(jobLine, 'info', 'timeout', `<code>${escapeHtml(jobName)}</code> has no <code>timeout-minutes</code> — a hung job can burn 6 hours of runner time.`);
                    }

                    for (const [index, step] of (job.steps || []).entries()) {
                        if (!step || typeof step !== 'object') continue;
                        const where = `${jobName} step ${index + 1}`;
                        const stepLine = step.uses ? lineOf(input, new RegExp(String(step.uses).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) : jobLine;

                        if (step.uses) {
                            const ref = String(step.uses).split('@')[1];
                            if (!ref) {
                                add(stepLine, 'error', 'unpinned-action', `<code>${escapeHtml(where)}</code> uses <code>${escapeHtml(step.uses)}</code> with no version at all.`);
                            } else if (/^(main|master|latest|develop)$/.test(ref)) {
                                add(stepLine, 'error', 'unpinned-action',
                                    `<code>${escapeHtml(where)}</code> pins <code>${escapeHtml(step.uses)}</code> to a moving branch. Whoever controls that action can change what runs in your pipeline at any time — pin a tag, or a commit SHA for third-party actions.`);
                            } else if (/^v\d/.test(ref) && !/^actions\//.test(step.uses)) {
                                add(stepLine, 'info', 'pin-sha',
                                    `<code>${escapeHtml(where)}</code> pins a tag on a third-party action. Tags are mutable — a full commit SHA is the only immutable pin.`);
                            }
                        }

                        if (step.run) {
                            const injection = /\$\{\{\s*(github\.event\.[\w.]*(title|body|message|name|ref|label|head_ref|email)|github\.head_ref)[^}]*\}\}/gi;
                            const hits = String(step.run).match(injection);
                            if (hits) {
                                add(stepLine, 'error', 'script-injection',
                                    `<code>${escapeHtml(where)}</code> interpolates <code>${escapeHtml(hits[0])}</code> directly into a shell command. That value is attacker-controlled — a branch or PR title containing a backtick or <code>$(…)</code> executes on your runner. Pass it through <code>env:</code> and reference <code>"$VAR"</code> instead.`);
                            }
                            if (/\bcurl\b[^|]*\|\s*(ba)?sh/.test(step.run)) {
                                add(stepLine, 'warn', 'curl-pipe-shell', `<code>${escapeHtml(where)}</code> pipes a download straight into a shell.`);
                            }
                        }

                        for (const [key, value] of Object.entries(step.env || {})) {
                            if (typeof value === 'string' && /^(gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,})/.test(value)) {
                                add(stepLine, 'error', 'hardcoded-secret',
                                    `<code>${escapeHtml(where)}</code> has what looks like a real credential in <code>${escapeHtml(key)}</code>. Move it to a repository secret — and rotate it, because it is now in your git history.`);
                            }
                        }
                    }
                }

                findings.sort((a, b) => (a.line ?? 9999) - (b.line ?? 9999));
                const report = findingsReport(findings, 'No problems found.');

                return {
                    output: asText(findings, 'No problems found.'),
                    note: `${Object.keys(jobs).length} jobs · ${report.errors} errors, ${report.warnings} warnings`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${report.banner}
                            <div class="stat-grid">
                                ${statTile('Jobs', String(Object.keys(jobs).length))}
                                ${statTile('Triggers', triggerNames.join(', ') || '—')}
                                ${statTile('Errors', String(report.errors))}
                                ${statTile('Warnings', String(report.warnings))}
                            </div>
                            ${report.table}
                        </div>`,
                };
            },
        },
    },

    {
        id: 'k8s-secret',
        name: 'Kubernetes Secret Decoder',
        description: 'Decode or build the base64 data block of a Kubernetes Secret.',
        category: 'devops',
        icon: '🔑☸',
        keywords: ['kubernetes', 'k8s', 'secret', 'base64', 'decode', 'encode', 'data', 'stringData',
            'manifest', 'devops'],
        spec: {
            lede: 'Paste a Secret manifest to read its values, or paste key=value pairs to build one.',
            input: {
                label: 'Secret YAML, or KEY=value lines',
                accept: '.yaml,.yml,.env',
                placeholder: 'apiVersion: v1\nkind: Secret\ndata:\n  password: aHVudGVyMg==',
                sample: `apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
data:
  DB_PASSWORD: aHVudGVyMg==
  API_KEY: c2stbGl2ZS1hYmNkZWY=
  EMPTY: ""`,
            },
            output: { label: 'Result', filename: 'secret.txt' },
            options: [
                { id: 'direction', type: 'select', label: 'Direction', default: 'decode',
                  choices: [
                      { value: 'decode', label: 'Decode — Secret YAML → plain values' },
                      { value: 'encode', label: 'Encode — KEY=value → Secret YAML' },
                  ] },
                { id: 'name', type: 'text', label: 'Secret name (when encoding)', default: 'app-secrets' },
                { id: 'stringData', type: 'checkbox', label: 'Use stringData (no base64)', default: false },
            ],
            run: async ({ input, options }) => {
                const yaml = await libs.yaml();

                if (options.direction === 'encode') {
                    const entries = [];
                    for (const line of input.split('\n')) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) continue;
                        const eq = trimmed.indexOf('=');
                        if (eq < 1) continue;
                        let value = trimmed.slice(eq + 1).trim();
                        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                            value = value.slice(1, -1);
                        }
                        entries.push([trimmed.slice(0, eq).trim(), value]);
                    }
                    if (!entries.length) throw new Error('No KEY=value lines found.');

                    const block = options.stringData
                        ? `stringData:\n${entries.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}`
                        : `data:\n${entries.map(([k, v]) => `  ${k}: ${bytesToBase64(utf8ToBytes(v))}`).join('\n')}`;

                    const manifest = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${options.name || 'app-secrets'}\ntype: Opaque\n${block}\n`;

                    return {
                        output: manifest,
                        filename: 'secret.yaml',
                        note: `${entries.length} keys`,
                        extraHtml: `
                            <div class="tool-section">
                                <div class="alert warn"><span>!</span><span><strong>Base64 is encoding, not encryption.</strong>
                                Anyone who can read this file, or run <code>kubectl get secret -o yaml</code>, can read the values.
                                Do not commit it — use sealed-secrets, SOPS, or an external secret store.</span></div>
                            </div>`,
                    };
                }

                let document;
                try {
                    document = yaml.load(input);
                } catch (err) {
                    throw new Error(err.message.split('\n').slice(0, 3).join(' ').trim());
                }

                const data = document?.data || {};
                const stringData = document?.stringData || {};
                if (!Object.keys(data).length && !Object.keys(stringData).length) {
                    throw new Error('No `data:` or `stringData:` block found in that manifest.');
                }

                const rows = [];
                for (const [key, value] of Object.entries(data)) {
                    let decoded;
                    try {
                        decoded = value ? bytesToUtf8(base64ToBytes(String(value))) : '';
                    } catch {
                        decoded = '(not valid base64)';
                    }
                    rows.push({ key, value: decoded, encoded: String(value), source: 'data' });
                }
                for (const [key, value] of Object.entries(stringData)) {
                    rows.push({ key, value: String(value), encoded: '(plain)', source: 'stringData' });
                }

                const width = Math.max(...rows.map((r) => r.key.length));
                return {
                    output: rows.map((r) => `${r.key.padEnd(width + 2)}${r.value}`).join('\n'),
                    note: `${rows.length} keys`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="table-wrap">
                                <table class="data">
                                    <thead><tr><th>Key</th><th>Decoded value</th><th style="width:90px">Source</th></tr></thead>
                                    <tbody>
                                        ${rows.map((r) => `
                                            <tr>
                                                <td><strong>${escapeHtml(r.key)}</strong></td>
                                                <td style="max-width:none">
                                                    <span class="copy-cell">
                                                        <span>${escapeHtml(r.value) || '<em class="nul">(empty)</em>'}</span>
                                                        <button class="copy-chip" data-copy="${escapeHtml(r.value)}" data-copy-label="${escapeHtml(r.key)} copied">Copy</button>
                                                    </span>
                                                </td>
                                                <td>${r.source}</td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
            footnote: 'Decoding happens in your browser and nothing is transmitted — but a real production secret pasted into any web page is a secret you should now rotate.',
        },
    },

    {
        id: 'gitignore-generator',
        name: '.gitignore Generator',
        description: 'Build a .gitignore from stacks, and check what a pattern would match.',
        category: 'devops',
        icon: '🚫',
        keywords: ['gitignore', 'git', 'ignore', 'generate', 'template', 'node', 'python', 'dotnet',
            'java', 'go', 'rust', 'devops', 'pattern'],
        spec: {
            lede: 'Pick the stacks you use — the common editor, OS and secret patterns are always included.',
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: '.gitignore', filename: '.gitignore' },
            options: [
                { id: 'stacks', type: 'text', label: 'Stacks (comma separated)', default: 'node,python',
                  hint: 'node, python, dotnet, java, go, rust, php, ruby, flutter, terraform, docker' },
                { id: 'includeSecrets', type: 'checkbox', label: 'Secret and credential patterns', default: true },
                { id: 'includeEditors', type: 'checkbox', label: 'Editor and OS files', default: true },
            ],
            run: ({ options }) => {
                const TEMPLATES = {
                    node: ['# Node', 'node_modules/', 'npm-debug.log*', 'yarn-error.log*', 'pnpm-debug.log*',
                        '.pnpm-store/', 'dist/', 'build/', '.next/', '.nuxt/', 'coverage/', '*.tsbuildinfo', '.turbo/'],
                    python: ['# Python', '__pycache__/', '*.py[cod]', '*$py.class', '.venv/', 'venv/', 'env/',
                        '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '*.egg-info/', 'dist/', 'build/', '.coverage', 'htmlcov/'],
                    dotnet: ['# .NET', 'bin/', 'obj/', '*.user', '*.suo', '.vs/', 'TestResults/', '*.nupkg', 'artifacts/'],
                    java: ['# Java', 'target/', '*.class', '*.jar', '*.war', '.gradle/', 'build/', '.mvn/wrapper/maven-wrapper.jar'],
                    go: ['# Go', 'bin/', 'vendor/', '*.exe', '*.test', '*.out', 'go.work.sum'],
                    rust: ['# Rust', 'target/', '**/*.rs.bk', 'Cargo.lock  # keep this for binaries, ignore for libraries'],
                    php: ['# PHP', 'vendor/', 'composer.phar', '.phpunit.result.cache'],
                    ruby: ['# Ruby', '.bundle/', 'vendor/bundle', 'log/', 'tmp/', '*.gem'],
                    flutter: ['# Flutter', '.dart_tool/', '.packages', 'build/', '.flutter-plugins', '.flutter-plugins-dependencies', '*.iml'],
                    terraform: ['# Terraform', '.terraform/', '*.tfstate', '*.tfstate.*', 'crash.log',
                        '*.tfvars  # often contains secrets', 'override.tf', '.terraformrc'],
                    docker: ['# Docker', '.docker/', 'docker-compose.override.yml'],
                };

                const requested = (options.stacks || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
                const unknown = requested.filter((s) => !TEMPLATES[s]);
                if (unknown.length) {
                    throw new Error(`Unknown stack${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Available: ${Object.keys(TEMPLATES).join(', ')}`);
                }

                const blocks = requested.map((stack) => TEMPLATES[stack].join('\n'));

                if (options.includeEditors) {
                    blocks.push(['# Editors and OS', '.vscode/', '!.vscode/extensions.json', '.idea/', '*.swp', '*.swo',
                        '.DS_Store', 'Thumbs.db', 'desktop.ini', '*~'].join('\n'));
                }
                if (options.includeSecrets) {
                    blocks.push(['# Secrets - never commit these', '.env', '.env.*', '!.env.example',
                        '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', '*.keystore',
                        'secrets.json', 'credentials.json', '.npmrc', '.pypirc',
                        'kubeconfig', '*.kubeconfig'].join('\n'));
                }
                if (!blocks.length) throw new Error('Choose at least one stack or option.');

                const content = `${blocks.join('\n\n')}\n`;

                return {
                    output: content,
                    note: `${requested.length} stacks · ${content.split('\n').filter((l) => l && !l.startsWith('#')).length} patterns`,
                    extraHtml: `
                        <div class="info-box" style="margin-top:1.5rem;">
                            <strong>.gitignore only affects untracked files.</strong> If a file is already committed,
                            adding it here changes nothing — you need
                            <code>git rm --cached &lt;file&gt;</code> as well. And if a secret was ever committed,
                            removing it from the tip does not remove it from history: rotate the credential.
                        </div>`,
                };
            },
        },
    },
];
