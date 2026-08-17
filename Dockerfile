# DevTools container.
#
# Runs server.py, which serves the static site AND the Service Bus relay at
# /api/servicebus. An nginx-only image would serve the pages fine but the
# Service Bus tools would have nothing to talk to, because Azure's REST API
# sends no CORS headers.
#
# Python standard library only -- no dependencies to install.

FROM python:3.12-alpine

LABEL maintainer="@i-am-epic"
LABEL description="DevTools - browser-based developer utilities"
LABEL version="4.0.0"

WORKDIR /app

# Run as a non-root user.
RUN adduser -D -u 10001 devtools

COPY server.py ./
COPY index.html styles.css robots.txt sitemap.xml ./
COPY js/ ./js/
COPY agents/ ./agents/

USER devtools

EXPOSE 8000

ENV PYTHONUNBUFFERED=1
# Required inside a container: the default bind is localhost-only so that a
# local run does not expose the Service Bus relay to the network.
ENV DEVTOOLS_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).status == 200 else 1)"

CMD ["python", "server.py", "8000"]
