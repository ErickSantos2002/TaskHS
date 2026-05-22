"""
trello_import.py — Importa um board do Trello (JSON gratuito) para o TaskHS.

Como exportar o JSON do Trello SEM Premium:
  1. Abra o board no Trello
  2. Na barra de URL, adicione .json no final:
     Ex: https://trello.com/b/ALxXy9Kt.json
  3. Salve a página como arquivo .json (Ctrl+S)

Como usar este script:
  python trello_import.py
  (ele vai pedir o arquivo JSON, email e senha)

Ou configure as variáveis abaixo diretamente.
"""

import json
import sys
import time
import getpass
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("Instalando dependência 'requests'...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "--break-system-packages", "-q"])
    import requests

# ─────────────────────────────────────────────
#  CONFIGURAÇÃO
# ─────────────────────────────────────────────
API_URL = "http://localhost:8000/api"   # altere se o backend estiver em outro endereço
IMPORT_ARCHIVED_CARDS = False           # True = importa também os cartões arquivados
DELAY_BETWEEN_REQUESTS = 0.05          # segundos entre chamadas (evita sobrecarga)

# Mapeamento de cores do Trello → hex
TRELLO_COLORS: dict[str, str] = {
    "yellow":       "#f1c40f",
    "green":        "#2ecc71",
    "blue":         "#3b82f6",
    "red":          "#ef4444",
    "orange":       "#f97316",
    "purple":       "#9333ea",
    "pink":         "#ec4899",
    "sky":          "#0ea5e9",
    "lime":         "#84cc16",
    "black":        "#1e293b",
    "black_dark":   "#0f172a",
    "black_light":  "#64748b",
    "green_dark":   "#15803d",
    "blue_dark":    "#1d4ed8",
    "orange_dark":  "#c2410c",
    "red_dark":     "#b91c1c",
    "red_light":    "#f87171",
    "lime_dark":    "#4d7c0f",
    "lime_light":   "#bef264",
    "pink_light":   "#f9a8d4",
    "purple_dark":  "#7e22ce",
    "sky_dark":     "#0369a1",
    "sky_light":    "#7dd3fc",
}


# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────
def trello_color_to_hex(color: str | None) -> str:
    if not color:
        return "#64748b"
    return TRELLO_COLORS.get(color, "#64748b")


def parse_due(due: str | None) -> str | None:
    if not due:
        return None
    try:
        return datetime.fromisoformat(due.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except Exception:
        return None


class TaskHSClient:
    def __init__(self, base_url: str, token: str):
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })

    def _post(self, path: str, body: dict) -> dict:
        r = self.session.post(f"{self.base}{path}", json=body)
        if not r.ok:
            print(f"  ⚠  ERRO {r.status_code} em POST {path}: {r.text[:200]}")
        r.raise_for_status()
        time.sleep(DELAY_BETWEEN_REQUESTS)
        return r.json()

    def _patch(self, path: str, body: dict) -> dict:
        r = self.session.patch(f"{self.base}{path}", json=body)
        r.raise_for_status()
        time.sleep(DELAY_BETWEEN_REQUESTS)
        return r.json()

    # Boards
    def create_board(self, title: str, description: str | None, color: str) -> dict:
        return self._post("/boards", {"title": title, "description": description, "color": color})

    # Labels
    def create_label(self, board_id: int, name: str, color: str) -> dict:
        return self._post(f"/boards/{board_id}/labels", {"name": name, "color": color})

    # Lists
    def create_list(self, board_id: int, title: str, position: int) -> dict:
        return self._post(f"/boards/{board_id}/lists", {"title": title, "position": position})

    # Cards
    def create_card(self, list_id: int, title: str, description: str | None,
                    due_date: str | None, priority: str = "medium") -> dict:
        body: dict = {"title": title, "priority": priority}
        if description:
            body["description"] = description
        if due_date:
            body["due_date"] = due_date
        return self._post(f"/lists/{list_id}/cards", body)

    def archive_card(self, list_id: int, card_id: int) -> None:
        r = self.session.post(f"{self.base}/lists/{list_id}/cards/{card_id}/archive")
        r.raise_for_status()
        time.sleep(DELAY_BETWEEN_REQUESTS)

    def add_label_to_card(self, list_id: int, card_id: int, label_id: int) -> None:
        r = self.session.post(
            f"{self.base}/lists/{list_id}/cards/{card_id}/labels",
            json={"label_id": label_id},
        )
        if not r.ok:
            print(f"  ⚠  Não foi possível adicionar label {label_id} ao card {card_id}: {r.text[:100]}")

    def add_comment(self, list_id: int, card_id: int, body: str) -> None:
        r = self.session.post(
            f"{self.base}/lists/{list_id}/cards/{card_id}/comments",
            json={"body": body},
        )
        if not r.ok:
            print(f"  ⚠  Comentário falhou no card {card_id}: {r.text[:100]}")

    def create_checklist(self, list_id: int, card_id: int, title: str) -> dict:
        return self._post(f"/lists/{list_id}/cards/{card_id}/checklists", {"title": title})

    def create_checklist_item(self, list_id: int, card_id: int, cl_id: int,
                               text: str, checked: bool) -> dict:
        item = self._post(
            f"/lists/{list_id}/cards/{card_id}/checklists/{cl_id}/items",
            {"text": text},
        )
        if checked:
            self._patch(
                f"/lists/{list_id}/cards/{card_id}/checklists/{cl_id}/items/{item['id']}",
                {"checked": True},
            )
        return item


# ─────────────────────────────────────────────
#  LOGIN
# ─────────────────────────────────────────────
def login(base_url: str, email: str, password: str) -> str:
    r = requests.post(f"{base_url}/auth/login", json={"email": email, "password": password})
    if not r.ok:
        print(f"❌ Login falhou: {r.text}")
        sys.exit(1)
    return r.json()["access_token"]


# ─────────────────────────────────────────────
#  IMPORTAÇÃO PRINCIPAL
# ─────────────────────────────────────────────
def import_board(json_path: Path, email: str, password: str):
    print(f"\n📂 Lendo {json_path.name}...")
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    board_name: str = data.get("name", "Board Importado")
    board_desc: str = data.get("desc") or ""

    trello_lists: list[dict] = data.get("lists", [])
    trello_cards: list[dict] = data.get("cards", [])
    trello_labels: list[dict] = data.get("labels", [])
    trello_checklists: list[dict] = data.get("checklists", [])
    trello_actions: list[dict] = data.get("actions", [])

    # Filtra por cartões ativos ou inclui arquivados conforme config
    if not IMPORT_ARCHIVED_CARDS:
        trello_cards = [c for c in trello_cards if not c.get("closed")]

    # Índice de comentários por idCard
    comments_by_card: dict[str, list[str]] = {}
    for action in trello_actions:
        if action.get("type") == "commentCard":
            card_id = action.get("data", {}).get("card", {}).get("id")
            text = action.get("data", {}).get("text", "")
            author = action.get("memberCreator", {}).get("fullName", "")
            date_str = action.get("date", "")[:10]
            if card_id and text:
                entry = f"[{author} — {date_str}]\n{text}"
                comments_by_card.setdefault(card_id, []).append(entry)

    # Índice de checklists por idCard
    checklists_by_card: dict[str, list[dict]] = {}
    for cl in trello_checklists:
        card_id = cl.get("idCard")
        if card_id:
            checklists_by_card.setdefault(card_id, []).append(cl)

    print(f"  Board: '{board_name}'")
    print(f"  Listas: {len(trello_lists)}")
    print(f"  Cartões: {len(trello_cards)} {'(somente ativos)' if not IMPORT_ARCHIVED_CARDS else '(todos)'}")
    print(f"  Etiquetas: {len(trello_labels)}")
    print(f"  Checklists: {len(trello_checklists)}")
    print(f"  Comentários: {sum(len(v) for v in comments_by_card.values())}")

    # Login
    print(f"\n🔐 Autenticando em {API_URL}...")
    token = login(API_URL, email, password)
    client = TaskHSClient(API_URL, token)
    print("  ✅ Login OK")

    # Cria board
    print(f"\n📋 Criando board '{board_name}'...")
    board = client.create_board(board_name, board_desc or None, "#0ea5e9")
    board_id: int = board["id"]
    print(f"  ✅ Board criado (id={board_id})")

    # Cria etiquetas → mapeia id Trello → id TaskHS
    print(f"\n🏷  Criando {len(trello_labels)} etiquetas...")
    label_map: dict[str, int] = {}  # trello_label_id → taskhs_label_id
    for lbl in trello_labels:
        if not lbl.get("name"):
            continue
        hex_color = trello_color_to_hex(lbl.get("color"))
        created = client.create_label(board_id, lbl["name"], hex_color)
        label_map[lbl["id"]] = created["id"]
    print(f"  ✅ {len(label_map)} etiquetas criadas")

    # Cria listas → mapeia id Trello → id TaskHS
    print(f"\n📑 Criando {len(trello_lists)} listas...")
    list_map: dict[str, int] = {}   # trello_list_id → taskhs_list_id
    active_lists = [l for l in trello_lists if not l.get("closed")]
    archived_lists = [l for l in trello_lists if l.get("closed")]
    # Ativas primeiro, depois arquivadas (se necessário para receber cards arquivados)
    ordered_lists = active_lists + archived_lists

    for pos, lst in enumerate(ordered_lists):
        created = client.create_list(board_id, lst["name"], pos * 1000)
        list_map[lst["id"]] = created["id"]
    print(f"  ✅ {len(list_map)} listas criadas")

    # Cria cartões
    total = len(trello_cards)
    print(f"\n🃏 Importando {total} cartões...")

    ok_count = 0
    error_count = 0

    for idx, card in enumerate(trello_cards, 1):
        trello_list_id = card.get("idList")
        taskhs_list_id = list_map.get(trello_list_id)

        if not taskhs_list_id:
            print(f"  ⚠  Card '{card.get('name', '?')}' ignorado: lista não encontrada")
            error_count += 1
            continue

        title = card.get("name") or "(sem título)"
        description = card.get("desc") or None
        due_date = parse_due(card.get("due"))
        is_archived = card.get("closed", False)

        try:
            created_card = client.create_card(
                list_id=taskhs_list_id,
                title=title,
                description=description,
                due_date=due_date,
            )
            card_id: int = created_card["id"]
            trello_card_id: str = card["id"]

            # Etiquetas
            for lbl in card.get("labels", []):
                taskhs_label_id = label_map.get(lbl.get("id"))
                if taskhs_label_id:
                    client.add_label_to_card(taskhs_list_id, card_id, taskhs_label_id)

            # Checklists
            for cl in checklists_by_card.get(trello_card_id, []):
                cl_created = client.create_checklist(taskhs_list_id, card_id, cl.get("name", "Checklist"))
                for item in cl.get("checkItems", []):
                    client.create_checklist_item(
                        taskhs_list_id, card_id, cl_created["id"],
                        text=item.get("name", ""),
                        checked=(item.get("state") == "complete"),
                    )

            # Comentários (do Trello, em ordem cronológica)
            for comment_text in reversed(comments_by_card.get(trello_card_id, [])):
                client.add_comment(taskhs_list_id, card_id, comment_text)

            # Arquiva se estava fechado
            if is_archived:
                client.archive_card(taskhs_list_id, card_id)

            ok_count += 1
            if idx % 25 == 0 or idx == total:
                print(f"  [{idx}/{total}] {ok_count} importados, {error_count} erros...")

        except Exception as e:
            print(f"  ❌ Erro no card '{title}': {e}")
            error_count += 1

    print(f"\n{'='*50}")
    print(f"✅ Importação concluída!")
    print(f"   Cartões importados : {ok_count}")
    print(f"   Erros              : {error_count}")
    print(f"   Board TaskHS ID    : {board_id}")
    print(f"{'='*50}\n")


# ─────────────────────────────────────────────
#  PONTO DE ENTRADA
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("  Importador Trello → TaskHS")
    print("=" * 50)

    # Arquivo JSON
    if len(sys.argv) > 1:
        json_file = Path(sys.argv[1])
    else:
        raw = input("\nCaminho do arquivo JSON do Trello: ").strip().strip('"')
        json_file = Path(raw)

    if not json_file.exists():
        print(f"❌ Arquivo não encontrado: {json_file}")
        sys.exit(1)

    # Credenciais
    email = input("Email TaskHS: ").strip()
    password = getpass.getpass("Senha TaskHS: ")

    import_board(json_file, email, password)
