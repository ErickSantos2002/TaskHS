from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Boolean, text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Setor(Base):
    """Setor da empresa (Financeiro, Laboratório...). Cadastro do admin (migration 016).

    Cada lista pode ter um setor (`List.setor_id`); o Dashboard soma os cards
    travados (mais de 24 h úteis na mesma lista) por setor. Não há exclusão,
    só `ativo = false`: some do seletor do drawer, mas as listas marcadas
    continuam contando.
    """
    __tablename__ = "setores"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(80))
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    # server_default: em banco novo o create_all cria a tabela antes da 016, e o
    # INSERT dos setores iniciais da migration não manda created_at.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
