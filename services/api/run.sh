#!/bin/sh
# Entry point for the Lambda Web Adapter. It proxies Lambda events to this server on $PORT.
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
