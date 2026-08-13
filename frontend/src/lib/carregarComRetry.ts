/** import() dinâmico que tolera uma falha de rede em vez de virar erro fatal.
 *
 *  POR QUE EXISTE: os pedaços carregados sob demanda (hoje, o visualizador de
 *  PDF) são buscados no clique. Uma única requisição que falha — rede oscilando,
 *  container reiniciando durante um deploy — rejeita o `lazy` e, sem rede de
 *  proteção, apagava a tela inteira. Aconteceu em produção (ago/2026).
 *
 *  Falha transitória passa na segunda tentativa. Falha permanente (deploy novo
 *  apagou o arquivo que esta aba conhece) esgota as tentativas e chega ao
 *  boundary, que oferece recarregar — aí sim a aba pega os arquivos novos. */
export function carregarComRetry<T>(
  carregar: () => Promise<T>,
  tentativas = 2,
  esperaMs = 600,
): Promise<T> {
  return carregar().catch((erro) => {
    if (tentativas <= 0) throw erro;
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        carregarComRetry(carregar, tentativas - 1, esperaMs * 2).then(resolve, reject);
      }, esperaMs);
    });
  });
}
