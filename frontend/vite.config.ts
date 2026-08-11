import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Sourcemap em produção de propósito: sem ele, todo erro relatado por
    // usuário vem como "index-abc123.js:18:19409", que não aponta linha
    // nenhuma — e o bundle citado deixa de existir no deploy seguinte.
    // O código já é público (github.com/ErickSantos2002/TaskHS), então o mapa
    // não revela nada novo; custa alguns MB a mais na imagem do front.
    sourcemap: true,
  },
})
