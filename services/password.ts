// The server's password rule (backend app/schemas/auth.py, SetPasswordRequest):
// checked here first, so a form never sends one the server will refuse.

export const PASSWORD_RULE = '8+ characters, with a letter and a number';

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
}
