import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { hideAbout } from './lib/about'

hideAbout()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
