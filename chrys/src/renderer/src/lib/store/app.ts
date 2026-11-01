import { create } from 'zustand'
import type { AvailableUpdate } from '../../../../shared/update'

interface AppState {
  ignoreMouse: boolean
  /** 对话模式's page is on screen; the toolbar window shows that mode's buttons */
  inConversationPage: boolean
}

interface AppStore extends AppState {
  /** A newer release main found; the header and the help page show it */
  update: AvailableUpdate | null
  setUpdate: (update: AvailableUpdate | null) => void
  setIgnoreMouse: (ignore: boolean) => void
  toggleIgnoreMouse: () => void
  /** Adopt what main reports; it sends its whole state, of which these are the fields used here */
  syncAppState: (state: AppState) => void
}

const defaultState: AppState = {
  ignoreMouse: false,
  inConversationPage: false
}

export const useAppStore = create<AppStore>()((set) => ({
  ...defaultState,
  update: null,
  setUpdate: (update) => {
    set({ update })
  },
  setIgnoreMouse: (ignore) => {
    set({ ignoreMouse: ignore })
  },
  toggleIgnoreMouse: () => {
    set((state) => ({ ignoreMouse: !state.ignoreMouse }))
  },
  syncAppState: (state) => {
    set({ ignoreMouse: state.ignoreMouse, inConversationPage: state.inConversationPage })
  }
}))
