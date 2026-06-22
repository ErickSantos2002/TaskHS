import logging
from sqlalchemy import select
from app.models.automation import Automation
from app.models.list import List

logger = logging.getLogger("automations")


async def run_card_moved_automations(db, card, from_list_id: int, to_list_id: int) -> None:
    """Executa automações de 'card movido para lista'. Muta o card na sessão; NÃO faz commit."""
    if from_list_id == to_list_id:
        return
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
    for auto in automations:
        try:
            if auto.action_type == "mark_due_complete":
                if card.due_date is not None:
                    card.due_date_completed = True
        except Exception:
            logger.exception("automation %s failed for card %s", auto.id, card.id)
