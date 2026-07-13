import logging
from sqlalchemy import select
from app.audit_context import Actor, current_actor
from app.models.automation import Automation
from app.models.list import List

logger = logging.getLogger("automations")


async def run_card_moved_automations(db, card, from_list_id: int, to_list_id: int) -> None:
    """Executa automações de 'card movido para lista'. Muta o card na sessão; NÃO faz commit.

    O flush do movimento do usuário é feito ANTES de resolver/aplicar as automações,
    para que a linha de auditoria 'mover' saia atribuída ao usuário real. Se alguma
    automação mutar o card, essa mutação é atribuída a um ator próprio ("automação"),
    nunca ao usuário que apenas moveu o card.
    """
    if from_list_id == to_list_id:
        return

    # Persiste o movimento do usuário primeiro — flush aqui gera a linha 'mover' com o ator real.
    await db.flush()

    board_id = (await db.execute(
        select(List.board_id).where(List.id == to_list_id)
    )).scalar_one_or_none()
    if board_id is None:
        return
    automations = (await db.execute(
        select(Automation).where(
            Automation.enabled == True,
            Automation.trigger_type == "card_moved_to_list",
            Automation.trigger_list_id == to_list_id,
            Automation.board_id == board_id,
        )
    )).scalars().all()
    if not automations:
        return

    anterior = current_actor.get()
    current_actor.set(Actor(
        actor_type="sistema",
        name="automação",
        ip=(anterior.ip if anterior else None),
        path=(anterior.path if anterior else None),
    ))
    try:
        for auto in automations:
            try:
                if auto.action_type == "mark_due_complete":
                    if card.due_date is not None:
                        card.due_date_completed = True
            except Exception:
                logger.exception("automation %s failed for card %s", auto.id, card.id)
        await db.flush()
    finally:
        current_actor.set(anterior)
