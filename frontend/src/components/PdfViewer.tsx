import { useEffect, useRef, useState } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Worker do pdf.js servido como asset (mesma origem) — sem CDN externo.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Renderiza o PDF com pdf.js: canvas (imagem) + camada de texto selecionável por
 * cima. Ao contrário do <iframe> nativo, a seleção/cópia de texto funciona igual em
 * qualquer navegador. Carregado sob demanda (React.lazy) para o pdf.js não pesar no
 * bundle de quem nunca abre um PDF.
 */
export default function PdfViewer({ url }: { url: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    const loadingTask = pdfjsLib.getDocument({ url });
    let pdfDoc: PDFDocumentProxy | null = null;
    const pages = pagesRef.current;
    if (!pages) return;
    pages.replaceChildren();
    setCarregando(true);
    setErro(null);

    (async () => {
      try {
        pdfDoc = await loadingTask.promise;
        if (cancelado) return;

        // Escala para caber na largura disponível (teto 2x para não estourar em telas
        // largas); o canvas usa devicePixelRatio para ficar nítido.
        const largura = (scrollRef.current?.clientWidth ?? 800) - 32;
        const dpr = window.devicePixelRatio || 1;

        for (let n = 1; n <= pdfDoc.numPages; n++) {
          const page = await pdfDoc.getPage(n);
          if (cancelado) return;
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(largura / base.width, 2);
          const viewport = page.getViewport({ scale });
          const w = Math.floor(viewport.width);
          const h = Math.floor(viewport.height);

          const pageDiv = document.createElement("div");
          pageDiv.style.position = "relative";
          pageDiv.style.width = `${w}px`;
          pageDiv.style.height = `${h}px`;
          pageDiv.style.margin = "0 auto";
          pageDiv.style.boxShadow = "0 1px 6px rgba(0,0,0,0.4)";

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
          canvas.style.display = "block";
          pageDiv.appendChild(canvas);

          const textLayerDiv = document.createElement("div");
          textLayerDiv.className = "textLayer";
          textLayerDiv.style.setProperty("--total-scale-factor", String(scale));
          textLayerDiv.style.width = `${w}px`;
          textLayerDiv.style.height = `${h}px`;
          pageDiv.appendChild(textLayerDiv);

          pages.appendChild(pageDiv);

          await page.render({
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;
          if (cancelado) return;

          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayerDiv,
            viewport,
          });
          await textLayer.render();
          if (cancelado) return;
          setCarregando(false); // some assim que a 1ª página aparece
        }
        if (!cancelado) setCarregando(false);
      } catch {
        if (!cancelado) { setErro("Não foi possível exibir o PDF."); setCarregando(false); }
      }
    })();

    return () => {
      cancelado = true;
      loadingTask.destroy();
    };
  }, [url]);

  return (
    <div ref={scrollRef} className="relative flex-1 overflow-auto" style={{ background: "#525659" }}>
      {carregando && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-200 text-sm pointer-events-none">
          Carregando PDF…
        </div>
      )}
      {erro && (
        <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm">{erro}</div>
      )}
      <div ref={pagesRef} className="flex flex-col gap-4 py-4" />
    </div>
  );
}
