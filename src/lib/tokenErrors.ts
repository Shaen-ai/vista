/**
 * Thrown when the backend token gate rejects an action (HTTP 402).
 * UI layers catch this and render a locale-aware message instead of the
 * raw English message from the Laravel API.
 */
export class TokenInsufficientError extends Error {
  readonly balance: number;
  readonly required: number;

  constructor(message: string, balance: number, required: number) {
    super(message);
    this.name = "TokenInsufficientError";
    this.balance = balance;
    this.required = required;
  }
}
