export interface SpecFailure {
  message: string
  sid?: string
}

export function assert(cond: boolean, message: string): void {
  if (!cond) {
    const err: SpecFailure = { message }
    throw err as unknown as Error
  }
}