from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 horas
    UPLOAD_DIR: str = "/app/uploads"
    # origens permitidas no CORS, separadas por vírgula
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:4173"
    # integração externa (espelhamento de cards via API key)
    INTEGRATION_API_KEY: str = ""
    INTEGRATION_OWNER_ID: int = 1

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    model_config = {"env_file": ".env"}


settings = Settings()
