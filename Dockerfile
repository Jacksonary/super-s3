# ── Stage 1: build frontend ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: runtime ───────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/ ./

# Copy built frontend into static/ (served by FastAPI)
COPY --from=frontend-builder /app/frontend/dist ./static

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
