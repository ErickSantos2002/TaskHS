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

    # SSO Microsoft (Entra ID). Vazias = SSO desligado.
    MS_CLIENT_ID: str = ""
    MS_TENANT_ID: str = ""
    MS_CLIENT_SECRET: str = ""
    MS_REDIRECT_URI: str = ""
    # para onde o callback devolve o navegador depois do login
    FRONTEND_URL: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def sso_enabled(self) -> bool:
        return bool(
            self.MS_CLIENT_ID
            and self.MS_TENANT_ID
            and self.MS_CLIENT_SECRET
            and self.MS_REDIRECT_URI
        )

    model_config = {"env_file": ".env"}


settings = Settings()
