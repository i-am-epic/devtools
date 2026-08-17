// Health probe used by the Service Bus tools to decide whether the relay
// is available. Mirrors GET /api/health in server.py.

export default function handler(request, response) {
    response.status(200).json({ ok: true, service: 'devtools', servicebus: true });
}
