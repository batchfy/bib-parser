/**
 * Error thrown when the parser encounters input it cannot process.
 *
 * Carries the position (character offset) at which parsing failed, which is
 * useful for surfacing helpful diagnostics to callers.
 */
export class BibtexParseError extends Error {
  /** The character offset within the input where the error was detected. */
  public readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (at position ${position})`);
    this.name = "BibtexParseError";
    this.position = position;

    // Restore the prototype chain for environments that transpile down to ES5.
    Object.setPrototypeOf(this, BibtexParseError.prototype);
  }
}
