export type GachaUrlRequest = {
  gamePath?: string | null
}

export type GachaUrlResult = {
  ok: boolean
  url: string | null
  message: string
  requiresManualPath: boolean
}
