"""Menções em comentários: @[Nome da Pessoa](14).

Texto puro, sem I/O — de propósito. Quem valida os ids contra o banco é o
router; aqui só se sabe o que o texto ALEGA.
"""
import re

# @[Nome da Pessoa](14) — nome entre colchetes, id do usuario entre parenteses.
# O nome vai no token (e nao so o id) porque o comentario mostra o nome da epoca
# em que foi escrito: e o registro do que a pessoa disse, nao uma versao reescrita
# depois. O id vai junto porque os nomes deste sistema tem espaco — "@Adriana Paz
# Silva" seria ambiguo, e dois "Adriana" seriam indistinguiveis.
MENCAO_RE = re.compile(r"@\[([^\]]+)\]\((\d+)\)")


def ids_mencionados(texto: str) -> set[int]:
    """Ids que o texto ALEGA mencionar.

    ALEGA é a palavra: o corpo do comentário vem do cliente. Quem chama TEM que
    validar cada id contra board_members antes de notificar — senão dá para forjar
    @[Quem Quiser](99) e entregar ao usuário 99 uma notificação com o texto que o
    autor escolher, de um quadro que ele não abre.
    """
    return {int(m.group(2)) for m in MENCAO_RE.finditer(texto)}


def texto_para_notificacao(texto: str) -> str:
    """Troca @[Nome](14) por @Nome.

    A notificação do sino é texto puro: sem isto ela mostraria
    'oi @[Adriana Paz](14) veja isso'.
    """
    return MENCAO_RE.sub(lambda m: f"@{m.group(1)}", texto)
