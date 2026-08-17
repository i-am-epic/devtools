// Client for the local Service Bus relay.
//
// Azure Service Bus' REST API returns no CORS headers, so a browser page cannot
// call it directly. Requests go through /api/servicebus instead, which is
// implemented by server.py for local use and api/servicebus.js on Vercel.

const ENDPOINT = '/api/servicebus';

let proxyAvailable = null;

/** Is the relay running? Cached after the first check. */
export async function checkProxy(force = false) {
    if (proxyAvailable !== null && !force) return proxyAvailable;
    try {
        const response = await fetch('/api/health', { method: 'GET' });
        proxyAvailable = response.ok && (await response.json()).servicebus === true;
    } catch {
        proxyAvailable = false;
    }
    return proxyAvailable;
}

export class ServiceBusError extends Error {
    constructor(message, detail) {
        super(message);
        this.name = 'ServiceBusError';
        this.detail = detail;
    }
}

export async function call(payload) {
    let response;
    try {
        response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        proxyAvailable = false;
        throw new ServiceBusError(
            'Could not reach the Service Bus relay. Start it with "python server.py" and open the site '
            + 'through that server rather than as a file:// page.',
            err.message,
        );
    }

    let body;
    try {
        body = await response.json();
    } catch {
        throw new ServiceBusError(`The relay returned a non-JSON response (HTTP ${response.status})`);
    }

    if (!response.ok || body.ok === false) {
        throw new ServiceBusError(body.error || `Request failed with HTTP ${response.status}`, body.detail);
    }
    return body;
}

/**
 * Validate and describe a connection string without sending it anywhere.
 * Mirrors the parsing the relay does, so mistakes are caught before the
 * credentials leave the page.
 */
export function inspectConnectionString(text) {
    if (!text || !text.trim()) return { valid: false, error: 'Connection string is empty' };

    const parts = {};
    for (const segment of text.split(';')) {
        const trimmed = segment.trim();
        if (!trimmed || !trimmed.includes('=')) continue;
        const index = trimmed.indexOf('=');
        parts[trimmed.slice(0, index).trim().toLowerCase()] = trimmed.slice(index + 1).trim();
    }

    const endpoint = parts.endpoint;
    const keyName = parts.sharedaccesskeyname;
    const key = parts.sharedaccesskey;

    const missing = [];
    if (!endpoint) missing.push('Endpoint');
    if (!keyName) missing.push('SharedAccessKeyName');
    if (!key) missing.push('SharedAccessKey');
    if (missing.length) {
        return { valid: false, error: `Missing ${missing.join(', ')}` };
    }

    const host = endpoint.replace(/^sb:\/\/|^https:\/\//, '').replace(/\/+$/, '');
    if (!/^[\w-]+\.servicebus\.(windows\.net|chinacloudapi\.cn|usgovcloudapi\.net|cloudapi\.de)$/i.test(host)) {
        return { valid: false, error: `"${host}" does not look like a Service Bus namespace host` };
    }

    return {
        valid: true,
        host,
        namespace: host.split('.')[0],
        keyName,
        entityPath: parts.entitypath || null,
        keyLength: key.length,
    };
}

/** Shared markup: relay status + a nudge to start it when it is missing. */
export function relayBanner(available) {
    return available
        ? `<div class="alert ok">
               <span>✓</span>
               <span>Relay is running — messages will be sent to and received from Azure for real.</span>
           </div>`
        : `<div class="alert warn">
               <span>!</span>
               <span>
                   <strong>Relay not detected.</strong>
                   Azure Service Bus does not send CORS headers, so the browser cannot call it directly.
                   Start the relay and reload this page:
                   <code style="display:block;margin-top:0.5rem">python server.py</code>
               </span>
           </div>`;
}
