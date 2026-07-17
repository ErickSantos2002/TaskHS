from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete as sql_delete
from sqlalchemy.exc import IntegrityError
from datetime import date as _date
from sqlalchemy.orm import selectinload
from app.database import get_db, AsyncSessionLocal
from app.models.board import Board, BoardMember, BoardRole, BoardLabel
from app.models.list import List
from app.models.card import Card, CardMember, CardLabel, CardComment, CardAttachment, Checklist, ChecklistItem
from app.models.user import User
from app.models.notification import Notification
from app.models.reminder import Reminder, ReminderSent
from app.models.automation import Automation
from app.schemas.board import BoardCreate, BoardUpdate, BoardOut, BoardMemberAdd, BoardMemberOut, BoardListOut
from app.schemas.card import CardOut
from app.schemas.list import ListOut
from app.dependencies import get_current_user, require_board_access_by_board_id
import json as _json
from datetime import datetime as _dt
from app.models.audit import AuditLog
from app.audit_context import get_actor

router = APIRouter(prefix="/boards", tags=["boards"])


async def _get_board_or_404(board_id: int, db: AsyncSession) -> Board:
    result = await db.execute(select(Board).where(Board.id == board_id))
    board = result.scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=404, detail="Board não encontrado")
    return board


def _board_list_item(board: Board, user: User) -> dict:
    """Monta o item da listagem. `can_open` sai daqui — do backend, mesma regra
    da tranca em dependencies.py. Se o frontend recalculasse, cadeado e tranca
    poderiam divergir e a tela mentiria."""
    ids_membros = {m.user_id for m in board.members}
    return {
        "id": board.id,
        "title": board.title,
        "description": board.description,
        "color": board.color,
        "owner_id": board.owner_id,
        "created_at": board.created_at,
        "can_open": user.is_elevated or user.id in ids_membros,
        "owner_name": board.owner.name,
        "members": [
            {"id": m.user.id, "name": m.user.name, "initials": m.user.initials}
            for m in sorted(board.members, key=lambda m: m.user.name)
        ],
    }


@router.post("", response_model=BoardListOut, status_code=status.HTTP_201_CREATED)
async def create_board(body: BoardCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = Board(**body.model_dump(), owner_id=current_user.id)
    db.add(board)
    await db.flush()
    db.add(BoardMember(board_id=board.id, user_id=current_user.id, role=BoardRole.owner))
    await db.commit()
    await db.refresh(board)
    # Devolve BoardListOut para a listagem do frontend não precisar inventar os
    # campos ao inserir o quadro recém-criado. Quem cria é dono e único membro.
    return {
        "id": board.id,
        "title": board.title,
        "description": board.description,
        "color": board.color,
        "owner_id": board.owner_id,
        "created_at": board.created_at,
        "can_open": True,
        "owner_name": current_user.name,
        "members": [{
            "id": current_user.id, "name": current_user.name, "initials": current_user.initials,
        }],
    }


@router.get("", response_model=list[BoardListOut])
async def list_boards(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Todos os quadros da empresa. Quem não é membro recebe can_open=False e
    não passa da tranca se tentar abrir — ver dependencies.py."""
    result = await db.execute(
        select(Board)
        .options(
            selectinload(Board.members).selectinload(BoardMember.user),
            selectinload(Board.owner),
        )
        .order_by(Board.created_at.desc())
    )
    return [_board_list_item(b, current_user) for b in result.scalars().all()]


@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board_ids_q = await db.execute(
        select(Board.id).join(BoardMember, BoardMember.board_id == Board.id).where(BoardMember.user_id == current_user.id)
    )
    board_ids = board_ids_q.scalars().all()
    boards_count = len(board_ids)

    if not board_ids:
        return {"boards": 0, "cards_total": 0, "cards_overdue": 0, "cards_due_today": 0, "cards_completed": 0}

    list_ids_q = await db.execute(
        select(List.id).where(List.board_id.in_(board_ids), List.archived == False)
    )
    list_ids = list_ids_q.scalars().all()

    if not list_ids:
        return {"boards": boards_count, "cards_total": 0, "cards_overdue": 0, "cards_due_today": 0, "cards_completed": 0}

    today = _date.today()
    base = and_(Card.list_id.in_(list_ids), Card.archived == False)

    total     = (await db.execute(select(func.count(Card.id)).where(base))).scalar_one()
    overdue   = (await db.execute(select(func.count(Card.id)).where(base, Card.due_date != None, Card.due_date < today, Card.due_date_completed == False))).scalar_one()
    due_today = (await db.execute(select(func.count(Card.id)).where(base, Card.due_date == today, Card.due_date_completed == False))).scalar_one()
    completed = (await db.execute(select(func.count(Card.id)).where(base, Card.due_date_completed == True))).scalar_one()

    return {"boards": boards_count, "cards_total": total, "cards_overdue": overdue, "cards_due_today": due_today, "cards_completed": completed}


@router.post("/import")
async def import_from_trello(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    content = await file.read()

    async def generate():
        async with AsyncSessionLocal() as db:
            db.sync_session.info["audit_silent"] = True
            try:
                data = _json.loads(content)
                board_name: str = data.get("name", "Board Importado")
                board_desc: str | None = data.get("desc") or None
                trello_lists: list = data.get("lists", [])
                trello_cards: list = [c for c in data.get("cards", []) if not c.get("closed")]
                trello_labels: list = data.get("labels", [])
                trello_checklists: list = data.get("checklists", [])
                trello_actions: list = data.get("actions", [])

                comments_by_card: dict[str, list[str]] = {}
                for action in trello_actions:
                    if action.get("type") == "commentCard":
                        cid = action.get("data", {}).get("card", {}).get("id")
                        text = action.get("data", {}).get("text", "")
                        author = action.get("memberCreator", {}).get("fullName", "")
                        date_str = action.get("date", "")[:10]
                        if cid and text:
                            comments_by_card.setdefault(cid, []).append(f"[{author} — {date_str}]\n{text}")

                checklists_by_card: dict[str, list] = {}
                for cl in trello_checklists:
                    cid = cl.get("idCard")
                    if cid:
                        checklists_by_card.setdefault(cid, []).append(cl)

                yield _sse("info", message=f'Board: "{board_name}"')
                yield _sse("info", message=f"{len(trello_lists)} listas · {len(trello_cards)} cartões · {len(trello_labels)} etiquetas")

                board = Board(title=board_name, description=board_desc, color="#0ea5e9", owner_id=current_user.id)
                db.add(board)
                await db.flush()
                db.add(BoardMember(board_id=board.id, user_id=current_user.id, role=BoardRole.owner))
                await db.flush()
                yield _sse("info", message=f"Board criado (id={board.id})")

                label_map: dict[str, int] = {}
                for lbl in trello_labels:
                    if not lbl.get("name"):
                        continue
                    bl = BoardLabel(board_id=board.id, name=lbl["name"], color=_trello_color(lbl.get("color")))
                    db.add(bl)
                    await db.flush()
                    label_map[lbl["id"]] = bl.id
                if label_map:
                    yield _sse("info", message=f"{len(label_map)} etiquetas criadas")

                list_map: dict[str, int] = {}
                active_lists = [l for l in trello_lists if not l.get("closed")]
                archived_lists = [l for l in trello_lists if l.get("closed")]
                for pos, lst in enumerate(active_lists + archived_lists):
                    lst_obj = List(board_id=board.id, title=lst["name"], position=pos * 1000)
                    db.add(lst_obj)
                    await db.flush()
                    list_map[lst["id"]] = lst_obj.id
                yield _sse("info", message=f"{len(list_map)} listas criadas")

                total = len(trello_cards)
                ok = 0
                errors = 0
                yield _sse("progress", current=0, total=total)

                for idx, tcard in enumerate(trello_cards, 1):
                    taskhs_list_id = list_map.get(tcard.get("idList", ""))
                    if not taskhs_list_id:
                        errors += 1
                        yield _sse("warning", message=f"Card ignorado (lista não encontrada): {tcard.get('name', '?')[:40]}")
                        continue
                    try:
                        pos_result = await db.execute(select(func.max(Card.position)).where(Card.list_id == taskhs_list_id))
                        last_pos = pos_result.scalar_one_or_none() or 0.0
                        card = Card(
                            list_id=taskhs_list_id,
                            title=tcard.get("name") or "(sem título)",
                            description=tcard.get("desc") or None,
                            due_date=_parse_due(tcard.get("due")),
                            position=last_pos + 65536.0,
                        )
                        db.add(card)
                        await db.flush()

                        for lbl in tcard.get("labels", []):
                            lbl_id = label_map.get(lbl.get("id", ""))
                            if lbl_id:
                                db.add(CardLabel(card_id=card.id, label_id=lbl_id))

                        for cl in checklists_by_card.get(tcard["id"], []):
                            new_cl = Checklist(card_id=card.id, title=cl.get("name", "Checklist"))
                            db.add(new_cl)
                            await db.flush()
                            for item in cl.get("checkItems", []):
                                db.add(ChecklistItem(
                                    checklist_id=new_cl.id,
                                    text=item.get("name", ""),
                                    checked=(item.get("state") == "complete"),
                                ))

                        for text in reversed(comments_by_card.get(tcard["id"], [])):
                            db.add(CardComment(card_id=card.id, author_id=current_user.id, body=text))

                        ok += 1
                        yield _sse("progress", current=idx, total=total)

                        if ok % 25 == 0:
                            await db.commit()

                    except Exception as e:
                        errors += 1
                        yield _sse("warning", message=f"Erro no card '{tcard.get('name','?')[:30]}': {str(e)[:80]}")

                await db.commit()

                actor = get_actor()
                db.sync_session.info["audit_silent"] = False
                db.add(AuditLog(
                    actor_type=actor.actor_type, actor_user_id=actor.user_id,
                    actor_name=(actor.name or "sistema")[:120], actor_email=(actor.email[:255] if actor.email else None),
                    action="criar", entity_type="quadro", entity_id=board.id,
                    entity_label=board.title[:255], board_id=board.id,
                    summary=f'importou o quadro "{board.title}" do Trello ({len(list_map)} listas, {ok} cards)',
                    ip=(actor.ip[:45] if actor.ip else None), path=(actor.path[:255] if actor.path else None),
                ))
                await db.commit()

                yield _sse("done", board_id=board.id, imported=ok, errors=errors)

            except Exception as e:
                yield _sse("error", message=str(e))

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{board_id}", response_model=BoardOut)
async def get_board(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_board_access_by_board_id)):
    return await _get_board_or_404(board_id, db)


@router.patch("/{board_id}", response_model=BoardOut)
async def update_board(board_id: int, body: BoardUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o dono ou administrador pode editar o board")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(board, field, value)
    await db.commit()
    await db.refresh(board)
    return board


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o dono ou administrador pode excluir o board")
    # limpa tabelas que referenciam cards/board sem cascade no ORM
    list_ids = (await db.execute(select(List.id).where(List.board_id == board_id))).scalars().all()
    if list_ids:
        card_ids = (await db.execute(select(Card.id).where(Card.list_id.in_(list_ids)))).scalars().all()
        if card_ids:
            await db.execute(sql_delete(Reminder).where(Reminder.card_id.in_(card_ids)))
            await db.execute(sql_delete(ReminderSent).where(ReminderSent.card_id.in_(card_ids)))
            await db.execute(sql_delete(Notification).where(Notification.card_id.in_(card_ids)))
    await db.execute(sql_delete(Notification).where(Notification.board_id == board_id))
    await db.execute(sql_delete(Automation).where(Automation.board_id == board_id))
    await db.delete(board)
    await db.commit()


@router.get("/{board_id}/archived")
async def get_archived(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_board_access_by_board_id)):
    await _get_board_or_404(board_id, db)

    lists_result = await db.execute(
        select(List).where(List.board_id == board_id, List.archived == True)
    )
    archived_lists = lists_result.scalars().all()

    list_ids_result = await db.execute(
        select(List.id).where(List.board_id == board_id)
    )
    all_list_ids = [row for row in list_ids_result.scalars().all()]

    cards_result = await db.execute(
        select(Card)
        .where(Card.list_id.in_(all_list_ids), Card.archived == True)
        .options(
            selectinload(Card.labels),
            selectinload(Card.members).selectinload(CardMember.user),
            selectinload(Card.comments).selectinload(CardComment.author),
            selectinload(Card.attachments),
            selectinload(Card.checklists).selectinload(Checklist.items),
        )
    )
    archived_cards = cards_result.scalars().all()

    list_titles = {lst.id: lst.title for lst in (await db.execute(select(List.id, List.title).where(List.board_id == board_id))).all()}

    def card_to_dict(card: Card) -> dict:
        from app.routers.cards import _card_to_dict, _to_list
        d = _card_to_dict(card)
        d["list_title"] = list_titles.get(card.list_id, "")
        return d

    return {
        "cards": [card_to_dict(c) for c in archived_cards],
        "lists": [lst for lst in archived_lists],
    }


@router.get("/{board_id}/members", response_model=list[BoardMemberOut])
async def list_members(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_board_access_by_board_id)):
    await _get_board_or_404(board_id, db)

    # Quantos cards DESTE quadro cada pessoa ocupa. Subquery agregada: uma query
    # a mais no total, nao uma por membro.
    atribuidos = (
        select(CardMember.user_id.label("user_id"), func.count(CardMember.id).label("n"))
        .join(Card, Card.id == CardMember.card_id)
        .join(List, List.id == Card.list_id)
        .where(List.board_id == board_id)
        .group_by(CardMember.user_id)
        .subquery()
    )

    q = await db.execute(
        select(BoardMember, User, func.coalesce(atribuidos.c.n, 0))
        .join(User, User.id == BoardMember.user_id)
        .outerjoin(atribuidos, atribuidos.c.user_id == BoardMember.user_id)
        .where(BoardMember.board_id == board_id, User.is_active == True)
        .order_by(User.name)
    )
    return [
        {"id": u.id, "name": u.name, "email": u.email, "initials": u.initials,
         "board_role": bm.role, "assigned_cards": n}
        for bm, u, n in q.all()
    ]


@router.post("/{board_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(board_id: int, body: BoardMemberAdd, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o dono do quadro ou um administrador pode gerenciar membros")

    if body.role == BoardRole.owner:
        raise HTTPException(status_code=400, detail="O dono do quadro é definido na criação e não pode ser atribuído aqui")

    alvo = (await db.execute(select(User).where(User.id == body.user_id, User.is_active == True))).scalar_one_or_none()
    if alvo is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    ja = (await db.execute(
        select(BoardMember.id).where(BoardMember.board_id == board_id, BoardMember.user_id == body.user_id)
    )).scalar_one_or_none()
    if ja is not None:
        raise HTTPException(status_code=409, detail="Essa pessoa já é membro do quadro")

    db.add(BoardMember(board_id=board.id, user_id=body.user_id, role=body.role))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Essa pessoa já é membro do quadro")
    return {"ok": True}


@router.delete("/{board_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(board_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o dono do quadro ou um administrador pode gerenciar membros")
    if user_id == board.owner_id:
        raise HTTPException(status_code=400, detail="O dono do quadro não pode ser removido")

    membro = (await db.execute(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
    )).scalar_one_or_none()
    if membro is None:
        raise HTTPException(status_code=404, detail="Membro não encontrado")

    # Mantem a invariante: quem nao alcanca o quadro nao pode figurar nos cards
    # dele. Sem esta limpeza, a pessoa sai do quadro mas continua recebendo
    # lembrete com o titulo dos cards em que ficou pendurada.
    cards_do_quadro = (
        select(Card.id).join(List, List.id == Card.list_id).where(List.board_id == board_id)
    )
    # Via ORM (nao bulk delete): o audit.py captura exclusoes lendo session.deleted
    # no before_flush, e bulk delete nao popula isso. Sem este laco, remover alguem
    # que ocupa 12 cards gera UMA linha de log e as 12 atribuicoes somem sem rastro.
    atribuicoes = (await db.execute(
        select(CardMember).where(
            CardMember.user_id == user_id, CardMember.card_id.in_(cards_do_quadro)
        )
    )).scalars().all()
    for cm in atribuicoes:
        await db.delete(cm)

    lembretes = (await db.execute(
        select(Reminder).where(
            Reminder.user_id == user_id, Reminder.card_id.in_(cards_do_quadro)
        )
    )).scalars().all()
    for r in lembretes:
        await db.delete(r)

    await db.delete(membro)
    await db.commit()


_TRELLO_COLORS = {
    "yellow": "#f1c40f", "green": "#2ecc71", "blue": "#3b82f6", "red": "#ef4444",
    "orange": "#f97316", "purple": "#9333ea", "pink": "#ec4899", "sky": "#0ea5e9",
    "lime": "#84cc16", "black": "#1e293b", "black_dark": "#0f172a", "black_light": "#64748b",
    "green_dark": "#15803d", "blue_dark": "#1d4ed8", "orange_dark": "#c2410c",
    "red_dark": "#b91c1c", "red_light": "#f87171",
}

def _trello_color(c: str | None) -> str:
    return _TRELLO_COLORS.get(c or "", "#64748b")

def _parse_due(d: str | None) -> str | None:
    if not d:
        return None
    try:
        return _dt.fromisoformat(d.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except Exception:
        return None

def _sse(type_: str, **kwargs) -> str:
    return f"data: {_json.dumps({'type': type_, **kwargs})}\n\n"
