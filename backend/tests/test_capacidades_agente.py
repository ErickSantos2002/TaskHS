"""A capacidade do Guardi bate com o `bloquear_token_de_agente` das rotas."""
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.audit_context import set_actor_via
from app.dependencies import bloquear_token_de_agente, get_current_user
from app.main import app
from app.models.user import Role, User
from app.routers.agente import PREFIXO, dependencias, rotas_do_agente

# As rotas que as ferramentas do Guardi chamam hoje (HS.OS: app/capacidade.py).
ROTAS_DO_GUARDI = [
    ["GET", "/auth/me"],
    ["GET", "/cards/minhas"],
    ["GET", "/boards"],
    ["GET", "/boards/{board_id}/snapshot"],
    ["GET", "/boards/{board_id}/members"],
    ["GET", "/lists/{list_id}/cards/{card_id}"],
    ["GET", "/search"],
    ["GET", "/dashboard"],
    ["POST", "/lists/{list_id}/cards"],
    ["PATCH", "/lists/{list_id}/cards/{card_id}"],
    ["POST", "/lists/{list_id}/cards/{card_id}/comments"],
    ["POST", "/lists/{list_id}/cards/{card_id}/members/{user_id}"],
    ["DELETE", "/lists/{list_id}/cards/{card_id}/members/{user_id}"],
]


def _rotas_api():
    return [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith(PREFIXO + "/")]


def test_nenhuma_rota_devolvida_e_barrada():
    devolvidas = {tuple(p) for p in rotas_do_agente(app)}
    for r in _rotas_api():
        barrada = bloquear_token_de_agente in dependencias(r.dependant)
        for m in r.methods - {"HEAD", "OPTIONS"}:
            par = (m, r.path[len(PREFIXO):])
            if barrada:
                assert par not in devolvidas, f"rota barrada para o agente na lista: {par}"


def test_toda_rota_barrada_fica_de_fora_e_ha_barradas():
    barradas = [r for r in _rotas_api() if bloquear_token_de_agente in dependencias(r.dependant)]
    assert len(barradas) > 10  # gestão de quadro, usuários, lixeira, automações...
    devolvidas = {tuple(p) for p in rotas_do_agente(app)}
    for r in barradas:
        for m in r.methods - {"HEAD", "OPTIONS"}:
            assert (m, r.path[len(PREFIXO):]) not in devolvidas


def test_rotas_conhecidas_barradas():
    devolvidas = {tuple(p) for p in rotas_do_agente(app)}
    for par in [("PATCH", "/boards/{board_id}"), ("POST", "/boards/{board_id}/members"),
                ("DELETE", "/boards/{board_id}/members/{user_id}"), ("POST", "/boards"),
                ("GET", "/auth/users"), ("POST", "/boards/{board_id}/lists")]:
        assert par not in devolvidas, par


def test_rotas_do_guardi_e_a_propria_rota_estao_na_lista():
    devolvidas = rotas_do_agente(app)
    for par in ROTAS_DO_GUARDI + [["GET", "/agente/capacidades"]]:
        assert par in devolvidas, par


def _usuario(role):
    return User(id=1, name="Fulano", email="f@x.com", role=role, is_active=True)


def _cliente(via):
    def falso():
        set_actor_via(via)
        return _usuario(Role.membro)
    app.dependency_overrides[get_current_user] = falso
    return TestClient(app)


def test_login_normal_leva_404():
    try:
        r = _cliente(None).get("/api/agente/capacidades")
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_token_de_agente_recebe_papel_e_rotas():
    try:
        r = _cliente("erick-bot").get("/api/agente/capacidades")
        assert r.status_code == 200
        corpo = r.json()
        assert corpo["papel"] == "Membro"
        assert corpo["rotas"] == rotas_do_agente(app)
    finally:
        app.dependency_overrides.clear()
