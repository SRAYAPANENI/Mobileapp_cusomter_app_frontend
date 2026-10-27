// Emails are compared trimmed and lower-case — the server stores them that
// way (backend app/domain/contact.py), so "Sam@Gmail.com" and "sam@gmail.com"
// are one address.

export function tidyEmail(text: string): string {
  return text.trim().toLowerCase();
}

/** Shaped like name@example.com — catches typos like "sam@gmail". */
export function isEmail(text: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(text.trim());
}
