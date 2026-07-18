"""Auditoria automática: grava uma linha em audit_log para cada INSERT/UPDATE/DELETE
que passa pela sessão do SQLAlchemy — na MESMA transação da mudança.

Nota técnica: os handlers de flush rodam DENTRO do greenlet do SQLAlchemy async,
então consultas síncronas (session.get / session.execute) são permitidas aqui.
"""
import json
from datetime import datetime, date, timezone
from enum import Enum

from sqlalchemy import event, insert, inspect
from sqlalchemy.orm import Session

from app.audit_context import get_actor
from app.models.audit import AuditLog
from app.models.automation import Automation
from app.models.board import Board, BoardLabel, BoardMember
from app.models.card import (
    Card, CardAttachment, CardComment, CardLabel, CardMember, Checklist, ChecklistItem,
)
from app.models.list import List
from app.models.reminder import Reminder
from app.models.user import User
from app import realtime

# Tipos auditados. Notification, ReminderSent e AuditLog ficam de fora (ruído / recursão).
#
# ⚠️ ARMADILHA: para EXCLUIR qualquer tipo desta lista, use o ORM
# (`await db.delete(obj)`), NUNCA bulk delete (`db.execute(sql_delete(X).where(...))`).
# Os listeners abaixo leem `session.deleted`, e bulk delete não passa pelo
# unit-of-work — logo não popula `session.deleted` e a exclusão some do log.
#
# Isso falha em SILÊNCIO: o sintoma é a ausência de uma linha, que ninguém nota até
# precisar dela meses depois. Já aconteceu (2026-07-16, `remove_member` em
# `routers/boards.py`): remover alguém que ocupava 12 cards gerava UMA linha
# ("excluiu o membro_quadro") e as 12 atribuições evaporavam sem rastro.
#
# Se a lista for grande e o loop do ORM doer, a saída é gravar o AuditLog à mão —
# não é abrir mão do registro. Exceção aceita: quando o pai já é auditado e os
# filhos são consequência óbvia (ex.: `delete_board` apaga os lembretes do quadro).
ENTITY_TYPES: dict[type, str] = {
    Board: "quadro",
    List: "lista",
    Card: "card",
    BoardLabel: "etiqueta_quadro",
    CardLabel: "etiqueta_card",
    BoardMember: "membro_quadro",
    CardMember: "membro_card",
    CardComment: "comentario",
    Checklist: "checklist",
    ChecklistItem: "item_checklist",
    CardAttachment: "anexo",
    Reminder: "lembrete",
    Automation: "automacao",
    User: "usuario",
}

# Entidades cuja mudanca reflete na tela do quadro (face + card aberto).
# Exclui Reminder (pessoal), BoardMember/Automation/User (fora do escopo v1).
_SSE_CARD_CHILD = {CardLabel, CardMember, CardComment, Checklist, ChecklistItem, CardAttachment}


def _sse_target(session, obj, raw_action):
    """(board_id, kind, serialize_id, action) para o SSE, ou None (nao emite)."""
    t = type(obj)
    if t is Card:
        lst = session.get(List, obj.list_id)
        if lst is None:
            return None
        return (lst.board_id, "card", obj.id, "delete" if raw_action == "delete" else "upsert")
    if t is List:
        return (obj.board_id, "list", obj.id, "delete" if raw_action == "delete" else "upsert")
    if t is Board:
        return (obj.id, "board", obj.id, "upsert")  # delete de board = reload estrutural
    if t is BoardLabel:
        return (obj.board_id, "board_labels", obj.board_id, "upsert")
    if t in _SSE_CARD_CHILD:
        if t is ChecklistItem:
            cl = session.get(Checklist, obj.checklist_id)
            card_id = cl.card_id if cl else None
        else:
            card_id = obj.card_id
        if card_id is None:
            return None
        _, board_id = _card_ctx(session, card_id)
        if board_id is None:
            return None
        return (board_id, "card", card_id, "upsert")  # filho mudou -> re-serializa o card
    return None


SENSITIVE = {"password_hash"}
IGNORED_FIELDS = {"created_at", "updated_at"}
VERB = {"criar": "criou", "editar": "editou", "excluir": "excluiu", "mover": "moveu"}


def _json_safe(v):
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _diff(obj) -> dict:
    """Campos alterados: {campo: {"de": x, "para": y}}."""
    st = inspect(obj)
    out: dict = {}
    for attr in st.mapper.column_attrs:
        key = attr.key
        if key in IGNORED_FIELDS:
            continue
        hist = st.attrs[key].history
        if not hist.has_changes():
            continue
        before = hist.deleted[0] if hist.deleted else None
        after = hist.added[0] if hist.added else None
        if key in SENSITIVE:
            out[key] = {"de": "***", "para": "***"}
            continue
        out[key] = {"de": _json_safe(before), "para": _json_safe(after)}
    return out


def _snapshot(obj) -> dict:
    """Valores atuais no DELETE (não há histórico), no MESMO formato de diff usado em
    criar/editar: {campo: {"de": valor, "para": None}} — ou seja, "existia X, agora não existe".
    Sem isso a tela (que espera de/para) não conseguiria exibir o que foi excluído."""
    st = inspect(obj)
    out: dict = {}
    for attr in st.mapper.column_attrs:
        key = attr.key
        if key in IGNORED_FIELDS:
            continue
        valor = "***" if key in SENSITIVE else _json_safe(getattr(obj, key, None))
        out[key] = {"de": valor, "para": None}
    return out


def _card_ctx(session, card_id):
    """(titulo_do_card, board_id) — tolerante a entidade já removida."""
    card = session.get(Card, card_id) if card_id else None
    if card is None:
        return None, None
    lst = session.get(List, card.list_id)
    return card.title, (lst.board_id if lst else None)


def _describe(session, obj, action, changes):
    """→ (entity_type, entity_id, entity_label, board_id, card_id, summary)"""
    t = type(obj)
    etype = ENTITY_TYPES[t]
    eid = getattr(obj, "id", None)
    verb = VERB.get(action, action)
    board_id = card_id = None
    label = None

    if t is Board:
        board_id, label = obj.id, obj.title
        summary = f'{verb} o quadro "{obj.title}"'

    elif t is List:
        board_id, label = obj.board_id, obj.title
        summary = f'{verb} a lista "{obj.title}"'

    elif t is Card:
        card_id, label = obj.id, obj.title
        lst = session.get(List, obj.list_id)
        board_id = lst.board_id if lst else None
        if action == "mover":
            de = (changes.get("list_id") or {}).get("de")
            para = (changes.get("list_id") or {}).get("para")
            l_de = session.get(List, de) if de else None
            l_para = session.get(List, para) if para else None
            n_de = l_de.title if l_de else de
            n_para = l_para.title if l_para else para
            summary = f'moveu o card "{obj.title}" de "{n_de}" para "{n_para}"'
        elif action == "editar" and set(changes) == {"due_date_completed"}:
            marcou = (changes.get("due_date_completed") or {}).get("para")
            acao = "marcou" if marcou else "desmarcou"
            summary = f'{acao} a data de entrega como concluída no card "{obj.title}"'
        else:
            summary = f'{verb} o card "{obj.title}"'

    elif t is BoardLabel:
        board_id, label = obj.board_id, obj.name
        summary = f'{verb} a etiqueta "{obj.name}" do quadro'

    elif t is CardLabel:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        bl = session.get(BoardLabel, obj.label_id)
        label = bl.name if bl else str(obj.label_id)
        if action == "criar":
            summary = f'adicionou a etiqueta "{label}" ao card "{titulo or obj.card_id}"'
        else:
            summary = f'removeu a etiqueta "{label}" do card "{titulo or obj.card_id}"'

    elif t is BoardMember:
        board_id = obj.board_id
        u = session.get(User, obj.user_id)
        label = u.name if u else str(obj.user_id)
        if action == "criar":
            summary = f'adicionou "{label}" como membro do quadro'
        elif action == "excluir":
            summary = f'removeu "{label}" dos membros do quadro'
        else:
            summary = f'alterou o membro "{label}" do quadro'

    elif t is CardMember:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        u = session.get(User, obj.user_id)
        label = u.name if u else str(obj.user_id)
        if action == "criar":
            summary = f'atribuiu "{label}" ao card "{titulo or obj.card_id}"'
        else:
            summary = f'removeu "{label}" do card "{titulo or obj.card_id}"'

    elif t is CardComment:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = (obj.body or "")[:80]
        if action == "criar":
            summary = f'comentou no card "{titulo or obj.card_id}"'
        else:
            summary = f'{verb} um comentário do card "{titulo or obj.card_id}"'

    elif t is Checklist:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = obj.title
        summary = f'{verb} o checklist "{obj.title}" no card "{titulo or obj.card_id}"'

    elif t is ChecklistItem:
        cl = session.get(Checklist, obj.checklist_id)
        card_id = cl.card_id if cl else None
        titulo, board_id = _card_ctx(session, card_id)
        label = obj.text
        if action == "editar" and "checked" in changes:
            marcou = changes["checked"].get("para")
            acao = "marcou" if marcou else "desmarcou"
            summary = f'{acao} o item "{obj.text}" no card "{titulo or card_id}"'
        elif action == "criar":
            summary = f'adicionou o item "{obj.text}" ao checklist do card "{titulo or card_id}"'
        else:
            summary = f'{verb} o item "{obj.text}" do card "{titulo or card_id}"'

    elif t is CardAttachment:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = obj.filename
        if action == "criar":
            summary = f'anexou "{obj.filename}" ao card "{titulo or obj.card_id}"'
        else:
            summary = f'{verb} o anexo "{obj.filename}" do card "{titulo or obj.card_id}"'

    elif t is Reminder:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = titulo
        summary = f'{verb} um lembrete no card "{titulo or obj.card_id}"'

    elif t is Automation:
        board_id = obj.board_id
        lst = session.get(List, obj.trigger_list_id) if obj.trigger_list_id else None
        nome_lista = lst.title if lst else obj.trigger_list_id
        label = nome_lista if nome_lista is None else str(nome_lista)
        summary = f'{verb} uma automação (quando um card for movido para "{nome_lista}")'

    elif t is User:
        eid, label = obj.id, obj.name
        if action == "editar" and "role" in changes:
            de = changes["role"].get("de")
            para = changes["role"].get("para")
            summary = f'alterou o perfil de "{obj.name}" de {de} para {para}'
        else:
            summary = f'{verb} o usuário "{obj.name}"'

    else:  # pragma: no cover — ENTITY_TYPES cobre todos os tipos acima
        summary = f"{verb} {etype}"

    return etype, eid, label, board_id, card_id, summary


@event.listens_for(Session, "before_flush")
def _audit_before_flush(session, flush_context, instances):
    if session.info.get("audit_silent"):
        return
    pending = session.info.setdefault("_audit_pending", [])

    for obj in session.new:
        if type(obj) not in ENTITY_TYPES:
            continue
        pending.append((obj, "criar", _diff(obj)))

    for obj in session.dirty:
        if type(obj) not in ENTITY_TYPES:
            continue
        if not session.is_modified(obj, include_collections=False):
            continue
        changes = _diff(obj)
        if not changes:
            continue
        if type(obj) is Card:
            if set(changes) <= {"position"}:
                continue  # só reordenou dentro da lista → não audita
            action = "mover" if "list_id" in changes else "editar"
        else:
            action = "editar"
        pending.append((obj, action, changes))

    for obj in session.deleted:
        if type(obj) not in ENTITY_TYPES:
            continue
        pending.append((obj, "excluir", _snapshot(obj)))

    sse_raw = session.info.setdefault("_sse_raw", [])
    for obj in session.new:
        sse_raw.append((obj, "upsert"))
    for obj in session.dirty:
        if session.is_modified(obj, include_collections=False):
            sse_raw.append((obj, "upsert"))
    for obj in session.deleted:
        sse_raw.append((obj, "delete"))


@event.listens_for(Session, "after_flush")
def _audit_after_flush(session, flush_context):
    if session.info.get("audit_silent"):
        session.info.pop("_audit_pending", None)
        session.info.pop("_sse_raw", None)
        return
    pending = session.info.pop("_audit_pending", None)
    if not pending:
        return
    actor = get_actor()
    rows = []
    with session.no_autoflush:
        for obj, action, changes in pending:
            etype, eid, label, board_id, card_id, summary = _describe(session, obj, action, changes)
            rows.append({
                "created_at": datetime.now(timezone.utc),
                "actor_type": actor.actor_type,
                "actor_user_id": actor.user_id,
                "actor_name": (actor.name or "sistema")[:120],
                "actor_email": (actor.email[:255] if actor.email else None),
                "action": action,
                "entity_type": etype,
                "entity_id": eid,
                "entity_label": (str(label)[:255] if label is not None else None),
                "board_id": board_id,
                "card_id": card_id,
                "summary": summary,
                "changes": json.dumps(changes, ensure_ascii=False) if changes else None,
                "ip": (actor.ip[:45] if actor.ip else None),
                "path": (actor.path[:255] if actor.path else None),
            })
        if rows:
            session.execute(insert(AuditLog), rows)

    sse_raw = session.info.pop("_sse_raw", None)
    if sse_raw:
        pend = session.info.setdefault("_sse_pending", [])
        with session.no_autoflush:
            for obj, raw_action in sse_raw:
                tgt = _sse_target(session, obj, raw_action)
                if tgt is not None:
                    pend.append(tgt)


@event.listens_for(Session, "after_commit")
def _sse_after_commit(session):
    pend = session.info.pop("_sse_pending", None)
    if not pend:
        return
    # Dedup por (board_id, kind, id): varios filhos do mesmo card viram 1 upsert;
    # delete vence upsert (card apagado + filhos em cascata no mesmo commit).
    best: dict[tuple, str] = {}
    for board_id, kind, eid, action in pend:
        key = (board_id, kind, eid)
        if best.get(key) == "delete":
            continue
        best[key] = action
    for (board_id, kind, eid), action in best.items():
        realtime.enqueue_change(board_id, kind, eid, action)


@event.listens_for(Session, "after_rollback")
def _audit_after_rollback(session):
    session.info.pop("_audit_pending", None)
    session.info.pop("_sse_raw", None)
    session.info.pop("_sse_pending", None)


@event.listens_for(Session, "after_soft_rollback")
def _audit_after_soft_rollback(session, previous_transaction):
    session.info.pop("_audit_pending", None)
    session.info.pop("_sse_raw", None)
    session.info.pop("_sse_pending", None)
