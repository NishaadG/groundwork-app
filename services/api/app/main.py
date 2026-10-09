import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import install_error_handlers
from app.routes import chat, health, me, reports, society, solar, uploads, waste, water

logging.basicConfig(level=logging.INFO)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Groundwork API",
        version="0.2.0",
        docs_url="/docs" if settings.stage in ("local", "test", "dev") else None,
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["authorization", "content-type", "x-device-key"],
        max_age=600,
    )
    install_error_handlers(app)

    app.include_router(health.router)
    v1 = APIRouter(prefix="/v1")
    v1.include_router(me.router)
    v1.include_router(uploads.router)
    v1.include_router(solar.router)
    v1.include_router(solar.public)
    v1.include_router(water.router)
    v1.include_router(water.iot)
    v1.include_router(waste.router)
    v1.include_router(waste.public)
    v1.include_router(society.router)
    v1.include_router(reports.router)
    v1.include_router(chat.router)
    app.include_router(v1)
    return app


app = create_app()
