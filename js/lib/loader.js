// Lazy loader for third-party libraries.
// Nothing is fetched until a tool that needs it is actually opened, and each
// library is only ever fetched once (the promise is cached).

const cache = new Map();

/**
 * Load a classic UMD script that attaches itself to `window`.
 * @param {string} url
 * @param {string} globalName property on window to resolve with
 */
export function loadScript(url, globalName) {
    if (cache.has(url)) return cache.get(url);

    const promise = new Promise((resolve, reject) => {
        if (globalName && window[globalName]) {
            resolve(window[globalName]);
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => {
            const value = globalName ? window[globalName] : true;
            if (globalName && !value) {
                reject(new Error(`Loaded ${url} but window.${globalName} is missing`));
                return;
            }
            resolve(value);
        };
        script.onerror = () => reject(new Error(`Could not load ${url} — check your connection`));
        document.head.appendChild(script);
    });

    cache.set(url, promise);
    return promise;
}

/** Load an ES module from a CDN. */
export function loadModule(url) {
    if (cache.has(url)) return cache.get(url);
    const promise = import(/* webpackIgnore: true */ url)
        .catch((err) => {
            cache.delete(url);
            throw new Error(`Could not load module ${url}: ${err.message}`);
        });
    cache.set(url, promise);
    return promise;
}

// ---- Library entry points, pinned to exact versions -----------------------

export const libs = {
    /** hyparquet — pure-JS Parquet reader (schema, metadata, row groups, data) */
    hyparquet: () => loadModule('https://cdn.jsdelivr.net/npm/hyparquet@1.10.0/src/hyparquet.js'),

    /**
     * hyparquet-compressors — gzip / brotli / zstd / lz4 page codecs.
     * Served through jsDelivr's `+esm` endpoint because the published source
     * uses bare import specifiers (fzstd, etc.) that a browser cannot resolve.
     */
    hyparquetCompressors: () => loadModule('https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.1/+esm'),

    /** js-yaml — YAML parse/dump */
    yaml: () => loadScript('https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js', 'jsyaml'),

    /** marked — Markdown to HTML */
    marked: () => loadScript('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'marked'),

    /** turndown — HTML to Markdown */
    turndown: () => loadScript('https://cdn.jsdelivr.net/npm/turndown@7.1.3/dist/turndown.js', 'TurndownService'),

    /** js-beautify — HTML / CSS / JS formatting */
    beautify: () => loadScript('https://cdn.jsdelivr.net/npm/js-beautify@1.15.1/js/lib/beautify.min.js', 'js_beautify')
        .then(() => Promise.all([
            loadScript('https://cdn.jsdelivr.net/npm/js-beautify@1.15.1/js/lib/beautify-css.min.js', 'css_beautify'),
            loadScript('https://cdn.jsdelivr.net/npm/js-beautify@1.15.1/js/lib/beautify-html.min.js', 'html_beautify'),
        ]))
        .then(() => ({
            js: window.js_beautify,
            css: window.css_beautify,
            html: window.html_beautify,
        })),

    /** terser — JavaScript minification */
    terser: () => loadScript('https://cdn.jsdelivr.net/npm/terser@5.31.0/dist/bundle.min.js', 'Terser'),

    /** sql-formatter */
    sqlFormatter: () => loadScript('https://cdn.jsdelivr.net/npm/sql-formatter@15.3.1/dist/sql-formatter.min.js', 'sqlFormatter'),

    /** bcryptjs — bcrypt hash + verify */
    bcrypt: () => loadScript('https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js', 'dcodeIO')
        .then((d) => d.bcrypt),

    /** qrcode-generator — QR encoding */
    qrcode: () => loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'qrcode'),

    /** jsQR — QR decoding from image pixels */
    jsqr: () => loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', 'jsQR'),

    /** SheetJS — xlsx writing */
    xlsx: () => loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX'),

    /**
     * gpt-tokenizer — exact BPE tokenisation for OpenAI models.
     * cl100k_base covers GPT-3.5 and GPT-4; o200k_base covers GPT-4o and newer.
     * The encoding files are loaded directly because jsDelivr's `+esm`
     * transform 404s on those subpaths.
     */
    tokenizerCl100k: () => loadModule('https://cdn.jsdelivr.net/npm/gpt-tokenizer@2.9.0/+esm'),
    tokenizerO200k: () => loadModule('https://cdn.jsdelivr.net/npm/gpt-tokenizer@2.9.0/esm/encoding/o200k_base.js'),

    /** mermaid — diagram rendering */
    mermaid: () => loadModule('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs')
        .then((m) => m.default ?? m),
};
