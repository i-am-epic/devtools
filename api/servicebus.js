// Vercel serverless function: relay for the Azure Service Bus REST API.
//
// The browser cannot call Service Bus directly because the REST API sends no
// CORS headers. This signs a SAS token and forwards the request.
//
// Zero dependencies — node:crypto and global fetch only.
// Behaviour is kept in sync with server.py, which does the same job locally.

import crypto from 'node:crypto';

const MAX_BODY = 4 * 1024 * 1024;

// The relay must only ever talk to Azure Service Bus. Without this it is an
// open proxy that will fetch any host a caller names, including link-local
// metadata endpoints.
const ALLOWED_HOST = /^[a-z0-9][a-z0-9-]*\.servicebus\.(windows\.net|chinacloudapi\.cn|usgovcloudapi\.net|cloudapi\.de)$/i;

class SbError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function parseConnectionString(text) {
    if (!text || !text.trim()) throw new SbError('Connection string is required');

    const parts = {};
    for (const segment of text.split(';')) {
        const trimmed = segment.trim();
        if (!trimmed || !trimmed.includes('=')) continue;
        const index = trimmed.indexOf('=');   // the key itself is base64 and contains '='
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
        throw new SbError(
            `Connection string is missing ${missing.join(', ')}. Expected: `
            + 'Endpoint=sb://<namespace>.servicebus.windows.net/;SharedAccessKeyName=<name>;SharedAccessKey=<key>',
        );
    }

    const host = endpoint.replace(/^sb:\/\/|^https:\/\//, '').replace(/\/+$/, '');
    if (!host) throw new SbError('Could not read the namespace host from the Endpoint value');
    if (!ALLOWED_HOST.test(host)) {
        throw new SbError('The Endpoint must be an Azure Service Bus namespace, e.g. sb://<namespace>.servicebus.windows.net/');
    }

    return { host, keyName, key, entityPath: parts.entitypath || null };
}

function makeSasToken(uri, keyName, key, ttlSeconds = 3600) {
    const encodedUri = encodeURIComponent(uri);
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = crypto
        .createHmac('sha256', key)
        .update(`${encodedUri}\n${expiry}`)
        .digest('base64');

    return `SharedAccessSignature sr=${encodedUri}`
        + `&sig=${encodeURIComponent(signature)}`
        + `&se=${expiry}`
        + `&skn=${encodeURIComponent(keyName)}`;
}

function entityUrl(host, entity) {
    const clean = (entity || '').trim().replace(/^\/+|\/+$/g, '');
    if (!clean) throw new SbError('Queue or topic/subscription name is required');
    return `https://${host}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

async function azureRequest(method, url, token, body, extraHeaders, timeoutMs = 70000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
        response = await fetch(url, {
            method,
            headers: { Authorization: token, ...(extraHeaders || {}) },
            body,
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') throw new SbError('The request to Azure Service Bus timed out', 504);
        throw new SbError(`Could not reach ${new URL(url).hostname}: ${err.message}`, 502);
    }
    clearTimeout(timer);

    const buffer = Buffer.from(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });

    return { status: response.status, headers, body: buffer };
}

function describeHttpError(result, context) {
    const hints = {
        401: 'Authentication failed - check SharedAccessKeyName and SharedAccessKey.',
        403: 'Authorisation failed - the SAS policy may lack the required Send/Listen claim.',
        404: 'Not found - check the queue, topic or subscription name.',
        410: 'The entity is gone or the lock has already expired.',
    };
    const detail = result.body.toString('utf8').slice(0, 2000).trim();
    return [`${context} failed with HTTP ${result.status}.`, hints[result.status] || '', detail]
        .filter(Boolean).join(' ');
}

function decodeMessage(result) {
    const raw = result.body;
    const headers = result.headers;

    let text;
    const decoded = raw.toString('utf8');
    // Round-trip check tells us whether the payload really was UTF-8.
    text = Buffer.from(decoded, 'utf8').equals(raw) ? decoded : raw.toString('base64');

    let broker = {};
    if (headers.brokerproperties) {
        try {
            broker = JSON.parse(headers.brokerproperties);
        } catch {
            broker = { _raw: headers.brokerproperties };
        }
    }

    const reserved = new Set([
        'brokerproperties', 'content-type', 'content-length', 'date', 'server',
        'location', 'transfer-encoding', 'strict-transport-security',
        'connection', 'cache-control', 'expires', 'pragma',
    ]);

    const properties = {};
    for (const [name, value] of Object.entries(headers)) {
        if (reserved.has(name)) continue;
        try {
            properties[name] = JSON.parse(value);
        } catch {
            properties[name] = value;
        }
    }

    return {
        body: text,
        size: raw.length,
        contentType: headers['content-type'] || '',
        brokerProperties: broker,
        properties,
        lockLocation: headers.location || '',
        receivedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
}

async function send(payload) {
    const conn = parseConnectionString(payload.connectionString);
    const entity = payload.entity || conn.entityPath;
    const url = entityUrl(conn.host, entity);
    const token = makeSasToken(url, conn.keyName, conn.key);

    const body = Buffer.from(payload.body || '', 'utf8');
    const headers = { 'Content-Type': payload.contentType || 'application/json' };

    const broker = payload.brokerProperties || {};
    if (typeof broker !== 'object' || Array.isArray(broker)) throw new SbError('brokerProperties must be a JSON object');
    const cleanBroker = Object.fromEntries(
        Object.entries(broker).filter(([, value]) => value !== null && value !== undefined && value !== ''),
    );
    if (Object.keys(cleanBroker).length) headers.BrokerProperties = JSON.stringify(cleanBroker);

    const custom = payload.properties || {};
    if (typeof custom !== 'object' || Array.isArray(custom)) throw new SbError('Custom properties must be a JSON object');
    for (const [name, value] of Object.entries(custom)) {
        if (!name || !String(name).trim()) continue;
        headers[String(name)] = JSON.stringify(value);
    }

    const result = await azureRequest('POST', `${url}/messages?timeout=60`, token, body, headers);
    if (result.status !== 200 && result.status !== 201) {
        throw new SbError(describeHttpError(result, 'Send'), 502);
    }

    return {
        ok: true,
        action: 'send',
        entity,
        namespace: conn.host,
        bytesSent: body.length,
        brokerProperties: cleanBroker,
        properties: custom,
    };
}

async function receive(payload) {
    const conn = parseConnectionString(payload.connectionString);
    const entity = payload.entity || conn.entityPath;
    const url = entityUrl(conn.host, entity);
    const token = makeSasToken(url, conn.keyName, conn.key);

    const mode = payload.mode || 'peek-lock';
    const wait = Math.max(0, Math.min(Number(payload.waitSeconds) || 5, 55));
    const method = mode === 'receive-delete' ? 'DELETE' : 'POST';

    const result = await azureRequest(
        method, `${url}/messages/head?timeout=${wait}`, token, undefined, undefined, (wait + 15) * 1000,
    );

    if (result.status === 204) {
        return { ok: true, action: 'receive', empty: true, entity, message: null, mode };
    }
    if (result.status !== 200 && result.status !== 201) {
        throw new SbError(describeHttpError(result, 'Receive'), 502);
    }

    const message = decodeMessage(result);
    message.mode = mode;
    return { ok: true, action: 'receive', empty: false, entity, message, mode };
}

async function settle(payload) {
    const conn = parseConnectionString(payload.connectionString);
    const lockLocation = (payload.lockLocation || '').trim();
    if (!lockLocation) {
        throw new SbError('This message has no lock URI - it was read in receive-and-delete mode');
    }
    if (!lockLocation.startsWith(`https://${conn.host}/`)) {
        throw new SbError('The lock URI does not belong to this namespace');
    }

    const method = { complete: 'DELETE', abandon: 'PUT', renew: 'POST' }[payload.action];
    const token = makeSasToken(lockLocation, conn.keyName, conn.key);
    const result = await azureRequest(
        method, lockLocation, token, method === 'PUT' ? Buffer.alloc(0) : undefined,
    );

    if (result.status !== 200 && result.status !== 204) {
        throw new SbError(describeHttpError(result, payload.action), 502);
    }
    return { ok: true, action: payload.action };
}

async function test(payload) {
    const conn = parseConnectionString(payload.connectionString);
    const entity = payload.entity || conn.entityPath;
    const url = entityUrl(conn.host, entity);
    const token = makeSasToken(url, conn.keyName, conn.key);

    const result = await azureRequest('POST', `${url}/messages/head?timeout=0`, token, undefined, undefined, 25000);

    if (result.status === 200 || result.status === 201) {
        // We locked a message only to prove access — release it immediately.
        const location = result.headers.location;
        if (location) {
            await azureRequest('PUT', location, makeSasToken(location, conn.keyName, conn.key), Buffer.alloc(0));
        }
        return {
            ok: true, action: 'test', namespace: conn.host, entity,
            detail: 'Connected. The entity has at least one message waiting.',
        };
    }
    if (result.status === 204) {
        return {
            ok: true, action: 'test', namespace: conn.host, entity,
            detail: 'Connected. The entity is currently empty.',
        };
    }
    throw new SbError(describeHttpError(result, 'Connection test'), 502);
}

const ACTIONS = {
    send, receive, test,
    complete: settle, abandon: settle, renew: settle,
};

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.status(405).json({ ok: false, error: 'Use POST' });
        return;
    }

    let payload = request.body;
    if (typeof payload === 'string') {
        if (payload.length > MAX_BODY) {
            response.status(413).json({ ok: false, error: 'Request body too large' });
            return;
        }
        try {
            payload = JSON.parse(payload);
        } catch (err) {
            response.status(400).json({ ok: false, error: `Request body is not valid JSON: ${err.message}` });
            return;
        }
    }
    if (!payload || typeof payload !== 'object') {
        response.status(400).json({ ok: false, error: 'Request body is empty' });
        return;
    }

    const action = ACTIONS[payload.action];
    if (!action) {
        response.status(400).json({
            ok: false,
            error: `Unknown action '${payload.action}'. Expected one of: ${Object.keys(ACTIONS).join(', ')}`,
        });
        return;
    }

    try {
        response.status(200).json(await action(payload));
    } catch (err) {
        const status = err instanceof SbError ? err.status : 500;
        response.status(status).json({ ok: false, error: err.message });
    }
}
