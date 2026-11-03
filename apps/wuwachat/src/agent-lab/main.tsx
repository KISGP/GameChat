import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'

import '@renderer/app/styles/main.css'
import { AgentLabPage } from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <>
    <AgentLabPage />
    {/* 顶部下移避开无边框窗口的拖拽工具栏，保证关闭钮可点击。 */}
    <Toaster position="top-center" theme="dark" richColors closeButton offset={{ top: 80 }} />
  </>
)
