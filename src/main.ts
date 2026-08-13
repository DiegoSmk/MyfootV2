import './styles.css'
import { Game } from './game/Game'

const MOUNT = document.getElementById('app') as HTMLElement
const canvas = document.createElement('canvas')
MOUNT.appendChild(canvas)

const game = new Game(canvas)
game.init().catch((err) => {
  console.error(err)
  const box = document.getElementById('hud') as HTMLElement
  if (box) {
    box.innerHTML = `<div class="hud-box"><strong>Erro</strong><span>${String(err)}</span></div>`
  }
})
