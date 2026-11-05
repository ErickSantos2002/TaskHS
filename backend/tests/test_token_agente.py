import base64
import hashlib
import hmac
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core.agente import (
    TokenDeAgenteInvalido,
    eh_token_de_agente,
    validar_token_de_agente,
)


def _par():
    priv = Ed25519PrivateKey.generate()
    pem = priv.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return priv, pem


@pytest.fixture
def par():
    return _par()


def emitir(priv, **sobrescreve):
    agora = int(time.time())
    payload = {
        "iss": "hsos",
        "aud": "taskhs",
        "sub": "fulano@healthsafetytech.com",
        "act": {"sub": "erick-bot"},
        "iat": agora,
        "exp": agora + 300,
        "jti": str(uuid.uuid4()),
    }
    for k, v in sobrescreve.items():
        if v is None:
            payload.pop(k, None)
        else:
            payload[k] = v
    return jwt.encode(payload, priv, algorithm="EdDSA")


def test_token_valido_devolve_email_e_bot(par):
    priv, pem = par
    assert validar_token_de_agente(emitir(priv), pem) == ("fulano@healthsafetytech.com", "erick-bot")


def test_aud_errado(par):
    priv, pem = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv, aud="outro"), pem)


def test_vencido(par):
    priv, pem = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv, exp=int(time.time()) - 10), pem)


def test_iss_errado(par):
    priv, pem = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv, iss="outro"), pem)


def test_chave_errada(par):
    _, pem = par
    outro, _ = _par()
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(outro), pem)


def test_exp_longe_demais(par):
    priv, pem = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv, exp=int(time.time()) + 3600), pem)


def test_sem_exp(par):
    priv, pem = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv, exp=None), pem)


def test_sem_act(par):
    priv, pem = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv, act=None), pem)


def test_chave_vazia(par):
    priv, _ = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv), "")


def test_chave_malformada(par):
    priv, _ = par
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(emitir(priv), "lixo")


def test_hs256_com_chave_publica_como_segredo(par):
    _, pem = par
    # PyJWT recusa assinar com PEM; forja o HS256 na mão, como faria um atacante.
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=")

    corpo = b64({"alg": "HS256", "typ": "JWT"}) + b"." + b64(
        {"iss": "hsos", "aud": "taskhs", "sub": "a@b.com", "act": {"sub": "bot"}, "exp": int(time.time()) + 300}
    )
    assinatura = base64.urlsafe_b64encode(hmac.new(pem.encode(), corpo, hashlib.sha256).digest()).rstrip(b"=")
    token = (corpo + b"." + assinatura).decode()
    with pytest.raises(TokenDeAgenteInvalido):
        validar_token_de_agente(token, pem)


def test_chave_com_barra_n_escapado(par):
    priv, pem = par
    escapada = pem.replace("\n", "\\n")
    assert validar_token_de_agente(emitir(priv), escapada)[1] == "erick-bot"


def test_eh_token_de_agente(par):
    priv, _ = par
    assert eh_token_de_agente(emitir(priv)) is True
    assert eh_token_de_agente(jwt.encode({"sub": "x"}, "segredo-de-teste-com-32-bytes-ok!!", algorithm="HS256")) is False
    assert eh_token_de_agente("lixo") is False
    assert eh_token_de_agente("") is False
