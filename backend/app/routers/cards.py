from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from app.database import get_db
from app.models.card import Card, CardComment, CardMember, CardLabel, Checklist, ChecklistItem
from app.models.board import BoardLabel, BoardMember
from app.models.list import List
from app.models.notification import Notification
from app.models.reminder import Reminder, ReminderSent
from app.models.user import User
from app.schemas.card import (
    CardCreate, CardUpdate, CardOut, CommentCreate, CommentOut,
    ChecklistCreate, ChecklistOut, ChecklistItemCreate, ChecklistItemUpdate, ChecklistItemOut,
)
from app.dependencies import get_current_user, require_board_access_by_list_id, assert_board_access_by_list_id
from app.automations import run_card_moved_automations
from app.mentions import ids_mencionados, texto_para_notificacao


class CardCopyBody(BaseModel):
    title: str | None = None
    target_list_id: int | None = None

router = APIRouter(prefix="/lists/{list_id}/cards", tags=["cards"],
                   dependencies=[Depends(require_board_access_by_list_id)])


def _card_options():
    return [
        selectinload(Card.labels).selectinload(CardLabel.board_label),
        selectinload(Card.members).selectinload(CardMember.user),
        selectinload(Card.comments).selectinload(CardComment.author),
        selectinload(Card.attachments),
        selectinload(Card.checklists).selectinload(Checklist.items),
    ]


def _to_list(v) -> list:
    if not v:
        return []
    if isinstance(v, list):
        return v
    try:
        return list(v)
    except TypeError:
        return [v]


def _card_to_dict(card: Card) -> dict:
    return {
        "id": card.id,
        "list_id": card.list_id,
        "title": card.title,
        "description": card.description,
        "priority": card.priority,
        "position": card.position,
        "due_date": card.due_date,
        "due_date_completed": card.due_date_completed,
        "archived": card.archived,
        "external_source": card.external_source,
        "external_id": card.external_id,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "labels": [
            {"id": m.board_label.id, "label": m.board_label.name, "color": m.board_label.color}
            for m in _to_list(card.labels) if m.board_label is not None
        ],
        "members": [m.user for m in _to_list(card.members) if m.user is not None],
        "comments": _to_list(card.comments),
        "attachments": [
            {
                "id": a.id, "filename": a.filename, "content_type": a.content_type,
                "size": a.size, "uploaded_by": a.uploaded_by, "uploaded_at": a.uploaded_at,
                "is_image": (a.content_type or "").startswith("image/"),
            }
            for a in _to_list(card.attachments)
        ],
        "checklists": _to_list(card.checklists),
    }


async def _get_card_or_404(card_id: int, list_id: int, db: AsyncSession) -> Card:
    result = await db.execute(
        select(Card).where(Card.id == card_id, Card.list_id == list_id).options(*_card_options())
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    return card


@router.post("", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def create_card(list_id: int, body: CardCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    last = await db.execute(select(Card.position).where(Card.list_id == list_id).order_by(Card.position.desc()).limit(1))
    last_pos = last.scalar_one_or_none() or 0.0
    card = Card(**body.model_dump(), list_id=list_id, position=last_pos + 65536.0)
    db.add(card)
    await db.commit()
    result = await db.execute(select(Card).where(Card.id == card.id).options(*_card_options()))
    return _card_to_dict(result.scalar_one())


@router.get("", response_model=list[CardOut])
async def get_cards(list_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Card).where(Card.list_id == list_id, Card.archived == False).order_by(Card.position).options(*_card_options())
    )
    return [_card_to_dict(c) for c in result.scalars().all()]


@router.get("/{card_id}", response_model=CardOut)
async def get_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _card_to_dict(await _get_card_or_404(card_id, list_id, db))


@router.patch("/{card_id}", response_model=CardOut)
async def update_card(list_id: int, card_id: int, body: CardUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Card).where(Card.id == card_id, Card.list_id == list_id).options(*_card_options())
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    data = body.model_dump(exclude_none=True)
    # O destino vem no CORPO: a tranca do router so validou o list_id da URL.
    # Sem isto, um membro do quadro A move um card para o quadro B — e dispara as
    # automacoes de la — sem poder nem ler o B.
    quadro_destino = None
    if "list_id" in data and data["list_id"] != card.list_id:
        await assert_board_access_by_list_id(data["list_id"], current_user, db)
        destino = (await db.execute(
            select(List).where(List.id == data["list_id"]).limit(1)
        )).scalar_one_or_none()
        if destino is None:
            raise HTTPException(status_code=404, detail="Lista de destino não encontrada")
        quadro_destino = destino.board_id

    quadro_origem = (await db.execute(
        select(List.board_id).where(List.id == card.list_id)
    )).scalar_one_or_none()

    old_list_id = card.list_id
    for k, v in data.items():
        setattr(card, k, v)
    new_list_id = card.list_id

    # Card movido para OUTRO quadro: os CardMember viajam junto com ele, entao
    # gente do quadro de origem cairia num quadro de que nao e membro. Nem a
    # validacao do add_card_member nem a limpeza do remove_member pegam este
    # caminho — ele so existe aqui.
    if quadro_destino is not None and quadro_destino != quadro_origem:
        membros_do_destino = (
            select(BoardMember.user_id).where(BoardMember.board_id == quadro_destino)
        )
        # CardMember e Reminder sao tipos auditados: exclusao tem que passar pelo ORM
        # (await db.delete(obj)), nunca bulk delete — bulk delete nao popula
        # session.deleted e o audit.py (event listener de before_flush) nao registra a
        # exclusao. Ja aconteceu antes (remove_member em boards.py) e sumiu do log em
        # silencio, entao aqui o laco e proposital, mesmo custando uma query a mais.
        membros_fora = (await db.execute(
            select(CardMember).where(
                CardMember.card_id == card.id,
                CardMember.user_id.notin_(membros_do_destino),
            )
        )).scalars().all()
        for cm in membros_fora:
            await db.delete(cm)

        lembretes_fora = (await db.execute(
            select(Reminder).where(
                Reminder.card_id == card.id,
                Reminder.user_id.notin_(membros_do_destino),
            )
        )).scalars().all()
        for r in lembretes_fora:
            await db.delete(r)

        # Mesma logica para as etiquetas: BoardLabel e do quadro, nao do card. Sem
        # isto o card levaria pro quadro B uma etiqueta com nome/cor do quadro A —
        # exatamente o que o add_label bloqueia na entrada.
        etiquetas_do_destino = (
            select(BoardLabel.id).where(BoardLabel.board_id == quadro_destino)
        )
        etiquetas_fora = (await db.execute(
            select(CardLabel).where(
                CardLabel.card_id == card.id,
                CardLabel.label_id.notin_(etiquetas_do_destino),
            )
        )).scalars().all()
        for cl in etiquetas_fora:
            await db.delete(cl)

    if old_list_id != new_list_id:
        await run_card_moved_automations(db, card, old_list_id, new_list_id)
    await db.commit()
    # expire_on_commit=False + selectinload antes da limpeza acima: sem isto, a
    # resposta ainda mostraria os membros/etiquetas removidos ha 2 linhas (o
    # banco fica certo, mas o cliente recebe o estado de ANTES da limpeza).
    await db.refresh(card, ["members", "labels"])
    return _card_to_dict(card)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    # tabelas que referenciam o card sem cascade no ORM
    await db.execute(sql_delete(Notification).where(Notification.card_id == card_id))
    await db.execute(sql_delete(Reminder).where(Reminder.card_id == card_id))
    await db.execute(sql_delete(ReminderSent).where(ReminderSent.card_id == card_id))
    await db.delete(card)
    await db.commit()


@router.post("/{card_id}/copy", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def copy_card(list_id: int, card_id: int, body: CardCopyBody = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if body is None:
        body = CardCopyBody()
    original = await _get_card_or_404(card_id, list_id, db)
    target_list_id = body.target_list_id or list_id
    if target_list_id != list_id:
        # Mesmo buraco do update_card: destino no corpo, gate so na URL.
        await assert_board_access_by_list_id(target_list_id, current_user, db)
        destino = (await db.execute(
            select(List.id).where(List.id == target_list_id).limit(1)
        )).scalars().first()
        if destino is None:
            raise HTTPException(status_code=404, detail="Lista de destino não encontrada")
    title = body.title or original.title

    last = await db.execute(select(Card.position).where(Card.list_id == target_list_id).order_by(Card.position.desc()).limit(1))
    last_pos = last.scalar_one_or_none() or 0.0

    new_card = Card(
        list_id=target_list_id,
        title=title,
        description=original.description,
        priority=original.priority,
        due_date=original.due_date,
        position=last_pos + 65536.0,
    )
    db.add(new_card)
    await db.flush()

    # A etiqueta pertence a um quadro. Copiar para OUTRO quadro nao pode levar as
    # etiquetas da origem junto — e a mesma trava que o add_label impoe.
    etiquetas_do_destino = set((await db.execute(
        select(BoardLabel.id)
        .join(List, List.board_id == BoardLabel.board_id)
        .where(List.id == target_list_id)
    )).scalars().all())
    for lbl in _to_list(original.labels):
        if lbl.label_id in etiquetas_do_destino:
            db.add(CardLabel(card_id=new_card.id, label_id=lbl.label_id))

    # Copiar para OUTRO quadro nao pode levar junto quem nao e membro de la — o
    # assert_board_access_by_list_id acima valida quem COPIA, nao quem e copiado.
    membros_do_destino = set((await db.execute(
        select(BoardMember.user_id)
        .join(List, List.board_id == BoardMember.board_id)
        .where(List.id == target_list_id)
    )).scalars().all())
    for m in _to_list(original.members):
        if m.user_id in membros_do_destino:
            db.add(CardMember(card_id=new_card.id, user_id=m.user_id))

    for cl in _to_list(original.checklists):
        new_cl = Checklist(card_id=new_card.id, title=cl.title)
        db.add(new_cl)
        await db.flush()
        for item in _to_list(cl.items):
            db.add(ChecklistItem(checklist_id=new_cl.id, text=item.text, checked=False))

    await db.commit()
    result = await db.execute(select(Card).where(Card.id == new_card.id).options(*_card_options()))
    return _card_to_dict(result.scalar_one())


@router.post("/{card_id}/archive", response_model=CardOut)
async def archive_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    card.archived = True
    await db.commit()
    return _card_to_dict(card)


@router.post("/{card_id}/restore", response_model=CardOut)
async def restore_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Card).where(Card.id == card_id, Card.list_id == list_id).options(*_card_options())
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    card.archived = False
    await db.commit()
    return _card_to_dict(card)


@router.post("/{card_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(list_id: int, card_id: int, body: CommentCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    comment = CardComment(card_id=card_id, author_id=current_user.id, body=body.body)
    db.add(comment)
    lst = await db.execute(select(List).where(List.id == list_id))
    lst_obj = lst.scalar_one_or_none()
    board_id = lst_obj.board_id if lst_obj else None

    # O trecho do sino e texto puro: sem isto ele mostraria "@[Adriana Paz](14)".
    limpo = texto_para_notificacao(body.body)
    trecho = f"{limpo[:80]}{'…' if len(limpo) > 80 else ''}"

    # O corpo vem do CLIENTE. Sem validar contra board_members, alguem forja
    # @[Quem Quiser](99) e o sistema entrega ao usuario 99 uma notificacao com o
    # texto que o autor escolher, de um quadro que ele nao abre. Id que nao passa
    # e ignorado: o texto do comentario fica como foi escrito, so nao notifica.
    alegados = ids_mencionados(body.body)
    mencionados: set[int] = set()
    if alegados:
        mencionados = set((await db.execute(
            select(BoardMember.user_id).where(
                BoardMember.board_id == board_id,
                BoardMember.user_id.in_(alegados),
            )
        )).scalars().all())
    mencionados.discard(current_user.id)   # mencionar a si mesmo nao notifica

    for uid in sorted(mencionados):
        db.add(Notification(
            user_id=uid,
            type="card_mention",
            message=f"{current_user.name} mencionou você em \"{card.title}\": {trecho}",
            card_id=card_id,
            board_id=board_id,
        ))

    # So notifica quem e membro do quadro: a notificacao leva o titulo do card e um
    # trecho do comentario. Mesma rede do loop de lembretes — se a invariante furar
    # por um caminho imprevisto, aqui o custo e zero em vez de vazamento.
    members_result = await db.execute(
        select(CardMember)
        .join(BoardMember, BoardMember.user_id == CardMember.user_id)
        .where(CardMember.card_id == card_id, BoardMember.board_id == board_id)
    )
    for m in members_result.scalars().all():
        # Quem foi mencionado ja recebeu a notificacao de mencao, que e a mais
        # especifica — nao mandar as duas.
        if m.user_id != current_user.id and m.user_id not in mencionados:
            db.add(Notification(
                user_id=m.user_id,
                type="card_comment",
                message=f"{current_user.name} comentou em \"{card.title}\": {trecho}",
                card_id=card_id,
                board_id=board_id,
            ))
    await db.commit()
    result = await db.execute(
        select(CardComment).where(CardComment.id == comment.id).options(selectinload(CardComment.author))
    )
    return result.scalar_one()


@router.post("/{card_id}/members/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_card_member(list_id: int, card_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)

    lst = (await db.execute(select(List).where(List.id == list_id))).scalar_one_or_none()
    board_id = lst.board_id if lst else None

    alvo = (await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )).scalar_one_or_none()
    if alvo is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # A invariante desta branch: quem esta no card esta no quadro. Sem isto, a
    # pessoa recebe notificacao e lembrete com o TITULO de um card que ela nao
    # consegue abrir.
    eh_membro = (await db.execute(
        select(BoardMember.id)
        .where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
        .limit(1)
    )).scalars().first() is not None
    if not eh_membro:
        raise HTTPException(status_code=403, detail="Essa pessoa não é membro deste quadro")

    ja = (await db.execute(
        select(CardMember.id).where(CardMember.card_id == card_id, CardMember.user_id == user_id).limit(1)
    )).scalars().first()
    if ja is not None:
        return {"ok": True}

    db.add(CardMember(card_id=card_id, user_id=user_id))
    if user_id != current_user.id:
        db.add(Notification(
            user_id=user_id,
            type="card_member",
            message=f"Você foi adicionado ao card \"{card.title}\" por {current_user.name}.",
            card_id=card_id,
            board_id=board_id,
        ))
    try:
        await db.commit()
    except IntegrityError:
        # Corrida: outra requisicao inseriu entre o SELECT e o commit. O unique do
        # banco e a rede — o pre-check acima e so otimizacao. Idempotente: quem
        # perdeu a corrida devolve ok, e a Notification dela cai no rollback (a
        # da requisicao vencedora ja foi).
        await db.rollback()
        return {"ok": True}
    return {"ok": True}


@router.delete("/{card_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_card_member(list_id: int, card_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    result = await db.execute(select(CardMember).where(CardMember.card_id == card_id, CardMember.user_id == user_id))
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.commit()


class CardLabelBody(BaseModel):
    label_id: int


@router.post("/{card_id}/labels", status_code=status.HTTP_201_CREATED)
async def add_label(list_id: int, card_id: int, body: CardLabelBody, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    # A etiqueta tem que ser do MESMO quadro do card; senao da para colar uma
    # etiqueta de outro quadro no proprio card e ler nome/cor dela de volta.
    etiqueta = (await db.execute(
        select(BoardLabel.id)
        .join(List, List.board_id == BoardLabel.board_id)
        .where(BoardLabel.id == body.label_id, List.id == list_id)
        .limit(1)
    )).scalars().first()
    if etiqueta is None:
        raise HTTPException(status_code=404, detail="Etiqueta não encontrada neste quadro")
    existing = await db.execute(select(CardLabel).where(CardLabel.card_id == card_id, CardLabel.label_id == body.label_id))
    if existing.scalar_one_or_none():
        return {"ok": True}
    db.add(CardLabel(card_id=card_id, label_id=body.label_id))
    await db.commit()
    return {"ok": True}


@router.delete("/{card_id}/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_label(list_id: int, card_id: int, label_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    result = await db.execute(select(CardLabel).where(CardLabel.card_id == card_id, CardLabel.label_id == label_id))
    label = result.scalar_one_or_none()
    if label:
        await db.delete(label)
        await db.commit()


# ── Checklists ────────────────────────────────────────────────────

@router.post("/{card_id}/checklists", response_model=ChecklistOut, status_code=status.HTTP_201_CREATED)
async def create_checklist(list_id: int, card_id: int, body: ChecklistCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    checklist = Checklist(card_id=card_id, title=body.title)
    db.add(checklist)
    await db.commit()
    result = await db.execute(
        select(Checklist).where(Checklist.id == checklist.id).options(selectinload(Checklist.items))
    )
    return result.scalar_one()


@router.delete("/{card_id}/checklists/{checklist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist(list_id: int, card_id: int, checklist_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    result = await db.execute(select(Checklist).where(Checklist.id == checklist_id, Checklist.card_id == card_id))
    checklist = result.scalar_one_or_none()
    if checklist:
        await db.delete(checklist)
        await db.commit()


@router.post("/{card_id}/checklists/{checklist_id}/items", response_model=ChecklistItemOut, status_code=status.HTTP_201_CREATED)
async def add_checklist_item(list_id: int, card_id: int, checklist_id: int, body: ChecklistItemCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    exists = await db.execute(select(Checklist.id).where(Checklist.id == checklist_id, Checklist.card_id == card_id))
    if not exists.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Checklist não encontrado")
    item = ChecklistItem(checklist_id=checklist_id, text=body.text)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{card_id}/checklists/{checklist_id}/items/{item_id}", response_model=ChecklistItemOut)
async def update_checklist_item(list_id: int, card_id: int, checklist_id: int, item_id: int, body: ChecklistItemUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    result = await db.execute(
        select(ChecklistItem)
        .join(Checklist, Checklist.id == ChecklistItem.checklist_id)
        .where(
            ChecklistItem.id == item_id,
            ChecklistItem.checklist_id == checklist_id,
            Checklist.card_id == card_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{card_id}/checklists/{checklist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist_item(list_id: int, card_id: int, checklist_id: int, item_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    result = await db.execute(
        select(ChecklistItem)
        .join(Checklist, Checklist.id == ChecklistItem.checklist_id)
        .where(
            ChecklistItem.id == item_id,
            ChecklistItem.checklist_id == checklist_id,
            Checklist.card_id == card_id,
        )
    )
    item = result.scalar_one_or_none()
    if item:
        await db.delete(item)
        await db.commit()
