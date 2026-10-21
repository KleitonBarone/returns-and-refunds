export function focusConfirmation(button: HTMLButtonElement | null) {
  button?.focus();
}
export function focusDetailHeading() {
  document.querySelector<HTMLElement>(".detail-pane h2")?.focus();
}
