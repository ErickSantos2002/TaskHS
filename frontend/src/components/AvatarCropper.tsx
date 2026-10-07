import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

/** Tela de ajuste da foto de perfil: arrastar para posicionar, zoom pelo
 *  controle, pela rodinha ou por pinça. A máscara redonda mostra exatamente o
 *  que vai aparecer no avatar. Devolve a área escolhida em pixels da imagem
 *  original — quem chama faz o recorte no canvas. */
export function AvatarCropper({ src, enviando, onCancel, onConfirm }: {
  src: string;
  enviando: boolean;
  onCancel: () => void;
  onConfirm: (area: Area) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  return (
    <div className="space-y-4">
      <div className="relative h-72 w-full overflow-hidden rounded-xl bg-black">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          minZoom={1}
          maxZoom={4}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400">Zoom</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
          className="flex-1 accent-primary"
          aria-label="Zoom da foto"
        />
      </div>
      <p className="text-[11px] text-slate-500">Arraste a foto para posicionar. Use o controle ou a rodinha do mouse para aproximar.</p>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={enviando} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-background-elevated disabled:opacity-50">Cancelar</button>
        <button
          onClick={() => area && onConfirm(area)}
          disabled={!area || enviando}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {enviando ? "Enviando..." : "Usar foto"}
        </button>
      </div>
    </div>
  );
}
