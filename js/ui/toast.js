// Tiny toast helper shared by every tool.

let stack = null;

function ensureStack() {
    if (!stack || !document.body.contains(stack)) {
        stack = document.createElement('div');
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    return stack;
}

export function toast(message, kind = 'ok', ms = 2000) {
    const node = document.createElement('div');
    node.className = `toast${kind === 'err' ? ' err' : ''}`;
    node.textContent = message;
    ensureStack().appendChild(node);

    setTimeout(() => {
        node.classList.add('out');
        setTimeout(() => node.remove(), 260);
    }, ms);
}

/** Copy text, with a fallback for non-secure contexts. */
export async function copyText(text, label = 'Copied') {
    if (!text) {
        toast('Nothing to copy', 'err');
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        try {
            document.execCommand('copy');
        } catch {
            helper.remove();
            toast('Could not copy — copy manually', 'err');
            return false;
        }
        helper.remove();
    }
    toast(label);
    return true;
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, type = 'text/plain') {
    downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}
