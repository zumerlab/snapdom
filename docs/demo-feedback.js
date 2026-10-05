// Keep feedback on the clicked control, where the user's attention already is.
export function buttonState(button, state, label) {
  if (!button) return
  button.dataset.feedback = state
  button.textContent = label
  button.setAttribute('aria-busy', String(state === 'busy'))
}
const style = document.createElement('style')
style.textContent = `[data-feedback="busy"]{cursor:progress!important}[data-feedback="success"]{background:#e6f5ec!important;color:#14532d!important;border:1px solid #399568!important}[data-feedback="error"]{background:#fff0f0!important;color:#8f1d28!important;border:1px solid #ca5662!important}[data-downloads] a,[data-export-file] a{display:inline-block;padding:10px 14px;margin-top:8px;border-radius:6px;background:#2d5bff;color:white!important;font-weight:600;text-decoration:none}`
document.head.append(style)
