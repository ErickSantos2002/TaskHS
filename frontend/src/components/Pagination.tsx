import React from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  goToPage: (page: number) => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  itemLabel?: string; // Ex: "usuários", "produtos", "registros"
  // pageNumbers é aceito mas ignorado — calculamos internamente a janela deslizante
  pageNumbers?: number[];
}

/**
 * Componente reutilizável de paginação UI com suporte a modo claro e escuro.
 * Exibe uma janela deslizante de até 5 páginas ao redor da página atual.
 *
 * É puramente apresentacional: serve tanto para paginação no cliente (hook
 * usePagination) quanto no servidor — na LogsPage as props vêm do offset/total
 * devolvidos pela API, porque são milhares de registros e não dá para carregar
 * tudo de uma vez.
 */

const WINDOW_SIZE = 5;

/** Calcula a janela deslizante de até WINDOW_SIZE páginas ao redor da página atual */
function getVisiblePages(current: number, total: number): number[] {
  const half = Math.floor(WINDOW_SIZE / 2);
  let start = Math.max(1, current - half);
  let end = start + WINDOW_SIZE - 1;
  if (end > total) {
    end = total;
    start = Math.max(1, end - WINDOW_SIZE + 1);
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  hasNextPage,
  hasPrevPage,
  goToPage,
  goToNextPage,
  goToPrevPage,
  itemLabel = "registros",
}) => {
  // Não renderiza se tiver apenas 1 página
  if (totalPages <= 1) {
    return null;
  }

  const visiblePages = getVisiblePages(currentPage, totalPages);

  return (
    <div className="mt-6 border-t border-gray-200 px-6 pb-4 pt-4 dark:border-slate-700">
      {/* Desktop */}
      <div className="hidden items-center justify-between text-sm text-slate-500 dark:text-slate-400 md:flex">
        <div>
          Mostrando {startIndex + 1} a {endIndex} de {totalItems} {itemLabel}
        </div>
        <div className="flex gap-2">
          <button
            disabled={!hasPrevPage}
            onClick={goToPrevPage}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
          >
            Anterior
          </button>

          {/* Números de página — janela deslizante de 5 */}
          <div className="flex gap-1">
            {visiblePages.map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => goToPage(pageNum)}
                className={`min-w-10 rounded-lg px-3 py-1 text-sm transition-colors ${
                  pageNum === currentPage
                    ? "bg-emerald-600 text-white"
                    : "border border-gray-200 bg-white text-slate-900 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
                }`}
              >
                {pageNum}
              </button>
            ))}
          </div>

          <button
            disabled={!hasNextPage}
            onClick={goToNextPage}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
          >
            Próxima
          </button>
        </div>
      </div>

      {/* Mobile */}
      <div className="flex flex-col items-center gap-2 text-sm text-slate-500 dark:text-slate-400 md:hidden">
        <div>
          Mostrando {startIndex + 1} a {endIndex} de {totalItems} {itemLabel}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={!hasPrevPage}
            onClick={goToPrevPage}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-slate-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
          >
            {"<"}
          </button>
          <span className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
            {currentPage}
          </span>
          <button
            disabled={!hasNextPage}
            onClick={goToNextPage}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-slate-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
          >
            {">"}
          </button>
        </div>
      </div>
    </div>
  );
};
