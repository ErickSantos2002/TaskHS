# Plano — alerta de atraso no modal do card

Spec: `docs/superpowers/specs/2026-11-23-alerta-no-card-design.md`. Execução inline (pedido do Erick).

1. **Backend — função compartilhada.** `reguas_do_card` em `app/horas_uteis.py`;
   `routers/dashboard.py` passa a usá-la no loop (comportamento idêntico). Teste
   unitário em `backend/tests/test_reguas_do_card.py`.
2. **Backend — `/meta`.** Carrega lista (is_done, archived, setor_id), quadro
   (fora_do_alerta, archived_at) e o nome do setor; devolve `alerta` só para
   `elevado_fora_do_agente`, e `null` fora das réguas.
3. **Front.** Tipo do `cardMeta` ganha `alerta`; selos no cabeçalho do modal.
4. **Changelog** v2.17.0 + `npm run build` + pytest + verificação por curl
   (admin vê, membro recebe `null`).
