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
# O nome e limitado a 120 chars sem quebra de linha ({1,120}, sem \n): nome de
# usuario nao e gigante nem multi-linha, e sem o limite um "@[" que nunca fecha
# fazia o [^\]]+ variavel varrer o texto inteiro a cada tentativa de casar —
# quadratico e capaz de travar o event loop (processo unico) com um corpo grande.
# O teto de 120 e o mesmo do User.name (models/user.py: String(120)), nao um numero
# inventado: com um teto MENOR, um nome longo geraria um token que o backend
# ignoraria em silencio — a mencao apareceria na tela e ninguem seria notificado.
# O teto (em vez de `+`) e o que impede a varredura quadratica: sem ele, cada "@["
# sem fechamento varria o texto ate o fim, e um corpo de 160 KB travava o event
# loop por ~40s — o backend e processo unico.
MENCAO_RE = re.compile(r"@\[([^\]\n]{1,120})\]\((\d+)\)")

# Um id de usuario e um integer do Postgres (32 bits com sinal). Sem este filtro,
# @[x](2147483648) chega ao in_() e o asyncpg rejeita com 500 — e o comentario se
# perde, quando a regra e ignorar a mencao invalida em silencio e salvar o texto.
MAX_ID = 2**31 - 1


def ids_mencionados(texto: str) -> set[int]:
    """Ids que o texto ALEGA mencionar.

    ALEGA é a palavra: o corpo do comentário vem do cliente. Quem chama TEM que
    validar cada id contra board_members antes de notificar — senão dá para forjar
    @[Quem Quiser](99) e entregar ao usuário 99 uma notificação com o texto que o
    autor escolher, de um quadro que ele não abre.

    Ids fora da faixa de um integer do Postgres (ex.: maior que 2147483647) são
    descartados aqui mesmo — nunca chegam a um in_() contra a coluna, que
    rejeitaria com erro do driver.
    """
    ids = set()
    for m in MENCAO_RE.finditer(texto):
        i = int(m.group(2))
        if 0 < i <= MAX_ID:
            ids.add(i)
    return ids


def texto_para_notificacao(texto: str) -> str:
    """Troca @[Nome](14) por @Nome.

    A notificação do sino é texto puro: sem isto ela mostraria
    'oi @[Adriana Paz](14) veja isso'.
    """
    return MENCAO_RE.sub(lambda m: f"@{m.group(1)}", texto)
