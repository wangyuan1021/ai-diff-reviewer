export class DiffValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'EMPTY_DIFF' | 'INVALID_DIFF' | 'DIFF_TOO_LARGE',
  ) {
    super(message)
    this.name = 'DiffValidationError'
  }
}
