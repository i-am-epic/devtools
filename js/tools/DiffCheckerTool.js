// Text diff using a proper longest-common-subsequence alignment, so inserting
// a single line does not make everything after it look changed.

import { BaseTool } from '../core/BaseTool.js';
import { toast, copyText, downloadText } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Myers-style diff via an LCS table. Returns a list of
 * { type: 'equal'|'delete'|'insert', left, right, leftNo, rightNo }.
 */
function diffLines(a, b) {
    const n = a.length;
    const m = b.length;

    // Trim the common prefix and suffix first — this is what keeps the O(n·m)
    // table small for the usual "two nearly identical files" case.
    let start = 0;
    while (start < n && start < m && a[start] === b[start]) start++;

    let endA = n;
    let endB = m;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);

    if (midA.length * midB.length > 4_000_000) {
        throw new Error(
            'These inputs are too large to diff in the browser '
            + `(${midA.length.toLocaleString()} × ${midB.length.toLocaleString()} differing lines). `
            + 'Try comparing smaller sections.',
        );
    }

    // LCS lengths
    const table = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
    for (let i = midA.length - 1; i >= 0; i--) {
        for (let j = midB.length - 1; j >= 0; j--) {
            table[i][j] = midA[i] === midB[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    const result = [];
    let leftNo = 1;
    let rightNo = 1;

    for (let i = 0; i < start; i++) {
        result.push({ type: 'equal', left: a[i], right: b[i], leftNo: leftNo++, rightNo: rightNo++ });
    }

    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
        if (midA[i] === midB[j]) {
            result.push({ type: 'equal', left: midA[i], right: midB[j], leftNo: leftNo++, rightNo: rightNo++ });
            i++;
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            result.push({ type: 'delete', left: midA[i], right: null, leftNo: leftNo++, rightNo: null });
            i++;
        } else {
            result.push({ type: 'insert', left: null, right: midB[j], leftNo: null, rightNo: rightNo++ });
            j++;
        }
    }
    while (i < midA.length) {
        result.push({ type: 'delete', left: midA[i++], right: null, leftNo: leftNo++, rightNo: null });
    }
    while (j < midB.length) {
        result.push({ type: 'insert', left: null, right: midB[j++], leftNo: null, rightNo: rightNo++ });
    }

    for (let k = endA; k < n; k++) {
        result.push({ type: 'equal', left: a[k], right: b[k - endA + endB], leftNo: leftNo++, rightNo: rightNo++ });
    }

    return result;
}

/**
 * Find lines that were deleted in one place and added in another — moved
 * rather than changed. Most web diffs colour these as a delete plus an
 * unrelated insert, which buries the real edits in a reordered file.
 * (git calls this --color-moved.)
 */
function markMoves(rows) {
    const deletions = new Map();
    const insertions = new Map();

    rows.forEach((row, index) => {
        if (row.type === 'delete' && row.left.trim()) {
            if (!deletions.has(row.left)) deletions.set(row.left, []);
            deletions.get(row.left).push(index);
        } else if (row.type === 'insert' && row.right.trim()) {
            if (!insertions.has(row.right)) insertions.set(row.right, []);
            insertions.get(row.right).push(index);
        }
    });

    let moveId = 0;
    for (const [text, deletedAt] of deletions) {
        const addedAt = insertions.get(text);
        if (!addedAt) continue;

        // Pair them up in order; leftovers stay a genuine add or delete.
        const pairs = Math.min(deletedAt.length, addedAt.length);
        for (let i = 0; i < pairs; i++) {
            const id = ++moveId;
            rows[deletedAt[i]].moved = id;
            rows[addedAt[i]].moved = id;
        }
    }

    // A run of consecutive moved lines is one moved block; number those so the
    // eye can match them up.
    let block = 0;
    let previous = null;
    for (const row of rows) {
        if (row.moved) {
            if (previous === null || previous + 1 !== row.moved) block++;
            row.moveBlock = block;
            previous = row.moved;
        } else previous = null;
    }

    return moveId;
}

/** Word-level highlight for a delete/insert pair that is probably a rewrite. */
function inlineDiff(left, right) {
    const split = (text) => text.split(/(\s+)/).filter((token) => token !== '');
    const a = split(left);
    const b = split(right);

    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    let leftHtml = '';
    let rightHtml = '';
    let i = 0;
    let j = 0;
    const mark = (text, kind) =>
        `<span style="background:${kind === 'del' ? 'rgba(224,49,49,0.28)' : 'rgba(46,158,91,0.28)'};border-radius:3px">${escapeHtml(text)}</span>`;

    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { leftHtml += escapeHtml(a[i]); rightHtml += escapeHtml(b[j]); i++; j++; }
        else if (table[i + 1][j] >= table[i][j + 1]) { leftHtml += mark(a[i++], 'del'); }
        else { rightHtml += mark(b[j++], 'ins'); }
    }
    while (i < a.length) leftHtml += mark(a[i++], 'del');
    while (j < b.length) rightHtml += mark(b[j++], 'ins');

    return { leftHtml, rightHtml };
}

export class DiffCheckerTool extends BaseTool {
    constructor(config) {
        super(config);
        this.rows = [];
    }

    render() {
        return `
            <div class="tool-interface" data-cat="text">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">
                    Line-by-line comparison with proper insert and delete detection, plus word-level highlighting
                    inside changed lines.
                </p>

                <div class="io-grid">
                    <div class="io-pane">
                        <div class="io-pane-head"><h3>Original</h3></div>
                        <textarea id="diffLeft" spellcheck="false" placeholder="Paste the original text…"></textarea>
                    </div>
                    <div class="io-pane">
                        <div class="io-pane-head"><h3>Changed</h3></div>
                        <textarea id="diffRight" spellcheck="false" placeholder="Paste the changed text…"></textarea>
                    </div>
                </div>

                <div class="tool-section" style="margin-top:1rem;">
                    <div class="opt-row">
                        <label class="check"><input type="checkbox" id="diffIgnoreCase"> Ignore case</label>
                        <label class="check"><input type="checkbox" id="diffIgnoreWs"> Ignore whitespace</label>
                        <label class="check"><input type="checkbox" id="diffTrim" checked> Ignore trailing whitespace</label>
                        <label class="check"><input type="checkbox" id="diffOnlyChanges"> Show only changes</label>
                        <label class="check"><input type="checkbox" id="diffMoves" checked> Detect moved blocks</label>
                    </div>
                    <div class="btn-row">
                        <button class="action-btn" id="diffRun">Compare</button>
                        <button class="action-btn secondary" id="diffSwap">⇄ Swap sides</button>
                        <button class="action-btn secondary" id="diffCopyPatch">Copy unified diff</button>
                        <button class="action-btn secondary" id="diffSavePatch">Save .patch</button>
                        <button class="action-btn secondary" id="diffClear">Clear</button>
                    </div>
                </div>

                <div id="diffSummary"></div>
                <div class="tool-section" id="diffResult"></div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            const run = () => this.compare();
            document.getElementById('diffRun')?.addEventListener('click', run);
            ['diffIgnoreCase', 'diffIgnoreWs', 'diffTrim', 'diffOnlyChanges', 'diffMoves'].forEach((id) => {
                document.getElementById(id)?.addEventListener('change', run);
            });

            let debounce;
            ['diffLeft', 'diffRight'].forEach((id) => {
                document.getElementById(id)?.addEventListener('input', () => {
                    clearTimeout(debounce);
                    debounce = setTimeout(run, 350);
                });
            });

            document.getElementById('diffSwap')?.addEventListener('click', () => {
                const left = document.getElementById('diffLeft');
                const right = document.getElementById('diffRight');
                [left.value, right.value] = [right.value, left.value];
                run();
            });

            document.getElementById('diffClear')?.addEventListener('click', () => {
                document.getElementById('diffLeft').value = '';
                document.getElementById('diffRight').value = '';
                document.getElementById('diffResult').innerHTML = '';
                document.getElementById('diffSummary').innerHTML = '';
                this.rows = [];
            });

            document.getElementById('diffCopyPatch')?.addEventListener('click', () => {
                const patch = this.unifiedDiff();
                if (patch) copyText(patch, 'Unified diff copied');
                else toast('Run a comparison first', 'err');
            });

            document.getElementById('diffSavePatch')?.addEventListener('click', () => {
                const patch = this.unifiedDiff();
                if (patch) { downloadText(patch, 'changes.patch'); toast('Saved changes.patch'); }
                else toast('Run a comparison first', 'err');
            });
        }, 0);
    }

    readOptions() {
        return {
            ignoreCase: document.getElementById('diffIgnoreCase')?.checked,
            ignoreWs: document.getElementById('diffIgnoreWs')?.checked,
            trim: document.getElementById('diffTrim')?.checked,
            onlyChanges: document.getElementById('diffOnlyChanges')?.checked,
            moves: document.getElementById('diffMoves')?.checked,
        };
    }

    normalise(line, options) {
        let out = line;
        if (options.trim) out = out.replace(/\s+$/, '');
        if (options.ignoreWs) out = out.replace(/\s+/g, '');
        if (options.ignoreCase) out = out.toLowerCase();
        return out;
    }

    compare() {
        const leftText = document.getElementById('diffLeft').value;
        const rightText = document.getElementById('diffRight').value;
        const summary = document.getElementById('diffSummary');
        const result = document.getElementById('diffResult');
        const options = this.readOptions();

        if (!leftText && !rightText) {
            summary.innerHTML = '';
            result.innerHTML = '';
            return;
        }

        const leftLines = leftText.split('\n');
        const rightLines = rightText.split('\n');

        let rows;
        try {
            rows = diffLines(
                leftLines.map((line) => this.normalise(line, options)),
                rightLines.map((line) => this.normalise(line, options)),
            );
        } catch (err) {
            summary.innerHTML = `<div class="alert err"><span>✕</span><span>${escapeHtml(err.message)}</span></div>`;
            result.innerHTML = '';
            return;
        }

        // Map normalised lines back to the originals for display.
        let li = 0;
        let ri = 0;
        rows = rows.map((row) => ({
            ...row,
            left: row.left === null ? null : leftLines[li++],
            right: row.right === null ? null : rightLines[ri++],
        }));

        this.rows = rows;

        const movedCount = options.moves ? markMoves(rows) : 0;

        const added = rows.filter((r) => r.type === 'insert' && !r.moved).length;
        const removed = rows.filter((r) => r.type === 'delete' && !r.moved).length;
        const same = rows.filter((r) => r.type === 'equal').length;
        const identical = added === 0 && removed === 0 && movedCount === 0;

        summary.innerHTML = `
            <div class="alert ${identical ? 'ok' : 'info'}">
                <span>${identical ? '✓' : 'ℹ'}</span>
                <span>${identical
                    ? 'The two texts are identical under the current options.'
                    : `<strong>+${added}</strong> added, <strong>−${removed}</strong> removed`
                      + `${movedCount ? `, <strong>⇅${movedCount}</strong> moved` : ''}, ${same} unchanged`}</span>
            </div>
            <div class="diff-legend">
                <span><i class="sw sw-add"></i> added</span>
                <span><i class="sw sw-del"></i> removed</span>
                <span><i class="sw sw-mod"></i> changed <small>(word-level highlight inside)</small></span>
                ${movedCount ? '<span><i class="sw sw-mov"></i> moved <small>(same line, different place)</small></span>' : ''}
            </div>`;

        // Pair adjacent delete/insert runs so we can show word-level changes.
        const display = [];
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].type === 'delete' && rows[i + 1]?.type === 'insert') {
                display.push({ type: 'change', left: rows[i].left, right: rows[i + 1].right,
                    leftNo: rows[i].leftNo, rightNo: rows[i + 1].rightNo });
                i++;
            } else {
                display.push(rows[i]);
            }
        }

        const visible = options.onlyChanges
            ? display.filter((row, index) => row.type !== 'equal'
                || display[index - 1]?.type !== 'equal'
                || display[index + 1]?.type !== 'equal')
            : display;

        const colours = {
            equal: 'transparent',
            delete: 'rgba(224,49,49,0.12)',
            insert: 'rgba(46,158,91,0.12)',
            change: 'rgba(244,213,59,0.14)',
            moved: 'rgba(139,92,246,0.14)',
        };

        result.innerHTML = `
            <h3>Comparison</h3>
            <div class="table-wrap" style="max-height:520px;">
                <table class="data" style="table-layout:fixed;width:100%">
                    <thead>
                        <tr>
                            <th style="width:56px">#</th><th style="width:calc(50% - 60px)">Original</th>
                            <th style="width:56px">#</th><th>Changed</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${visible.map((row) => {
                            let leftHtml = row.left === null ? '' : escapeHtml(row.left);
                            let rightHtml = row.right === null ? '' : escapeHtml(row.right);

                            if (row.type === 'change') {
                                const inline = inlineDiff(row.left, row.right);
                                leftHtml = inline.leftHtml;
                                rightHtml = inline.rightHtml;
                            }

                            const background = row.moved ? colours.moved : colours[row.type];
                            const tag = row.moved
                                ? `<span class="move-tag" title="Moved block ${row.moveBlock} — this exact line exists on both sides, in a different position">⇅${row.moveBlock}</span>`
                                : '';

                            return `
                                <tr style="background:${background}">
                                    <td class="row-index">${row.leftNo ?? ''}</td>
                                    <td style="white-space:pre-wrap;word-break:break-word;max-width:none">${row.moved && row.type === 'delete' ? tag : ''}${leftHtml}</td>
                                    <td class="row-index">${row.rightNo ?? ''}</td>
                                    <td style="white-space:pre-wrap;word-break:break-word;max-width:none">${row.moved && row.type === 'insert' ? tag : ''}${rightHtml}</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    /** Produce a standard unified diff with three lines of context. */
    unifiedDiff() {
        if (!this.rows.length) return '';

        const context = 3;
        const keep = new Set();
        this.rows.forEach((row, index) => {
            if (row.type === 'equal') return;
            for (let i = Math.max(0, index - context); i <= Math.min(this.rows.length - 1, index + context); i++) {
                keep.add(i);
            }
        });
        if (!keep.size) return '';

        const lines = ['--- original', '+++ changed'];
        let index = 0;

        while (index < this.rows.length) {
            if (!keep.has(index)) { index++; continue; }

            const hunkStart = index;
            while (index < this.rows.length && keep.has(index)) index++;
            const hunk = this.rows.slice(hunkStart, index);

            const leftStart = hunk.find((row) => row.leftNo !== null)?.leftNo ?? 0;
            const rightStart = hunk.find((row) => row.rightNo !== null)?.rightNo ?? 0;
            const leftCount = hunk.filter((row) => row.type !== 'insert').length;
            const rightCount = hunk.filter((row) => row.type !== 'delete').length;

            lines.push(`@@ -${leftStart},${leftCount} +${rightStart},${rightCount} @@`);
            for (const row of hunk) {
                if (row.type === 'equal') lines.push(` ${row.left}`);
                else if (row.type === 'delete') lines.push(`-${row.left}`);
                else lines.push(`+${row.right}`);
            }
        }

        return `${lines.join('\n')}\n`;
    }
}

export { diffLines, markMoves };
