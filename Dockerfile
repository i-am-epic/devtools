# CodeForge - Multi-stage Docker build for production
# Created by @nikboson

# Stage 1: Build stage (if needed for future build tools)
FROM node:18-alpine AS builder

WORKDIR /app

# For future: Add build steps here if you add TypeScript/bundlers
# COPY package*.json ./
# RUN npm ci --only=production

# Stage 2: Production stage with nginx
FROM nginx:alpine

# Set maintainer
LABEL maintainer="@nikboson"
LABEL description="CodeForge - 100+ Free Developer Tools"
LABEL version="1.0.0"

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy application files
COPY index.html /usr/share/nginx/html/
COPY fresh.html /usr/share/nginx/html/
COPY test.html /usr/share/nginx/html/
COPY debug.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY tools-config.json /usr/share/nginx/html/
COPY sitemap.xml /usr/share/nginx/html/
COPY robots.txt /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/

# Create custom nginx config for SPA
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Gzip compression \
    gzip on; \
    gzip_vary on; \
    gzip_min_length 1024; \
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss; \
    \
    # Cache static assets \
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    # No cache for HTML \
    location ~* \.(html)$ { \
        expires -1; \
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"; \
    } \
    \
    # Security headers \
    add_header X-Frame-Options "SAMEORIGIN" always; \
    add_header X-Content-Type-Options "nosniff" always; \
    add_header X-XSS-Protection "1; mode=block" always; \
    add_header Referrer-Policy "no-referrer-when-downgrade" always; \
    \
    # SPA fallback \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    \
    error_page 404 /index.html; \
}' > /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
