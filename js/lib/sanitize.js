// HTML sanitiser.
//
// Rendered Markdown is inserted into the page so that Mermaid blocks, anchors
// and a table of contents work. Markdown allows raw HTML, so the result must
// be cleaned first: an allowlist of elements and attributes, with everything
// else dropped.
//
// This is deliberately strict. It is not a general-purpose replacement for
// DOMPurify, but for "render Markdown the user pasted" it removes the script
// execution paths that matter: <script>, event handlers, javascript: URLs,
// <iframe>/<object>/<embed>, and style blocks.

const ALLOWED_ELEMENTS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
    'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li',
    'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span',
    'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'time', 'tr', 'u', 'ul', 'var', 'input',
]);

const ALLOWED_ATTRIBUTES = {
    '*': new Set(['id', 'title', 'class', 'dir', 'lang']),
    a: new Set(['href', 'target', 'rel', 'name']),
    img: new Set(['src', 'alt', 'width', 'height', 'loading']),
    input: new Set(['type', 'checked', 'disabled']),
    ol: new Set(['start', 'reversed', 'type']),
    td: new Set(['colspan', 'rowspan', 'align']),
    th: new Set(['colspan', 'rowspan', 'align', 'scope']),
    col: new Set(['span']),
    colgroup: new Set(['span']),
    time: new Set(['datetime']),
    details: new Set(['open']),
};

const SAFE_URL = /^(https?:|mailto:|tel:|ftp:|#|\/|\.\/|\.\.\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i;

/**
 * @param {string} html
 * @param {{allowClasses?: boolean}} options
 * @returns {string} cleaned HTML
 */
export function sanitizeHtml(html, options = {}) {
    const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html');
    const root = doc.getElementById('__root');
    if (!root) return '';

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const doomed = [];

    while (walker.nextNode()) {
        const element = walker.currentNode;
        const tag = element.tagName.toLowerCase();

        if (!ALLOWED_ELEMENTS.has(tag)) {
            doomed.push(element);
            continue;
        }

        // Task-list checkboxes are the only input Markdown produces.
        if (tag === 'input' && element.getAttribute('type') !== 'checkbox') {
            doomed.push(element);
            continue;
        }

        for (const attribute of [...element.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value;

            const allowed = ALLOWED_ATTRIBUTES['*'].has(name)
                || ALLOWED_ATTRIBUTES[tag]?.has(name);

            if (!allowed || name.startsWith('on')) {
                element.removeAttribute(attribute.name);
                continue;
            }

            if ((name === 'href' || name === 'src') && !SAFE_URL.test(value.trim())) {
                element.removeAttribute(attribute.name);
                continue;
            }

            if (name === 'class' && options.allowClasses === false) {
                element.removeAttribute(attribute.name);
            }
        }

        // Anything opening a new tab must not get access to window.opener.
        if (tag === 'a' && element.getAttribute('target') === '_blank') {
            element.setAttribute('rel', 'noopener noreferrer');
        }
    }

    // Unwrap disallowed elements last so their text content survives, except
    // for the ones whose content is itself executable.
    for (const element of doomed) {
        const tag = element.tagName.toLowerCase();
        if (['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template'].includes(tag)) {
            element.remove();
        } else {
            element.replaceWith(...element.childNodes);
        }
    }

    return root.innerHTML;
}

/** Stable, unique slug for a heading, for anchors and a table of contents. */
export function slugify(text, taken = new Set()) {
    let base = String(text).trim().toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'section';

    let slug = base;
    let counter = 1;
    while (taken.has(slug)) slug = `${base}-${counter++}`;
    taken.add(slug);
    return slug;
}
